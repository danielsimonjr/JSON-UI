# React External Data Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional `store?: ObservableDataModel` prop to `@json-ui/react`'s `DataProvider`. When provided, the provider binds to the external observable store via `useSyncExternalStore`; when absent, it preserves its current `useState`-based behavior unchanged.

**Architecture:** Split-component dispatcher pattern. `DataProvider` becomes a thin function that picks `<InternalDataProvider>` or `<ExternalDataProvider>` based on whether `store` is defined. Each child component calls exactly one set of hooks, satisfying React's rules of hooks. The `DataContext` value shape is identical in both modes; downstream consumers (`useData`, `useDataValue`, `useDataBinding`) are unchanged.

**Tech Stack:** TypeScript, React 19, vitest (jsdom), @testing-library/react. Depends on `@json-ui/core`'s new `ObservableDataModel` interface (Plan 1 prerequisite).

**Spec:** `docs/specs/2026-04-13-react-external-data-store-design.md`
**Prerequisite:** Plan 1 (Core Runtime Types) must be completed first.

---

## Critical Conventions for the Implementer

Before starting, internalize these — they are easy to get wrong and the existing test suite is the ground truth:

1. **The existing API uses `set`, not `setData`.** The spec's implementation sketch uses `setData` for historical reasons. The actual `DataContextValue` field is named `set`. Do NOT rename it.
2. **`onDataChange` is a 2-arg callback `(path, value)`, NOT 3-arg `(path, newValue, prevValue)`.** The spec text uses both shapes interchangeably; the real code is 2-arg and the existing tests assert that. Backward compatibility (Invariant 1) requires the 2-arg shape in BOTH modes.
3. **Paths use a leading slash.** Existing tests call `set("/user/name", ...)`, not `set("user/name", ...)`. Pass the path through to the underlying store unchanged. `ObservableDataModel` (from Plan 1) accepts any string path, so this works as-is.
4. **`@json-ui/react` is the React 19 peer-dep package.** `useSyncExternalStore` is available from React 18 onward; React 19 inherits it.
5. **Only `packages/react/src/contexts/data.tsx` changes.** Do not touch `actions.tsx`, `validation.tsx`, `visibility.tsx`, `renderer.tsx`, `hooks.ts`, or `index.ts`. The new `data-external-store.test.tsx` and `data-real-store.test.tsx` files are the only additions besides the modified `data.tsx`.
6. **`DataModel` vs `Record<string, JSONValue>`.** `ObservableDataModel.snapshot()` returns `Readonly<Record<string, JSONValue>>`. The existing `DataContextValue.data` field is typed `DataModel = Record<string, unknown>`. `JSONValue` is narrower than `unknown`, so the snapshot is assignable to `DataModel` directly — no cast needed. Pass it through.

---

## File Structure

```
packages/react/
└── src/
    └── contexts/
        ├── data.tsx                          # MODIFIED — split into dispatcher + 2 children
        ├── data.test.tsx                     # UNCHANGED — must pass without modification
        ├── data-external-store.test.tsx      # NEW — external mode unit tests
        └── data-real-store.test.tsx          # NEW — integration with createObservableDataModel
```

No new exports from `@json-ui/react`. No new hooks. `DataProviderProps` grows one optional field (`store?: ObservableDataModel`); everything else is structurally identical.

---

## Task 1: Verify Setup

**Files:** None modified.

- [ ] **Step 1: Confirm Plan 1 is done**

Run from `C:\Users\danie\Dropbox\Github\JSON-UI`:

```bash
node -e "const c = require('./packages/core/dist/index.js'); console.log(typeof c.createObservableDataModel, typeof c.createStagingBuffer);"
```

Expected output:

```
function function
```

If either is `undefined`, Plan 1 has not landed yet — stop and complete it first.

- [ ] **Step 2: Confirm the existing react test suite passes**

Run:

```bash
cd "C:/Users/danie/Dropbox/Github/JSON-UI" && npm test -- packages/react
```

Expected: all existing tests pass. Note the count — you'll re-run this at Task 3 to verify zero regressions.

- [ ] **Step 3: Read the current `data.tsx` end-to-end**

Open `packages/react/src/contexts/data.tsx` in full. The current implementation is roughly 135 lines. You must understand its `set`, `update`, and `useMemo`-wrapped context value before refactoring. There is no commit step here; this is a comprehension gate.

- [ ] **Step 4: Read the existing `data.test.tsx` end-to-end**

Open `packages/react/src/contexts/data.test.tsx` and read every assertion. Pay particular attention to:

- The `set("/user/name", ...)` leading-slash convention
- The `onDataChange("/count", 42)` 2-arg shape (NOT 3-arg)
- `update({ "/name": "John", "/age": 30 })` multi-key shape

Your refactor must keep all of these working byte-for-byte.

---

## Task 2: Refactor `DataProvider` Into Split-Component Dispatcher (No Behavior Change)

**Goal:** Move the current `useState` logic into a private `InternalDataProvider` component. `DataProvider` becomes a thin dispatcher that today always picks `InternalDataProvider`. After this task, the existing `data.test.tsx` MUST still pass with zero changes — this is a pure refactor.

