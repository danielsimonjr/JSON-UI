# @json-ui/react External Data Store Mode

**Status:** Design spec (not yet implemented)
**Date:** 2026-04-13
**Scope:** A targeted refactor of `packages/react/src/contexts/data.tsx` to add an optional `store?: ObservableDataModel` prop on `DataProvider`. When provided, the provider binds to the external observable store via `useSyncExternalStore(store.subscribe, store.snapshot)` and all read/write operations go through the store instead of local `useState`. When absent, the provider falls back to its current `useState<DataModel>(initialData)` behavior unchanged. This is Prerequisite 2 of the headless renderer spec and must ship before dual-backend shared state across React and headless is achievable.

## Context

The Neural Computer runtime runs `@json-ui/react` in the browser (for the user) and `@json-ui/headless` in a parallel context (for the LLM Observer). Both backends are expected to share a single observable data store: writes from either backend are immediately visible to the other.

The headless side uses its observable store directly. The React side currently cannot. `packages/react/src/contexts/data.tsx` — the canonical source of truth for JSON-UI's `DataProvider` — holds its state in `useState<DataModel>(initialData)`. `initialData` is consumed exactly once as a `useState` seed; subsequent mutations go through React's own `setData` callback and stay inside the React tree. An external `ObservableDataModel` reference passed as `initialData` today would be captured as a snapshot on mount and then ignored — the React tree would diverge from the store the moment either side wrote.

The review team's Round 2 findings confirmed this was a fatal gap in the headless renderer spec's "shared state" claim. The fix is a companion change to `@json-ui/react` (this spec) that teaches `DataProvider` to consume an external observable store when one is provided. When the new option is absent, behavior is unchanged — existing consumers of `DataProvider` are unaffected.

## The Problem

Current `DataProvider` (`packages/react/src/contexts/data.tsx`, lines ~50-95) does roughly:

```typescript
export function DataProvider({ initialData = {}, children, onDataChange }) {
  const [data, setDataState] = useState<DataModel>(initialData);

  const setData = (path, value) => {
    setDataState(prev => {
      const next = { ...prev };
      setByPath(next, path, value);
      onDataChange?.(path, value, prev);
      return next;
    });
  };

  // ... get, update wired similarly ...

  return <DataContext.Provider value={{ data, setData, get, update }}>...</DataContext.Provider>;
}
```

The state path is entirely local: `useState` owns the data, mutations are immutable-replacement (`{ ...prev }`), re-renders are triggered by React's own scheduling. An external observable store has no hook into any of this. If the headless side calls `observableStore.set(path, value)`, React's `data` snapshot in `useState` remains the old copy and the UI stays stale.

The fix is to add a parallel code path that uses `useSyncExternalStore(store.subscribe, store.snapshot)` when a `store` prop is provided. `useSyncExternalStore` is React 18's canonical primitive for binding to external mutable stores; it handles concurrent-mode tearing protection and triggers re-renders when the store's `subscribe` callbacks fire.

## Design Goals

**Backward-compatible by default.** Consumers who don't pass the new `store` prop see identical behavior. No breaking changes to `DataProvider`'s existing public API. No breaking changes to `DataContext`'s value shape (all existing consumers of `useData`, `useDataValue`, `useDataBinding` continue to work unchanged).

**Scoped to one file.** Changes are entirely within `packages/react/src/contexts/data.tsx`. `ValidationProvider`, `ActionProvider`, `VisibilityProvider`, and `renderer.tsx` do not change. `data.tsx`'s tests are updated and a new test file is added for the external-store path.

**React 18 concurrent-mode-safe.** `useSyncExternalStore` provides tearing protection for concurrent rendering; the spec's `ObservableDataModel.snapshot()` contract (identity-stable cached snapshots) is the counterpart requirement. This spec does not add new concurrent-mode handling — it consumes what React gives.

**Zero overhead when the external-store mode is unused.** Consumers who don't pass `store` pay nothing. The `useState` fallback path is the default and remains cheap.

**Minimum implementation surface.** No new exports from `@json-ui/react`. No new hooks. `DataProvider` grows one new prop and one internal conditional. `useData`, `useDataValue`, `useDataBinding` are unchanged — they read from `DataContext` as they do today, and the context value is populated by either the `useState` path or the `useSyncExternalStore` path.

## What Changes

**File modified:** `packages/react/src/contexts/data.tsx`

