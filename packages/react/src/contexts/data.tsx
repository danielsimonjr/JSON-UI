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