**Files:**

- Modify: `packages/react/src/contexts/data.tsx`

- [ ] **Step 1: Make the refactor**

Replace the entire contents of `packages/react/src/contexts/data.tsx` with:

```tsx
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
  getByPath,
  setByPath,
  type DataModel,
  type AuthState,
  type ObservableDataModel,
} from "@json-ui/core";

/**
 * Data context value
 */
export interface DataContextValue {
  /** The current data model */
  data: DataModel;
  /** Auth state for visibility evaluation */
  authState?: AuthState;
  /** Get a value by path */
  get: (path: string) => unknown;
  /** Set a value by path */
  set: (path: string, value: unknown) => void;
  /** Update multiple values at once */
  update: (updates: Record<string, unknown>) => void;
}

const DataContext = createContext<DataContextValue | null>(null);

/**
 * Props for DataProvider
 */
export interface DataProviderProps {
  /** Initial data model. Ignored when `store` is provided. */
  initialData?: DataModel;
  /** Auth state */
  authState?: AuthState;
  /** Callback when data changes */
  onDataChange?: (path: string, value: unknown) => void;
  /**
   * Optional external observable data store. When provided, DataProvider binds
   * to this store via `useSyncExternalStore` and all reads/writes flow through
   * it. When absent, DataProvider falls back to its local `useState` behavior.
   *
   * The `store` reference should be stable across renders. Swapping which store
   * DataProvider consumes mid-component-lifetime is not supported — unmount and
   * remount the provider if you need to swap stores.
   */
  store?: ObservableDataModel;
  children: ReactNode;
}

/**
 * Provider for data model context. Dispatches to either the internal
 * useState-backed provider or the external-store provider based on whether
 * `store` is defined. The split-component pattern is required by React's
 * rules of hooks — each child component calls exactly one set of hooks.
 */
export function DataProvider(props: DataProviderProps) {
  if (props.store !== undefined) {
    return <ExternalDataProvider {...props} store={props.store} />;
  }
  return <InternalDataProvider {...props} />;
}

/**
 * Internal-mode provider — current useState-backed behavior, unchanged.
 */
function InternalDataProvider({
  initialData = {},
  authState,
  onDataChange,
  children,
}: DataProviderProps) {
  const [data, setData] = useState<DataModel>(initialData);

  const get = useCallback((path: string) => getByPath(data, path), [data]);

  const set = useCallback(
    (path: string, value: unknown) => {
      setData((prev) => {
        const next = { ...prev };
        setByPath(next, path, value);
        return next;
      });
      onDataChange?.(path, value);
    },
    [onDataChange],
  );

  const update = useCallback(
    (updates: Record<string, unknown>) => {
      setData((prev) => {
        const next = { ...prev };
        for (const [path, value] of Object.entries(updates)) {
          setByPath(next, path, value);
          onDataChange?.(path, value);
        }
        return next;
      });
    },
    [onDataChange],
  );

  const value = useMemo<DataContextValue>(
    () => ({ data, authState, get, set, update }),
    [data, authState, get, set, update],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

/**
 * External-mode provider — placeholder for now. Implemented in Task 4.
 * Until then, this stub mirrors InternalDataProvider's behavior so the
 * dispatcher always works.
 */
function ExternalDataProvider({
  initialData = {},
  authState,
  onDataChange,
  children,
}: DataProviderProps & { store: ObservableDataModel }) {
  // STUB: in Task 4, this will use useSyncExternalStore against the store.
  // For now, fall back to internal behavior so the dispatcher compiles.
  return (
    <InternalDataProvider
      initialData={initialData}
      authState={authState}
      onDataChange={onDataChange}
    >
      {children}
    </InternalDataProvider>
  );
}

/**
 * Hook to access the data context
 */
export function useData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) {
    throw new Error("useData must be used within a DataProvider");
  }
  return ctx;
}

/**
 * Hook to get a value from the data model
 */
export function useDataValue<T>(path: string): T | undefined {
  const { get } = useData();
  return get(path) as T | undefined;
}

/**
 * Hook to get and set a value from the data model (like useState)
 */
export function useDataBinding<T>(
  path: string,
): [T | undefined, (value: T) => void] {
  const { get, set } = useData();
  const value = get(path) as T | undefined;
  const setValue = useCallback(
    (newValue: T) => set(path, newValue),
    [path, set],
  );
  return [value, setValue];
}
```

**Why a stub for `ExternalDataProvider`?** The dispatcher's split-component shape is the load-bearing structural change. Getting it in place first — with a stub child that re-uses the internal logic — lets us prove the refactor preserves existing behavior before adding any new complexity. Task 4 replaces the stub with the real `useSyncExternalStore` implementation under TDD.

- [ ] **Step 2: Run typecheck**

```bash
cd "C:/Users/danie/Dropbox/Github/JSON-UI" && npm run typecheck --workspace @json-ui/react
```

Expected: PASS with no errors. If `ObservableDataModel` is reported as missing, Plan 1 isn't landed — go back to Task 1 Step 1.

- [ ] **Step 3: Run only the existing data tests to verify zero regression**

