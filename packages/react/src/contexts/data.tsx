"use client";

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useSyncExternalStore,
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
