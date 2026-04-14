import type {
  FieldId,
  IntentEvent,
  JSONValue,
  StagingBuffer,
  UITree,
} from "@json-ui/core";
import type {
  NormalizedNode,
  RenderPassId,
  SessionStateSnapshot,
} from "./types";
import type { SerializableError } from "./errors";

export interface RenderHooks {
  onBeforeRender(event: {
    passId: RenderPassId;
    tree: UITree;
    state: SessionStateSnapshot;
    timestamp: number;
  }): void;

  onAfterRender(event: {
    passId: RenderPassId;
    tree: UITree;
    result: NormalizedNode;
    elapsedMs: number;
    timestamp: number;
  }): void;

  onElementRender(event: {
    passId: RenderPassId;
    elementKey: string;
    elementType: string;
    result: NormalizedNode;
    timestamp: number;
  }): void;

  onActionDispatched(event: IntentEvent): void;

  onStagingChange(event: {
    fieldId: FieldId;
    newValue: JSONValue;
    oldValue: JSONValue | undefined;
    timestamp: number;
  }): void;

  onDataChange(event: {
    path: string;
    newValue: JSONValue;
    oldValue: JSONValue | undefined;
    timestamp: number;
  }): void;

  onError(error: SerializableError): void;
}

const noop = () => {};

/**
 * No-op default for every hook field. The session's hook dispatcher merges
 * a consumer's `Partial<RenderHooks>` against this default so every field is
 * always callable with no extra null-checks.
 */
export const noopHooks: RenderHooks = {
  onBeforeRender: noop,
  onAfterRender: noop,
  onElementRender: noop,
  onActionDispatched: noop,
  onStagingChange: noop,
  onDataChange: noop,
  onError: noop,
};

const HOOK_FIELDS = [
  "onBeforeRender",
  "onAfterRender",
  "onElementRender",
  "onActionDispatched",
  "onStagingChange",
  "onDataChange",
  "onError",
] as const;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _HookField = (typeof HOOK_FIELDS)[number];

/**
 * Merge multiple Partial<RenderHooks> into a single RenderHooks. For each
 * field, all provided callbacks are called in order. A throwing callback is
 * caught (logged via console.error) and does not prevent siblings from firing.
 *
 * This is the spec's hook composition primitive: a consumer can install one
 * partial set for in-process debugging and another for the transaction-log
 * feed, and both fire for every event.
 */
export function composeHooks(
  ...partials: Array<Partial<RenderHooks>>
): RenderHooks {
  const merged: RenderHooks = { ...noopHooks };
  for (const field of HOOK_FIELDS) {
    const handlers: Array<(arg: never) => void> = [];
    for (const p of partials) {
      const fn = p[field];
      if (typeof fn === "function") {
        handlers.push(fn as (arg: never) => void);
      }
    }
    if (handlers.length === 0) continue;
    (merged[field] as (arg: never) => void) = ((event: never) => {
      for (const handler of handlers) {
        try {
          handler(event);
        } catch (err) {
          // Per spec: hook callback errors are swallowed (not re-thrown, not
          // re-emitted via onError) to prevent (a) buggy hooks crashing
          // healthy renders, and (b) infinite recursion if onError itself
          // throws. console.error preserves observability.
          // eslint-disable-next-line no-console
          console.error(`[@json-ui/headless] hook ${field} threw:`, err);
        }
      }
    }) as never;
  }
  return merged;
}