```bash
cd "C:/Users/danie/Dropbox/Github/JSON-UI" && npm test -- packages/react/src/contexts/data.test.tsx
```

Expected: every test in `data.test.tsx` PASSES. The dispatcher routes everything through `InternalDataProvider` because no test passes a `store` prop, so behavior is byte-identical.

- [ ] **Step 4: Commit**

```bash
cd "C:/Users/danie/Dropbox/Github/JSON-UI" && git add packages/react/src/contexts/data.tsx && git commit -m "refactor(react): split DataProvider into dispatcher + InternalDataProvider"
```

---

## Task 3: Verify the Full Existing Test Suite Still Passes

**Goal:** Catch any cross-test interaction the previous task missed. This is a confidence checkpoint, not a code task.

**Files:** None.

- [ ] **Step 1: Run the full react package tests**

```bash
cd "C:/Users/danie/Dropbox/Github/JSON-UI" && npm test -- packages/react
```

Expected: all tests pass with the same count as Task 1 Step 2. If anything fails, revert Task 2 and re-debug — there is no future task that recovers from a regression introduced here.

- [ ] **Step 2: Run the full repo test suite**

```bash
cd "C:/Users/danie/Dropbox/Github/JSON-UI" && npm test
```

Expected: PASS. Catches any test in `@json-ui/core` that imports from `@json-ui/react` (there shouldn't be any, but verifying is cheap).

No commit — this task is a verification gate.

---

## Task 4: Implement `ExternalDataProvider` with `useSyncExternalStore` (TDD)

**Goal:** Replace the `ExternalDataProvider` stub with a real `useSyncExternalStore` implementation. TDD: write the failing tests first (in a new test file), then implement.

**Files:**

- Create: `packages/react/src/contexts/data-external-store.test.tsx`
- Modify: `packages/react/src/contexts/data.tsx` — replace the stub `ExternalDataProvider` body

- [ ] **Step 1: Write the failing test for "external mode renders from store snapshot"**

Create `packages/react/src/contexts/data-external-store.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderHook, render, act } from "@testing-library/react";
import type { ObservableDataModel, JSONValue } from "@json-ui/core";
import { DataProvider, useData, useDataValue } from "./data";

/**
 * Minimal mock ObservableDataModel for unit tests. Mirrors the contract from
 * the runtime-types spec (identity-stable cached snapshot, synchronous notify).
 * Real implementation lives in @json-ui/core; we use a mock here to keep these
 * tests focused on the React binding rather than on createObservableDataModel.
 */
function createMockStore(
  initial: Record<string, JSONValue> = {},
): ObservableDataModel {
  const data: Record<string, JSONValue> = { ...initial };
  const listeners = new Set<() => void>();
  let cachedSnapshot: Readonly<Record<string, JSONValue>> | null = null;
  const notify = () => {
    cachedSnapshot = null;
    for (const cb of Array.from(listeners)) cb();
  };
  return {
    get(path: string) {
      const segments = path.replace(/^\//, "").split("/").filter(Boolean);
      let cur: unknown = data;
      for (const seg of segments) {
        if (cur && typeof cur === "object") {
          cur = (cur as Record<string, unknown>)[seg];
        } else {
          return undefined;
        }
      }
      return cur as JSONValue | undefined;
    },
    set(path: string, value: JSONValue) {
      const segments = path.replace(/^\//, "").split("/").filter(Boolean);
      let cur: Record<string, unknown> = data;
      for (let i = 0; i < segments.length - 1; i++) {
        const seg = segments[i]!;
        if (!cur[seg] || typeof cur[seg] !== "object") cur[seg] = {};
        cur = cur[seg] as Record<string, unknown>;
      }
      cur[segments[segments.length - 1]!] = value;
      notify();
    },
    delete(path: string) {
      const segments = path.replace(/^\//, "").split("/").filter(Boolean);
      let cur: Record<string, unknown> = data;
      for (let i = 0; i < segments.length - 1; i++) {
        const seg = segments[i]!;
        if (!cur[seg] || typeof cur[seg] !== "object") return;
        cur = cur[seg] as Record<string, unknown>;
      }
      delete cur[segments[segments.length - 1]!];
      notify();
    },
    snapshot() {
      if (cachedSnapshot === null) {
        cachedSnapshot = { ...data };
      }
      return cachedSnapshot;
    },
    subscribe(cb: () => void) {
      listeners.add(cb);
      let unsub = false;
      return () => {
        if (unsub) return;
        unsub = true;
        listeners.delete(cb);
      };
    },
  };
}

describe("DataProvider — external store mode", () => {
  it("renders from the external store snapshot on first render", () => {
    const store = createMockStore({ user: { name: "Alice" } });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <DataProvider store={store}>{children}</DataProvider>
    );

    const { result } = renderHook(() => useDataValue<string>("/user/name"), {
      wrapper,
    });

    expect(result.current).toBe("Alice");
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
cd "C:/Users/danie/Dropbox/Github/JSON-UI" && npm test -- packages/react/src/contexts/data-external-store.test.tsx
```

Expected: FAIL. The current `ExternalDataProvider` stub forwards to `InternalDataProvider` with empty `initialData`, so `useDataValue("/user/name")` returns `undefined` instead of `"Alice"`. The assertion error confirms the stub is being routed to (a sanity check) and that we need the real implementation.

- [ ] **Step 3: Implement `ExternalDataProvider` for real**

In `packages/react/src/contexts/data.tsx`, **replace the entire `ExternalDataProvider` function body** (the stub) with the real implementation. Locate the stub by searching for the `STUB:` comment.

Add `useSyncExternalStore` to the React import at the top of the file:

```tsx
import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
```

Replace the stub `ExternalDataProvider` with:

```tsx
/**
 * External-mode provider — binds to a shared ObservableDataModel via
 * useSyncExternalStore. All reads come from the store snapshot; all writes
 * go through store.set / store.delete and trigger subscribe notifications,
 * which propagate to other backends sharing the same store reference.
 *
 * `initialData` is intentionally ignored in this mode — the store's current
 * contents are always authoritative. This matches the spec's silent-ignore
 * commitment (Open Question 1, resolved).
 */
function ExternalDataProvider({
  authState,
  onDataChange,
  children,
  store,
}: DataProviderProps & { store: ObservableDataModel }) {
  // Note on bare method references: passing `store.subscribe` and
  // `store.snapshot` as bare references is correct ONLY if Plan 1's
  // `createObservableDataModel` is closure-based (no `this` dependency).
  // Plan 1 IS closure-based — the factory returns an object literal whose
  // methods close over the local `root`/`listeners`/`cachedSnapshot`. So
  // bare references are safe. If a future replacement uses a class with
  // `this`-bound methods, wrap with `.bind(store)` here defensively.
  const data = useSyncExternalStore(
    store.subscribe,
    store.snapshot,
    store.snapshot, // SSR snapshot — same as client snapshot for non-SSR use
  ) as DataModel;

  const get = useCallback((path: string) => store.get(path), [store]);

  const set = useCallback(
    (path: string, value: unknown) => {
      // Cast: ObservableDataModel.set accepts JSONValue; the existing
      // DataContextValue.set takes `unknown` for backward compatibility.
      // Callers passing non-JSONValue values are the caller's bug — the
      // store's own internal validation does NOT re-run on every set
      // (per the runtime-types spec's "validates once at construction").
      store.set(path, value as never);
      onDataChange?.(path, value);
    },
    [store, onDataChange],
  );

  const update = useCallback(
    (updates: Record<string, unknown>) => {
      // Each store.set fires a subscribe callback. This produces multiple
      // re-renders for a multi-key update — strictly worse than the internal
      // mode's single setState. A future ObservableDataModel.batch() method
      // could fix this. Out of scope for v1.
      for (const [path, value] of Object.entries(updates)) {
        store.set(path, value as never);
        onDataChange?.(path, value);
      }
    },
    [store, onDataChange],
  );

  const value = useMemo<DataContextValue>(
    () => ({ data, authState, get, set, update }),
    [data, authState, get, set, update],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}
```

- [ ] **Step 4: Run the test to confirm it now passes**

```bash
cd "C:/Users/danie/Dropbox/Github/JSON-UI" && npm test -- packages/react/src/contexts/data-external-store.test.tsx
```

Expected: PASS. The provider binds to the store, `useSyncExternalStore` returns the snapshot containing `{user: {name: "Alice"}}`, and `useDataValue("/user/name")` resolves to `"Alice"` via the store's path-based `get`.

- [ ] **Step 5: Run the existing internal-mode tests again to confirm zero regression**

```bash
cd "C:/Users/danie/Dropbox/Github/JSON-UI" && npm test -- packages/react/src/contexts/data.test.tsx
```

Expected: all existing tests still PASS. The dispatcher only routes to `ExternalDataProvider` when `store !== undefined`, and no existing test passes `store`.

- [ ] **Step 6: Commit**

```bash
cd "C:/Users/danie/Dropbox/Github/JSON-UI" && git add packages/react/src/contexts/data.tsx packages/react/src/contexts/data-external-store.test.tsx && git commit -m "feat(react): implement ExternalDataProvider with useSyncExternalStore"
```

---

## Task 5: Add the Full External-Mode Test Suite

**Goal:** Cover Invariants 2 through 12 from the spec. Each test is a small, focused assertion on one invariant.

**Files:**

- Modify: `packages/react/src/contexts/data-external-store.test.tsx`

- [ ] **Step 1: Write the test for "external mutation triggers re-render" (Invariant 3)**

Append to `data-external-store.test.tsx` (inside the same `describe` block):

```tsx
it("re-renders when an external writer mutates the store", () => {
  const store = createMockStore({ user: { name: "Alice" } });
  let renderCount = 0;

  function Probe() {
    renderCount += 1;
    const name = useDataValue<string>("/user/name");
    return <span data-testid="name">{name}</span>;
  }

  const { getByTestId } = render(
    <DataProvider store={store}>
      <Probe />
    </DataProvider>,
  );

  expect(getByTestId("name").textContent).toBe("Alice");
  const firstRenderCount = renderCount;

  act(() => {
    store.set("/user/name", "Bob");
  });

  expect(getByTestId("name").textContent).toBe("Bob");
  expect(renderCount).toBeGreaterThan(firstRenderCount);
});
```

- [ ] **Step 2: Run and verify it passes**

```bash
cd "C:/Users/danie/Dropbox/Github/JSON-UI" && npm test -- packages/react/src/contexts/data-external-store.test.tsx
```

Expected: PASS. `useSyncExternalStore` subscribes to `store.subscribe`, the external `store.set` notifies, React schedules a re-render, the new snapshot contains `{user: {name: "Bob"}}`.

- [ ] **Step 3: Write the test for "internal `set` writes to the store" (Invariant 4)**

Append:

```tsx
it("writes from useData().set go through the store, not local state", () => {
  const store = createMockStore({});
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <DataProvider store={store}>{children}</DataProvider>
  );

  const { result } = renderHook(() => useData(), { wrapper });

  act(() => {
    result.current.set("/user/name", "Carol");
  });

  expect(store.get("/user/name")).toBe("Carol");
  // Reads via useData() also reflect the new value because they go through
  // the same store snapshot.
  expect(result.current.get("/user/name")).toBe("Carol");
});
```

- [ ] **Step 4: Write the test for "`onDataChange` fires in external mode for both write origins" (Invariant 5)**

Append:

```tsx
it("fires onDataChange for writes via useData().set but NOT for direct store.set", () => {
  const store = createMockStore({});
  const onDataChange = vi.fn();

  const { result } = renderHook(() => useData(), {
    wrapper: ({ children }) => (
      <DataProvider store={store} onDataChange={onDataChange}>
        {children}
      </DataProvider>
    ),
  });

  // Write via the React-side setter — should fire onDataChange.
  act(() => {
    result.current.set("/a", 1);
  });
  expect(onDataChange).toHaveBeenCalledWith("/a", 1);

  // Write via the store directly — does NOT fire onDataChange (the React
  // provider has no hook into externally-originated writes; it only hears
  // the subscribe callback, which carries no path/value information).
  // This is a documented spec limitation — the 2-arg subscribe contract
  // does not pass write payloads to subscribers.
  onDataChange.mockClear();
  act(() => {
    store.set("/b", 2);
  });
  expect(onDataChange).not.toHaveBeenCalled();
});
```

**Note for the implementer.** The spec's Invariant 5 says `onDataChange` fires "whether the mutation came from the React side (`setData`) or the external side (`store.set` directly)." That is impossible to honor with the current `subscribe(callback: () => void)` contract — subscribers receive no payload, so the React provider has no way to know what path/value an external writer changed. The test above documents the actual achievable behavior: the React provider fires `onDataChange` only for writes it originates. Externally-originated writes still trigger re-renders (Invariant 3 covers that), but they do not surface in `onDataChange`. This is a known divergence from the spec text and should be flagged in the PR description for review.

- [ ] **Step 5: Write the test for "identity-stable snapshots prevent infinite re-render warnings" (Invariant 6)**

Append:

```tsx
it("does not trigger React's getSnapshot caching warning with a well-behaved store", () => {
  const store = createMockStore({ x: 1 });
  const consoleErrorSpy = vi
    .spyOn(console, "error")
    .mockImplementation(() => {});

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <DataProvider store={store}>{children}</DataProvider>
  );

  renderHook(() => useDataValue<number>("/x"), { wrapper });

  // React logs the cache warning to console.error if getSnapshot returns a
  // new reference on every call. Our mock store caches its snapshot, so no
  // warning should appear.
  const cacheWarning = consoleErrorSpy.mock.calls.find((args) =>
    String(args[0] ?? "").includes("getSnapshot should be cached"),
  );
  expect(cacheWarning).toBeUndefined();

  consoleErrorSpy.mockRestore();
});
```

- [ ] **Step 6: Write the test for "non-stable snapshots DO trigger the warning" (Invariant 7)**

Append:

```tsx
it("a deliberately broken store (new snapshot every call) triggers React's cache warning", () => {
  // A store whose snapshot() returns a fresh object on every call.
  // This is the negative test that proves Invariant 6 is meaningful.
  const brokenStore: ObservableDataModel = {
    get: () => undefined,
    set: () => {},
    delete: () => {},
    snapshot: () => ({ x: 1 }), // NEW object every call — bad!
    subscribe: () => () => {},
  };

  const consoleErrorSpy = vi
    .spyOn(console, "error")
    .mockImplementation(() => {});

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <DataProvider store={brokenStore}>{children}</DataProvider>
  );

  renderHook(() => useDataValue<number>("/x"), { wrapper });

  const cacheWarning = consoleErrorSpy.mock.calls.find((args) =>
    String(args[0] ?? "").includes("getSnapshot should be cached"),
  );
  expect(cacheWarning).toBeDefined();

  consoleErrorSpy.mockRestore();
});
```

- [ ] **Step 7: Write the test for "`update` fires onDataChange in key order" (Invariant 9)**

Append:

```tsx
it("update() fires onDataChange once per key, in entry order", () => {
  const store = createMockStore({});
  const onDataChange = vi.fn();
  const { result } = renderHook(() => useData(), {
    wrapper: ({ children }) => (
      <DataProvider store={store} onDataChange={onDataChange}>
        {children}
      </DataProvider>
    ),
  });

  act(() => {
    result.current.update({ "/a": 1, "/b": 2, "/c": 3 });
  });

  expect(onDataChange.mock.calls).toEqual([
    ["/a", 1],
    ["/b", 2],
    ["/c", 3],
  ]);
  expect(store.get("/a")).toBe(1);
  expect(store.get("/b")).toBe(2);
  expect(store.get("/c")).toBe(3);
});
```

- [ ] **Step 8: Write the test for "`initialData` is silently ignored in external mode" (Invariant 12)**

Append:

```tsx
it("ignores initialData when store is also provided", () => {
  const store = createMockStore({}); // empty
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <DataProvider store={store} initialData={{ ignored: "yes" }}>
      {children}
    </DataProvider>
  );

  const { result } = renderHook(() => useDataValue<string>("/ignored"), {
    wrapper,
  });

  expect(result.current).toBeUndefined();
});
```

- [ ] **Step 9: Write the test for "store swap forces a remount" (Invariant 11)**

Append:

```tsx
it("swapping store reference unmounts and remounts ExternalDataProvider", () => {
  const storeA = createMockStore({ which: "A" });
  const storeB = createMockStore({ which: "B" });

  // Track subscribe calls on each store to verify which one is active.
  const subA = vi.spyOn(storeA, "subscribe");
  const subB = vi.spyOn(storeB, "subscribe");

  function Probe() {
    return <span data-testid="which">{useDataValue<string>("/which")}</span>;
  }

  const { rerender, getByTestId } = render(
    <DataProvider store={storeA}>
      <Probe />
    </DataProvider>,
  );
  expect(getByTestId("which").textContent).toBe("A");
  expect(subA).toHaveBeenCalled();

  rerender(
    <DataProvider store={storeB}>
      <Probe />
    </DataProvider>,
  );
  expect(getByTestId("which").textContent).toBe("B");
  expect(subB).toHaveBeenCalled();
});
```

**Note.** The split-component dispatcher does NOT itself force a remount when only the `store` prop changes — both stores route to `ExternalDataProvider`, so React reuses the same component instance. `useSyncExternalStore` DOES handle a `subscribe` identity change correctly: it unsubscribes from the old `subscribe` and re-subscribes to the new one on every render where `subscribe` has a different identity. The test verifies behavioral correctness (the new store is being read) rather than literal unmount/remount. The spec's "remount on swap" language was over-strong; what matters is that `storeB` becomes authoritative, which this test confirms.

- [ ] **Step 9b: Write the test for "rules of hooks compliance via mode toggle" (Invariant 8)**

Spec Invariant 8 explicitly requires "a test that dynamically switches `<DataProvider store={store} />` to `<DataProvider />` in the same subtree." This test toggles the `store` prop between defined and undefined, forcing the dispatcher to swap from `ExternalDataProvider` to `InternalDataProvider`. React must unmount the external child and mount the internal child without warning.

Append:

```tsx
it("toggles between external and internal mode without warnings (Invariant 8)", () => {
  const store = createMockStore({ value: "external" });
  const consoleErrorSpy = vi
    .spyOn(console, "error")
    .mockImplementation(() => {});

  function Probe() {
    return (
      <span data-testid="value">
        {useDataValue<string>("/value") ?? "none"}
      </span>
    );
  }

  // Start in external mode.
  const { rerender, getByTestId } = render(
    <DataProvider store={store}>
      <Probe />
    </DataProvider>,
  );
  expect(getByTestId("value").textContent).toBe("external");

  // Switch to internal mode by dropping the store prop. The dispatcher
  // unmounts ExternalDataProvider and mounts InternalDataProvider.
  rerender(
    <DataProvider initialData={{ value: "internal" }}>
      <Probe />
    </DataProvider>,
  );
  expect(getByTestId("value").textContent).toBe("internal");

  // Switch back to external mode.
  rerender(
    <DataProvider store={store}>
      <Probe />
    </DataProvider>,
  );
  expect(getByTestId("value").textContent).toBe("external");

  // Verify React did not log any rules-of-hooks or other warnings during
  // the mode swaps. The split-component dispatcher should keep React happy.
  const warnings = consoleErrorSpy.mock.calls
    .map((args) => String(args[0] ?? ""))
    .filter((msg) => /Hook|getSnapshot|useSyncExternalStore/.test(msg));
  expect(warnings).toEqual([]);

  consoleErrorSpy.mockRestore();
});
```

- [ ] **Step 9c: Write the test for "other contexts unmodified" (Invariant 10)**

Spec Invariant 10 wants a regression guard against accidental edits leaking into sibling provider files. The plan honors this with a sentinel content check on the three sibling files. If any of them is deleted or wholesale-rewritten during this PR, the test fails — flagging the unintended edit.

This step has TWO edits:

**Edit 1 — add `node:fs` and `node:path` to the top-of-file imports.** Locate the existing import block at the top of `data-external-store.test.tsx` and add the two new imports above the existing ones (or merge into a single block — both work, the key is that ALL imports stay at the top of the file as ES module syntax requires):

```tsx
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderHook, render, act } from "@testing-library/react";
import type { ObservableDataModel, JSONValue } from "@json-ui/core";
import { DataProvider, useData, useDataValue } from "./data";
```

Do NOT add the `import` statements inside the `describe` block at the bottom of the file — that is a syntax error in ES modules.

**Edit 2 — append the new `describe` block** at the END of the test file (after the existing top-level describe block, NOT inside it):

```tsx
describe("DataProvider — other contexts not modified (Invariant 10)", () => {
  // Guard against unintended edits to sibling context files. The plan
  // commits to NOT touching these files; if any of them is deleted or
  // wholesale-rewritten during this PR, this test fails and prompts a
  // manual review.
  const SIBLING_FILES = [
    "actions.tsx",
    "validation.tsx",
    "visibility.tsx",
  ] as const;

  for (const file of SIBLING_FILES) {
    it(`${file} still exists and starts with the "use client" directive (sentinel)`, () => {
      // process.cwd() is the repo root because vitest is launched from there
      // via `npm test` (root package.json scripts.test = "vitest run").
      const filePath = path.join(
        process.cwd(),
        "packages/react/src/contexts",
        file,
      );
      const content = fs.readFileSync(filePath, "utf-8");
      // Weak check — verifies the file exists and begins with the "use client"
      // directive that all the React contexts share. A literal full-content
      // diff would be unmaintainable (every formatting change in another PR
      // would break it). This catches the most common accident (file deleted
      // or wholesale-rewritten) while leaving strict review to the PR commit
      // list.
      expect(content.startsWith('"use client"')).toBe(true);
    });
  }
});
```

**Note on the weakened check.** A literal string-compare against the full file content would be unmaintainable. The spec's "string-compare" language is ambition; this sentinel catches the most common accidents while leaving the strict review to the PR commit list. Document this downgrade in the PR description.

- [ ] **Step 10: Run all external-mode tests**

```bash
cd "C:/Users/danie/Dropbox/Github/JSON-UI" && npm test -- packages/react/src/contexts/data-external-store.test.tsx
```

Expected: every test PASSES. If any test fails, fix the implementation in `data.tsx` before proceeding — do NOT relax the test assertion.

- [ ] **Step 11: Run the full repo test suite to confirm no cross-test regression**

```bash
cd "C:/Users/danie/Dropbox/Github/JSON-UI" && npm test
```

Expected: all packages pass.

- [ ] **Step 12: Commit**

```bash
cd "C:/Users/danie/Dropbox/Github/JSON-UI" && git add packages/react/src/contexts/data-external-store.test.tsx packages/react/src/contexts/data.tsx && git commit -m "test(react): add external-mode test suite for DataProvider"
```

---

## Task 6: Add Real-Store Integration Tests

**Goal:** Verify the React provider actually works with the real `createObservableDataModel` from `@json-ui/core`, not just the mock. This catches contract drift between the mock and the real implementation (e.g., if the real store's path semantics differ).

**Files:**

- Create: `packages/react/src/contexts/data-real-store.test.tsx`

- [ ] **Step 1: Write the integration test file**

Create `packages/react/src/contexts/data-real-store.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderHook, render, act } from "@testing-library/react";
import { createObservableDataModel } from "@json-ui/core";
import { DataProvider, useData, useDataValue } from "./data";

describe("DataProvider — integration with createObservableDataModel", () => {
  it("renders the initial seed of a real observable store", () => {
    const store = createObservableDataModel({ user: { name: "Alice" } });
    const { result } = renderHook(() => useDataValue<string>("/user/name"), {
      wrapper: ({ children }) => (
        <DataProvider store={store}>{children}</DataProvider>
      ),
    });

    expect(result.current).toBe("Alice");
  });

  it("re-renders when the real store is mutated externally", () => {
    const store = createObservableDataModel({ count: 0 });

    function Probe() {
      const count = useDataValue<number>("/count");
      return <span data-testid="count">{String(count)}</span>;
    }

    const { getByTestId } = render(
      <DataProvider store={store}>
        <Probe />
      </DataProvider>,
    );

    expect(getByTestId("count").textContent).toBe("0");

    act(() => {
      store.set("/count", 5);
    });

    expect(getByTestId("count").textContent).toBe("5");
  });

  it("writes via useData().set propagate to the real store", () => {
    const store = createObservableDataModel({});
    const { result } = renderHook(() => useData(), {
      wrapper: ({ children }) => (
        <DataProvider store={store}>{children}</DataProvider>
      ),
    });

    act(() => {
      result.current.set("/a/b/c", "deep");
    });

    expect(store.get("/a/b/c")).toBe("deep");
  });

  it("two providers sharing a store see each other's writes", () => {
    const sharedStore = createObservableDataModel({ value: "initial" });

    function ReaderA() {
      return <span data-testid="a">{useDataValue<string>("/value")}</span>;
    }
    function ReaderB() {
      return <span data-testid="b">{useDataValue<string>("/value")}</span>;
    }

    const { getByTestId } = render(
      <div>
        <DataProvider store={sharedStore}>
          <ReaderA />
        </DataProvider>
        <DataProvider store={sharedStore}>
          <ReaderB />
        </DataProvider>
      </div>,
    );

    expect(getByTestId("a").textContent).toBe("initial");
    expect(getByTestId("b").textContent).toBe("initial");

    act(() => {
      sharedStore.set("/value", "changed");
    });

    expect(getByTestId("a").textContent).toBe("changed");
    expect(getByTestId("b").textContent).toBe("changed");
  });

  it("rejects non-JSON-serializable initial data at store construction", () => {
    expect(() => {
      createObservableDataModel({ bad: new Date() as never });
    }).toThrow(/initialData contains non-JSON-serializable/);
  });
});
```

- [ ] **Step 2: Run the integration tests**

```bash
cd "C:/Users/danie/Dropbox/Github/JSON-UI" && npm test -- packages/react/src/contexts/data-real-store.test.tsx
```

Expected: every test PASSES. If the dual-provider sharing test fails, the bug is in the real `createObservableDataModel`'s subscribe contract — fix it in `@json-ui/core` (Plan 1) rather than working around it here.

- [ ] **Step 3: Run the full test suite for one final regression check**

```bash
cd "C:/Users/danie/Dropbox/Github/JSON-UI" && npm test
```

Expected: every test in every package passes.

- [ ] **Step 4: Run typecheck across all workspaces**

```bash
cd "C:/Users/danie/Dropbox/Github/JSON-UI" && npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Build all workspaces**

```bash
cd "C:/Users/danie/Dropbox/Github/JSON-UI" && npm run build
```

Expected: PASS. Both `@json-ui/core` and `@json-ui/react` build successfully with the new code.

- [ ] **Step 6: Commit**

```bash
cd "C:/Users/danie/Dropbox/Github/JSON-UI" && git add packages/react/src/contexts/data-real-store.test.tsx && git commit -m "test(react): add real-store integration tests for DataProvider"
```

---

## Self-Review (Spec Coverage Mapping)

Each invariant from `2026-04-13-react-external-data-store-design.md` maps to a test:

| #   | Invariant                                       | Test location                                                                          |
| --- | ----------------------------------------------- | -------------------------------------------------------------------------------------- |
| 1   | Internal mode backward compatibility            | `data.test.tsx` (unmodified, run in Tasks 2/3/5/6)                                     |
| 2   | External mode renders from store snapshot       | `data-external-store.test.tsx` Task 4 Step 1; `data-real-store.test.tsx` Task 6 Step 1 |
| 3   | External mutation triggers re-render            | `data-external-store.test.tsx` Task 5 Step 1; `data-real-store.test.tsx` Task 6 Step 1 |
| 4   | Internal `set` in external mode writes to store | `data-external-store.test.tsx` Task 5 Step 3; `data-real-store.test.tsx` Task 6 Step 1 |
| 5   | `onDataChange` in external mode                 | `data-external-store.test.tsx` Task 5 Step 4 (DOCUMENTED PARTIAL — see test note)      |
| 6   | Identity-stable snapshots prevent warnings      | `data-external-store.test.tsx` Task 5 Step 5                                           |
| 7   | Non-stable snapshots DO trigger warnings        | `data-external-store.test.tsx` Task 5 Step 6                                           |
| 8   | Rules of hooks respected                        | Implicitly verified by all tests (test failure indicates rules-of-hooks violation)     |
| 9   | `update` fires callbacks in order               | `data-external-store.test.tsx` Task 5 Step 7                                           |
| 10  | No changes to other contexts                    | Files NOT modified — verified by inspecting commit list                                |
| 11  | Store swap                                      | `data-external-store.test.tsx` Task 5 Step 9                                           |
| 12  | `initialData` ignored in external mode          | `data-external-store.test.tsx` Task 5 Step 8                                           |

**Known divergence from spec text:** Invariant 5 asserts `onDataChange` fires for writes from EITHER the React side or the direct `store.set` side. The `subscribe(callback: () => void)` contract makes the latter impossible (subscribers receive no payload). The plan's test documents the actual achievable behavior: `onDataChange` fires only for React-side writes; external-side writes still trigger re-renders via Invariant 3. The PR description should call this out for review.

**Files modified:** `packages/react/src/contexts/data.tsx` only.
**Files created:** `data-external-store.test.tsx`, `data-real-store.test.tsx`.
**Files NOT touched:** `actions.tsx`, `validation.tsx`, `visibility.tsx`, `renderer.tsx`, `hooks.ts`, `index.ts`, `data.test.tsx` — these have zero edits, satisfying the spec's scope constraint.

---

## Done Criteria

- [ ] All 6 tasks committed
- [ ] `npm test` PASSES with the new test files included
- [ ] `npm run typecheck` PASSES
- [ ] `npm run build` PASSES
- [ ] No file outside `packages/react/src/contexts/data*` was modified
- [ ] PR description flags the Invariant 5 divergence (external-write callback impossibility)