**Files NOT modified:**

- `packages/react/src/contexts/actions.tsx` — no data-store dependency
- `packages/react/src/contexts/validation.tsx` — holds its own `fieldStates` via `useState`, unrelated
- `packages/react/src/contexts/visibility.tsx` — reads from `DataContext`, unaffected
- `packages/react/src/renderer.tsx` — consumes `DataProvider` as a black box
- `packages/react/src/hooks.ts` — no change to `useDataBinding`
- `packages/react/src/index.ts` — `DataProvider`'s public type grows one optional prop; no new export names

## The API Change

`DataProviderProps` grows one optional field:

```typescript
export interface DataProviderProps {
  /** Child components that consume the data context. */
  children: ReactNode;
  /**
   * Initial data seed. Only used when `store` is NOT provided — in store mode,
   * the store's current contents are the initial state and `initialData` is ignored.
   */
  initialData?: DataModel;
  /**
   * Callback fired on every `setData`/`update` mutation. Same contract in both
   * internal and external-store modes: called with (path, newValue, prevValue).
   */
  onDataChange?: (path: string, newValue: unknown, prevValue: unknown) => void;
  /**
   * Optional external observable data store. When provided, DataProvider binds to
   * this store via `useSyncExternalStore` and all reads/writes flow through it.
   * When absent, DataProvider falls back to its local `useState` behavior.
   *
   * Passing `store` and `initialData` together is allowed: `initialData` is
   * ignored in store mode. Passing `store` as `undefined` vs. omitting it entirely
   * is treated identically.
   *
   * The `store` reference should be stable across renders. Changing which store
   * DataProvider consumes mid-component-lifetime is not supported — unmount and
   * remount the provider if you need to swap stores.
   */
  store?: ObservableDataModel;
}
```

Everything else on `DataProviderProps` and the exported `DataContextValue` shape is unchanged.

## Implementation Sketch

```typescript
import { useSyncExternalStore, useCallback, useMemo, useState, useRef } from "react";
import type { DataModel, ObservableDataModel } from "@json-ui/core";
import { getByPath, setByPath } from "@json-ui/core";

// The two modes are encapsulated in a single hook that returns the same shape
// regardless of which path was taken. DataProvider calls this hook once and
// populates the context.
function useDataState(
  store: ObservableDataModel | undefined,
  initialData: DataModel,
  onDataChange: DataProviderProps["onDataChange"],
): {
  data: Readonly<Record<string, unknown>>;
  setData: (path: string, value: unknown) => void;
  get: (path: string) => unknown;
  update: (updates: Record<string, unknown>) => void;
} {
  // EXTERNAL STORE MODE
  if (store !== undefined) {
    // useSyncExternalStore requires its getSnapshot to return an identity-stable
    // reference across calls with no intervening mutation. ObservableDataModel.snapshot()
    // provides this contract per the runtime types spec.
    const data = useSyncExternalStore(
      store.subscribe,
      store.snapshot,
      store.snapshot, // SSR snapshot — same as client snapshot for non-SSR use
    );

    const setData = useCallback(
      (path: string, value: unknown) => {
        const prev = store.get(path);
        store.set(path, value as never); // JSONValue cast — validated by ObservableDataModel
        onDataChange?.(path, value, prev);
      },
      [store, onDataChange],
    );

    const get = useCallback((path: string) => store.get(path), [store]);

    const update = useCallback(
      (updates: Record<string, unknown>) => {
        // Batch updates: no atomic guarantee in v1 (each store.set fires a subscribe).
        // Consumers that need atomic batching wrap their own update logic.
        for (const [path, value] of Object.entries(updates)) {
          const prev = store.get(path);
          store.set(path, value as never);
          onDataChange?.(path, value, prev);
        }
      },
      [store, onDataChange],
    );

    return { data, setData, get, update };
  }

  // INTERNAL useState MODE (unchanged from current behavior)
  const [data, setDataState] = useState<DataModel>(initialData);

  const setData = useCallback(
    (path: string, value: unknown) => {
      setDataState((prev) => {
        const next = { ...prev };
        setByPath(next, path, value);
        onDataChange?.(path, value, getByPath(prev, path));
        return next;
      });
    },
    [onDataChange],
  );

  const get = useCallback((path: string) => getByPath(data, path), [data]);

  const update = useCallback(
    (updates: Record<string, unknown>) => {
      setDataState((prev) => {
        const next = { ...prev };
        for (const [path, value] of Object.entries(updates)) {
          setByPath(next, path, value);
          onDataChange?.(path, value, getByPath(prev, path));
        }
        return next;
      });
    },
    [onDataChange],
  );

  return { data, setData, get, update };
}

export function DataProvider({
  children,
  initialData = {},
  onDataChange,
  store,
}: DataProviderProps) {
  const { data, setData, get, update } = useDataState(store, initialData, onDataChange);

  const contextValue = useMemo(
    () => ({ data, setData, get, update }),
    [data, setData, get, update],
  );

  return <DataContext.Provider value={contextValue}>{children}</DataContext.Provider>;
}
```

