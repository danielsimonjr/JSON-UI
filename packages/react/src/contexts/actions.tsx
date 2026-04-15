"use client";

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import {
  resolveAction,
  resolveActionWithStaging,
  executeAction,
  type Action,
  type ActionHandler,
  type ActionConfirm,
  type ResolvedAction,
  type IntentEvent,
  type JSONValue,
  type StagingBuffer,
} from "@json-ui/core";
import { useData } from "./data";

/**
 * Pending confirmation state
 */
export interface PendingConfirmation {
  /** The resolved action */
  action: ResolvedAction;
  /** The action handler */
  handler: ActionHandler;
  /** Resolve callback */
  resolve: () => void;
  /** Reject callback */
  reject: () => void;
}

/**
 * Action context value
 */
export interface ActionContextValue {
  /** Registered action handlers */
  handlers: Record<string, ActionHandler>;
  /** Currently loading action names */
  loadingActions: Set<string>;
  /** Pending confirmation dialog */
  pendingConfirmation: PendingConfirmation | null;
  /** Execute an action */
  execute: (action: Action) => Promise<void>;
  /** Confirm the pending action */
  confirm: () => void;
  /** Cancel the pending action */
  cancel: () => void;
  /** Register an action handler */
  registerHandler: (name: string, handler: ActionHandler) => void;
}

const ActionContext = createContext<ActionContextValue | null>(null);

/**
 * Props for ActionProvider
 */
export interface ActionProviderProps {
  /** Initial action handlers */
  handlers?: Record<string, ActionHandler>;
  /** Navigation function */
  navigate?: (path: string) => void;
  /**
   * Optional shared `StagingBuffer` for the Neural Computer runtime's
   * Path C integration. When provided, `execute()`:
   *
   * 1. Resolves the action's `DynamicValue` params via
   *    `resolveActionWithStaging(action, staging.snapshot(), data)` instead
   *    of core's `resolveAction(action, data)`, so single-segment
   *    `{path: "fieldId"}` literals pick up the user's in-progress input.
   *
   * 2. Captures `staging.snapshot()` at flush time for the `IntentEvent`'s
   *    `staging_snapshot` field (see `onIntent`).
   *
   * When absent, `execute()` falls back to `resolveAction(action, data)`
   * — the pre-NC behavior. Existing consumers that don't use staging see
   * no change.
   */
  staging?: StagingBuffer;
  /**
   * Optional callback that fires synchronously on every executed action
   * with a fully-formed `IntentEvent` payload. The NC runtime's orchestrator
   * registers here to receive intents from catalog actions fired by
   * Button clicks, form submissions, etc. without having to hand-roll a
   * `makeActionHandlers` wrapper around the `handlers` prop.
   *
   * Firing order per intent:
   *
   * 1. Params are resolved (staging-aware if `staging` is set).
   * 2. A confirm dialog, if declared, is shown and must be accepted.
   *    Rejected confirms short-circuit and DO NOT fire `onIntent`.
   * 3. `onIntent` fires with `{action_name, action_params, staging_snapshot,
   *    catalog_version, timestamp}`.
   * 4. The per-action handler (from `handlers`) runs, if one is registered.
   *
   * When `onIntent` is set, actions with no handler registered do NOT
   * log the "No handler registered" warning — the expected shape is
   * "handler-less actions flush through onIntent to the orchestrator."
   * Actions that need local UI-only side effects (e.g., "scroll to top")
   * still register a handler alongside.
   */
  onIntent?: (event: IntentEvent) => void;
  /**
   * Optional catalog version string threaded through every emitted
   * `IntentEvent.catalog_version` field. Set by the NC runtime from
   * its catalog config so the orchestrator can validate that the
   * LLM's tree emissions match the catalog version in effect at
   * emission time.
   */
  catalogVersion?: string;
  children: ReactNode;
}

/**
 * Provider for action execution
 */
