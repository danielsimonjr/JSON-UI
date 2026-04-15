"use client";

import React, {
  createContext,
  useContext,
  useCallback,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  collectFieldIds,
  createStagingBuffer,
  type FieldId,
  type JSONValue,
  type StagingBuffer,
  type StagingSnapshot,
  type UITree,
} from "@json-ui/core";

/**
 * The React-facing staging-buffer context value. Exposes read, write, and
 * reconcile operations. Deliberately narrower than the underlying
 * `StagingBuffer` interface — consumers should use `useStaging` /
 * `useStagingField`, not reach through this object to the raw buffer.
 *
 * The Neural Computer runtime's input components (TextField, Checkbox, etc.)
 * bind their onChange handlers to `setField`, read their current value via
 * `useStagingField(id)`, and rely on the `StagingProvider` to flush a full
 * snapshot when a catalog action fires.
 */
export interface StagingContextValue {
  /** Current staging snapshot — identity-stable between mutations. */
  snapshot: StagingSnapshot;
  /** Read a single field value. */
  getField: (fieldId: FieldId) => JSONValue | undefined;
  /** Test whether a field has been written (distinguishes missing from undefined). */
  hasField: (fieldId: FieldId) => boolean;
  /** Write a field value. Fires subscribers synchronously. */
  setField: (fieldId: FieldId, value: JSONValue) => void;
  /** Delete a field. No-op if absent (does not fire subscribers). */
  deleteField: (fieldId: FieldId) => void;
  /**
   * Reconcile the buffer against a set of live field IDs — drop anything
   * whose key is NOT in `liveIds`. Call after committing a new tree from
   * the LLM; see `reconcileAgainstTree` for the common path that derives
   * `liveIds` from a `UITree`.
   */
  reconcile: (liveIds: ReadonlySet<FieldId>) => void;
  /**
   * Convenience wrapper: walks a `UITree` via `collectFieldIds` and calls
   * `reconcile` with the result. NC's renderer wrapper uses this directly
   * after a successful tree commit (Invariant 9 — partial-tree safety).
   */
  reconcileAgainstTree: (tree: UITree) => void;
}

const StagingContext = createContext<StagingContextValue | null>(null);

export interface StagingProviderProps {
  /**
   * Optional external `StagingBuffer` to bind to. When provided, the
   * provider wires into it via `useSyncExternalStore`, and all reads/writes
   * flow through the shared reference. When omitted, the provider creates
   * its own internal buffer via `createStagingBuffer()` and discards it on
   * unmount. NC's Path C integration passes an external buffer that is ALSO
   * consumed by a headless renderer session running in parallel for the
   * LLM Observer.
   *
   * The `store` reference should be stable across renders. Swapping the
   * store mid-component-lifetime is not supported — unmount and remount the
   * provider if you need to swap.
   */
  store?: StagingBuffer;
  children: ReactNode;
}

/**
 * Provider for the staging-buffer context. Binds to the caller-provided
 * `store` via `useSyncExternalStore` when present, or creates a session-
 * lifetime buffer internally when absent. Both paths use the same
 * `useSyncExternalStore` shape, so there is no rules-of-hooks split-
 * component dance here (unlike `DataProvider`, whose internal path uses
 * `useState`).
 *
 * The internal-mode buffer is created ONCE via `useRef` + lazy init so
 * the identity is stable across re-renders — the one-lifetime-per-mount
 * contract required by `useSyncExternalStore`.
 */
export function StagingProvider({ store, children }: StagingProviderProps) {
  const fallbackRef = useRef<StagingBuffer | null>(null);
  if (store === undefined && fallbackRef.current === null) {
    fallbackRef.current = createStagingBuffer();
  }
  const buffer = store ?? (fallbackRef.current as StagingBuffer);

  // Note on bare method references: passing `buffer.subscribe` and
  // `buffer.snapshot` as bare references is correct ONLY if Plan 1's
  // `createStagingBuffer` is closure-based (no `this` dependency). It
  // IS closure-based — the factory returns an object literal whose
  // methods close over the local `store`/`listeners`/`cachedSnapshot`.
  // If a future replacement uses a class with `this`-bound methods,
  // wrap with `.bind(buffer)` here defensively.
  const snapshot = useSyncExternalStore(
    buffer.subscribe,
    buffer.snapshot,
    buffer.snapshot, // SSR snapshot — same as client snapshot for non-SSR use
  );

  const value = useMemo<StagingContextValue>(
    () => ({
      snapshot,
      getField: (id) => buffer.get(id),
      hasField: (id) => buffer.has(id),
      setField: (id, v) => buffer.set(id, v),
      deleteField: (id) => buffer.delete(id),
      reconcile: (liveIds) => buffer.reconcile(liveIds),
      reconcileAgainstTree: (tree) => buffer.reconcile(collectFieldIds(tree)),
    }),
    [snapshot, buffer],
  );

  return (
    <StagingContext.Provider value={value}>{children}</StagingContext.Provider>
  );
}

/**
 * Read the staging context value. Throws if called outside a
 * `StagingProvider` — NC input components should never be mounted
 * without a provider upstream.
 */
export function useStaging(): StagingContextValue {
  const ctx = useContext(StagingContext);
  if (ctx === null) {
    throw new Error("useStaging must be used within a StagingProvider");
  }
  return ctx;
}

/**
 * Bind a single staging field — returns a `[value, setValue]` tuple
 * shaped like `useState`. The most common pattern for NC's input
 * components:
 *
 * ```tsx
 * function TextField({ id, label }: TextFieldProps) {
 *   const [value, setValue] = useStagingField<string>(id);
 *   return (
 *     <label>
 *       {label}
 *       <input
 *         value={value ?? ""}
 *         onChange={(e) => setValue(e.target.value)}
 *       />
 *     </label>
 *   );
 * }
 * ```
 *
 * The generic parameter is erased at runtime — callers are responsible
 * for matching the type they store with the type they read, just like
 * with `useState`.
 */
export function useStagingField<T extends JSONValue = JSONValue>(
  fieldId: FieldId,
): [T | undefined, (value: T) => void] {
  const { getField, setField } = useStaging();
  const value = getField(fieldId) as T | undefined;
  const setValue = useCallback(
    (next: T) => setField(fieldId, next as JSONValue),
    [fieldId, setField],
  );
  return [value, setValue];
}

/**
 * Read-only hook for the full current snapshot. Rare — most consumers
 * want `useStagingField`. Used by the NC renderer wrapper at flush time
 * to capture the snapshot for the IntentEvent payload.
 */
export function useStagingSnapshot(): StagingSnapshot {
  return useStaging().snapshot;
}