Key implementation notes:

- **One hook, two paths.** `useDataState` is a custom hook that chooses the path based on whether `store` is defined. React's rules of hooks require that hook calls happen in the same order every render — that means `useDataState` can't conditionally call `useSyncExternalStore` or `useState` within the same render. **This is a problem: the current sketch uses a conditional hook call, which violates the rules of hooks.** The real implementation must either:
  - (a) Split into two components: `<InternalDataProvider>` and `<ExternalDataProvider>` with `DataProvider` dispatching via `store !== undefined`. Each internal component calls exactly one set of hooks. This is the cleanest fix and the spec commits to it.
  - (b) Always call both `useState` and `useSyncExternalStore`, and select between them at return time. This wastes one hook every render and may cause `useSyncExternalStore` to complain about a missing store. Rejected.
  - (c) Use a key-based remount trick: `<InternalDataProvider key="internal">` vs `<ExternalDataProvider key="external">`. Works but requires unmount/remount on store toggle. Consistent with the "don't swap stores mid-lifetime" warning in the prop doc.
- **Split-component approach committed:** `DataProvider` becomes a thin dispatcher. Two internal components, `InternalDataProvider` (the current `useState` logic) and `ExternalDataProvider` (the `useSyncExternalStore` logic), each call their own hooks without branching. This respects the rules of hooks and keeps the two code paths independent.
- **`data` shape in external mode:** `ObservableDataModel.snapshot()` returns `Readonly<Record<string, JSONValue>>`, which is compatible with `DataModel = Record<string, unknown>` (JSONValue is narrower than unknown). Consumers reading `data` via `useData` get the same shape in both modes.
- **`onDataChange` behavior:** fires with `(path, newValue, prevValue)` in both modes. In external mode, `prevValue` is read via `store.get(path)` _before_ the `store.set` call so the value captured is the old one.
- **No atomic batching in `update`:** each `store.set` fires a `subscribe` callback, so a multi-key `update` triggers multiple re-renders. This matches the current `useState` mode's behavior (a single `setState` re-render per `update` call is actually BETTER than external mode). A future enhancement could add a batch method to `ObservableDataModel`; not in scope here.

## Corrected Component Structure

```typescript
export function DataProvider(props: DataProviderProps) {
  if (props.store !== undefined) {
    return <ExternalDataProvider {...props} store={props.store} />;
  }
  return <InternalDataProvider {...props} />;
}

function InternalDataProvider({ initialData = {}, children, onDataChange }: DataProviderProps) {
  const [data, setDataState] = useState<DataModel>(initialData);
  // ... current useState logic ...
  return <DataContext.Provider value={contextValue}>{children}</DataContext.Provider>;
}

function ExternalDataProvider({
  children,
  onDataChange,
  store,
}: DataProviderProps & { store: ObservableDataModel }) {
  const data = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  const setData = useCallback(/* store.set + onDataChange */, [store, onDataChange]);
  // ... ...
  return <DataContext.Provider value={contextValue}>{children}</DataContext.Provider>;
}
```

Each child component calls exactly one set of hooks. Switching from internal to external mode requires unmounting `InternalDataProvider` and mounting `ExternalDataProvider`, which is acceptable because the prop doc already states store swapping mid-lifetime is unsupported.

## Backward Compatibility

**Existing consumers of `DataProvider`** (those not passing `store`) see byte-identical behavior. The `InternalDataProvider` branch is the current implementation with no logic changes. The prop additions are purely additive to the interface.

**Existing consumers of `useData`, `useDataValue`, `useDataBinding`** are unaffected. All three hooks read from `DataContext` and do not care how the context was populated.