export function ActionProvider({
  handlers: initialHandlers = {},
  navigate,
  staging,
  onIntent,
  catalogVersion,
  children,
}: ActionProviderProps) {
  const { data, set } = useData();
  const [handlers, setHandlers] =
    useState<Record<string, ActionHandler>>(initialHandlers);
  const [loadingActions, setLoadingActions] = useState<Set<string>>(new Set());
  const [pendingConfirmation, setPendingConfirmation] =
    useState<PendingConfirmation | null>(null);

  const registerHandler = useCallback(
    (name: string, handler: ActionHandler) => {
      setHandlers((prev) => ({ ...prev, [name]: handler }));
    },
    [],
  );

  // Helper: emit an IntentEvent if an onIntent callback is registered.
  // Captures a fresh staging snapshot each call so partial-stream / no-op
  // scenarios do not leak stale data. The params come from the staging-
  // aware resolved action, which already applied the staging-first rule
  // for single-segment paths.
  const emitIntent = useCallback(
    (resolved: ResolvedAction) => {
      if (!onIntent) return;
      // Coerce ResolvedAction.params (Record<string, unknown>) to the
      // Record<string, JSONValue> expected by IntentEvent.action_params.
      // The rule is already enforced on the type system at
      // StagingBuffer.set/ObservableDataModel.set, so this is a no-op
      // cast; callers that bypassed the type system and stored non-JSON
      // values are already in undefined-behavior territory per the
      // type-contract-only-validation decision in runtime.ts.
      const event: IntentEvent = {
        action_name: resolved.name,
        action_params: resolved.params as Record<string, JSONValue>,
        staging_snapshot: staging ? staging.snapshot() : {},
        timestamp: Date.now(),
      };
      if (catalogVersion !== undefined) {
        event.catalog_version = catalogVersion;
      }
      onIntent(event);
    },
    [onIntent, staging, catalogVersion],
  );

  const execute = useCallback(
    async (action: Action) => {
      // Staging-aware resolution when a StagingBuffer is wired in.
      // Falls back to core's resolveAction for non-NC consumers who
      // do not pass `staging`. See ActionProviderProps.staging docstring
      // for the staging-first-for-single-segment rule.
      const resolved = staging
        ? resolveActionWithStaging(action, staging.snapshot(), data)
        : resolveAction(action, data);
      const handler = handlers[resolved.name];

      // Policy: when onIntent is NOT set, a missing handler is a
      // warning and we bail. When onIntent IS set, a missing handler is
      // expected — the orchestrator takes the intent and decides what
      // to do. The warning is suppressed and we fall through to the
      // emit path below.
      if (!handler && !onIntent) {
        console.warn(`No handler registered for action: ${resolved.name}`);
        return;
      }

      // If confirmation is required, show the dialog and wait for
      // the user to accept. Rejection short-circuits everything
      // (no intent emission, no handler execution, no loading state).
      if (resolved.confirm) {
        return new Promise<void>((resolve, reject) => {
          setPendingConfirmation({
            action: resolved,
            // The pending-confirmation shape requires a handler ref for
            // the built-in ConfirmDialog's click path. When no handler
            // is registered (intent-only flow), synthesize a no-op
            // handler so the type shape is satisfied.
            handler: handler ?? (async () => {}),
            resolve: () => {
              setPendingConfirmation(null);
              resolve();
            },
            reject: () => {
              setPendingConfirmation(null);
              reject(new Error("Action cancelled"));
            },
          });
        }).then(async () => {
          // Emit AFTER the user accepts the confirm. Rejected confirms
          // do not fire onIntent (the user's cancel is itself the
          // signal that no intent happened).
          emitIntent(resolved);
          if (!handler) return;
          setLoadingActions((prev) => new Set(prev).add(resolved.name));
          try {
            await executeAction({
              action: resolved,
              handler,
              setData: set,
              navigate,
              executeAction: async (name) => {
                const subAction: Action = { name };
                await execute(subAction);
              },
            });
          } finally {
            setLoadingActions((prev) => {
              const next = new Set(prev);
              next.delete(resolved.name);
              return next;
            });
          }
        });
      }

      // No confirm — emit the intent immediately, then run the handler
      // if one is registered.
      emitIntent(resolved);
      if (!handler) return;
      setLoadingActions((prev) => new Set(prev).add(resolved.name));
      try {
        await executeAction({
          action: resolved,
          handler,
          setData: set,
          navigate,
          executeAction: async (name) => {
            const subAction: Action = { name };
            await execute(subAction);
          },
        });
      } finally {
        setLoadingActions((prev) => {
          const next = new Set(prev);
          next.delete(resolved.name);
          return next;
        });
      }
    },
    [data, handlers, set, navigate, staging, onIntent, emitIntent],
  );

  const confirm = useCallback(() => {
    pendingConfirmation?.resolve();
  }, [pendingConfirmation]);

  const cancel = useCallback(() => {
    pendingConfirmation?.reject();
  }, [pendingConfirmation]);

  const value = useMemo<ActionContextValue>(
    () => ({
      handlers,
      loadingActions,
      pendingConfirmation,
      execute,
      confirm,
      cancel,
      registerHandler,
    }),
    [
      handlers,
      loadingActions,
      pendingConfirmation,
      execute,
      confirm,
      cancel,
      registerHandler,
    ],
  );

  return (
    <ActionContext.Provider value={value}>{children}</ActionContext.Provider>
  );
}

/**
 * Hook to access action context
 */
export function useActions(): ActionContextValue {
  const ctx = useContext(ActionContext);
  if (!ctx) {
    throw new Error("useActions must be used within an ActionProvider");
  }
  return ctx;
}

/**
 * Hook to execute an action
 */
export function useAction(action: Action): {
  execute: () => Promise<void>;
  isLoading: boolean;
} {
  const { execute, loadingActions } = useActions();
  const isLoading = loadingActions.has(action.name);

  const executeAction = useCallback(() => execute(action), [execute, action]);

  return { execute: executeAction, isLoading };
}

/**
 * Props for ConfirmDialog component
 */
export interface ConfirmDialogProps {
  /** The confirmation config */
  confirm: ActionConfirm;
  /** Called when confirmed */
  onConfirm: () => void;
  /** Called when cancelled */
  onCancel: () => void;
}

/**
 * Default confirmation dialog component
 */
export function ConfirmDialog({
  confirm,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const isDanger = confirm.variant === "danger";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
      }}
      onClick={onCancel}
    >
      <div
        style={{
          backgroundColor: "white",
          borderRadius: "8px",
          padding: "24px",
          maxWidth: "400px",
          width: "100%",
          boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3
          style={{
            margin: "0 0 8px 0",
            fontSize: "18px",
            fontWeight: 600,
          }}
        >
          {confirm.title}
        </h3>
        <p
          style={{
            margin: "0 0 24px 0",
            color: "#6b7280",
          }}
        >
          {confirm.message}
        </p>
        <div
          style={{
            display: "flex",
            gap: "12px",
            justifyContent: "flex-end",
          }}
        >
          <button
            onClick={onCancel}
            style={{
              padding: "8px 16px",
              borderRadius: "6px",
              border: "1px solid #d1d5db",
              backgroundColor: "white",
              cursor: "pointer",
            }}
          >
            {confirm.cancelLabel ?? "Cancel"}
          </button>
          <button
            onClick={onConfirm}
            style={{
              padding: "8px 16px",
              borderRadius: "6px",
              border: "none",
              backgroundColor: isDanger ? "#dc2626" : "#3b82f6",
              color: "white",
              cursor: "pointer",
            }}
          >
            {confirm.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}