**The `onDataChange` callback** fires with the same arguments in both modes and is called on every mutation in both. Consumers who wired analytics or logging to `onDataChange` see no change.

**The `DataContextValue` type** is unchanged. No field added, removed, or renamed.

**The existing `data.test.tsx` test suite** must pass without modification in the internal mode. A new test file (`data-external-store.test.tsx`) covers the external mode.

## Testable Invariants

Each invariant maps to a test.

1. **Internal mode backward compatibility.** Every test in the existing `data.test.tsx` passes without modification. `DataProvider` without a `store` prop behaves exactly as it does today.
2. **External mode renders from store snapshot.** A `DataProvider` with an external store seeded with `{user: {name: "Alice"}}` makes `useDataValue("user/name")` return `"Alice"` on first render.
3. **External mutation triggers re-render.** A component subscribed via `useDataValue("user/name")` re-renders when an external writer calls `store.set("user/name", "Bob")`. The test uses a test-renderer render-count counter and asserts it increments on external mutation.
4. **Internal `setData` in external mode writes to the store.** A component that calls `setData("user/name", "Carol")` via `useData()` results in `store.get("user/name") === "Carol"`. Writes go through the store, not local state.
5. **`onDataChange` fires in external mode.** Passing an `onDataChange` callback alongside `store` fires the callback with the correct `(path, newValue, prevValue)` arguments on every mutation, whether the mutation came from the React side (`setData`) or the external side (`store.set` directly).
6. **Identity-stable snapshots prevent infinite re-render loops.** A store whose `snapshot()` returns the same reference across successive calls does not trigger React's "The result of `getSnapshot` should be cached" warning. Test uses a minimal store implementation and renders it inside `DataProvider`, asserting no warning is emitted during a normal lifecycle.
7. **Non-stable snapshots trigger React's warning.** A deliberately broken store whose `snapshot()` returns a new object every call causes React to emit the cache warning. This is a negative test to confirm Invariant 6 is meaningful.
8. **Rules of hooks are respected.** The existing lint rule `react-hooks/rules-of-hooks` passes on the new `data.tsx`. A test that dynamically switches `<DataProvider store={store} />` to `<DataProvider />` in the same subtree forces an unmount/remount (because the chosen child component changes) and does not produce React warnings.
9. **`update` fires mutation callbacks in order.** A multi-path `update({ a: 1, b: 2 })` call fires `onDataChange` twice, in key order (for external mode) or once via `setState` (for internal mode).
10. **No changes to other contexts.** A test imports `ValidationProvider`, `ActionProvider`, `VisibilityProvider` and asserts their source files are unchanged by this spec (string-compare against the current version). Regression guard.
11. **Store swap is unsupported and surfaces as a remount.** A test passes `<DataProvider store={storeA} />`, then re-renders with `<DataProvider store={storeB} />` (different store reference). The test asserts the underlying `useSyncExternalStore` subscription is swapped — meaning the `ExternalDataProvider` child was unmounted and remounted. React's component identity is stable as long as the top-level `DataProvider` is not keyed otherwise, but the internal `ExternalDataProvider` sees a fresh mount with the new store.
12. **`initialData` ignored in external mode.** `<DataProvider store={store} initialData={{ ignored: "yes" }} />` where `store` is empty results in `useDataValue("ignored")` returning `undefined`. The spec commits to silent ignore over throwing — the `initialData` prop carries semantic content for internal mode, and in external mode the store is always authoritative.

## Testing Strategy

New test file: `packages/react/src/contexts/data-external-store.test.tsx`

Test setup uses a minimal mock `ObservableDataModel` implementation for unit tests, and `@testing-library/react` for component-level assertions. The mock store is a thin wrapper around a plain object with subscribe/snapshot caching logic matching the runtime spec's requirements.

Integration with a real `createObservableDataModel` is deferred to a separate integration test file (`data-real-store.test.tsx`) that imports from `@json-ui/core` and exercises both the store and the provider together. This two-file split lets the provider tests stay focused on the React binding while the integration tests cover end-to-end correctness.

Test categories:

- **Internal mode regression.** Every existing test case in `data.test.tsx` runs unchanged. No tests are deleted.
- **External mode basics.** Tests 2-5 from the invariant list. Covers reads, writes, and `onDataChange`.
- **Concurrent-mode safety.** Tests 6-7. Covers identity-stable snapshots.
- **Rules of hooks compliance.** Test 8. Validates the split-component approach.
- **Mode switching.** Test 11. Validates the remount-on-store-swap behavior.
- **Interaction with other contexts.** Test 10. Validates that the change does not leak into sibling providers.

## What This Spec Is Not

- **Not a design of `ObservableDataModel` itself.** That lives in the core runtime types spec (`2026-04-13-core-runtime-types-design.md`). This spec consumes the interface and does not redefine it.
- **Not a new React hook.** No `useExternalData` or similar. Existing `useData`, `useDataValue`, `useDataBinding` are the public API and they remain unchanged.
- **Not a staging-buffer integration spec.** The staging buffer is NC-owned (per the NC ephemeral-UI-state spec). A parallel `StagingBufferProvider` external-store refactor is Prerequisite 3 of the headless renderer spec and lives in NC's docs, not JSON-UI's.
- **Not a context merger.** `DataProvider`, `ValidationProvider`, `ActionProvider`, `VisibilityProvider` remain four separate contexts. The external-store mode applies only to `DataProvider`.
- **Not a performance benchmark spec.** The external path adds one `useSyncExternalStore` call per render; no measured performance claims. Performance tuning is a v1.1 concern.

## Open Questions

1. **Should `initialData` silently override or throw when `store` is also provided?** Currently committed to silent ignore with documentation. Alternative: throw at mount time with a clear error message. Throwing is louder and harder to miss; silent ignore is friendlier to consumers migrating from internal to external mode. Leaning **silent ignore** because migration-friendliness matters more than loudness here, and the documentation explicitly calls it out.

2. **What happens if the `store` reference changes across renders (same `DataProvider` instance, different store prop)?** The split-component approach forces a remount because the rendered child type changes. Within a single child component instance, the `store` reference is captured by `useCallback` / `useSyncExternalStore` closures. React's `useSyncExternalStore` does _not_ resubscribe automatically when `subscribe` changes identity unless the caller explicitly handles it. **Committed to:** the prop docs explicitly say store-swapping mid-lifetime is unsupported; remount is the consumer's workaround.

3. **Should `DataProvider` expose a way to inspect whether it's in external mode?** A consumer writing a test that wants to assert "yes, the provider is using my external store" currently has no visibility — the context value shape is the same in both modes. Options: (a) add a `mode: "internal" | "external"` field to the context value (API surface growth), (b) add a dedicated `useDataMode()` hook (API surface growth), (c) require consumers to hold the store reference externally and trust their own usage. **Leaning** option (c) — consumers who passed the store already have the reference; they don't need the provider to tell them about their own decision.

## Non-Goals

- **No deprecation of the internal mode.** Both modes ship and both are supported. Internal mode is the default for every existing consumer.
- **No migration tooling.** Consumers opt into external mode by passing the new prop. No codemods, no automated rewrites.
- **No staging buffer work.** See Prerequisite 3 (NC-owned spec).
- **No changes to `ValidationProvider`, `ActionProvider`, `VisibilityProvider`, or `renderer.tsx`.**
- **No SSR story.** `useSyncExternalStore` takes a `getServerSnapshot` parameter for SSR; this spec passes the client snapshot for both. Server-side rendering with external stores is a separate concern.

## Prior Art

- **React 18's `useSyncExternalStore` hook.** The canonical primitive for binding React components to external mutable stores. Documented in the React docs under "useSyncExternalStore." Provides tearing protection for concurrent rendering.
- **Zustand's React integration.** Zustand binds its stores to React via `useSyncExternalStore` in exactly the pattern this spec adopts. Its source code is a useful reference for edge cases (e.g., handling store identity changes, dealing with selector-based reads).
- **Jotai's React integration.** Another reference point. Jotai wraps its atoms in a provider that uses React contexts rather than `useSyncExternalStore` directly, because atoms have per-atom subscriptions. The `DataProvider` here is simpler — one store, one subscription per provider instance.
- **The headless renderer spec (`2026-04-13-headless-renderer-design.md`).** The authoritative source for the `ObservableDataModel` interface this spec consumes.
- **The core runtime types spec (`2026-04-13-core-runtime-types-design.md`).** The delivery spec for `ObservableDataModel`'s implementation in `@json-ui/core`. This spec depends on that one landing first.
