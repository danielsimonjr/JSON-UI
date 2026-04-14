import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it, expect, vi, afterEach } from "vitest";
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
  // Ensure spies are always restored even when a test throws (e.g. Invariant 7).
  afterEach(() => {
    vi.restoreAllMocks();
  });

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
    expect(result.current.get("/user/name")).toBe("Carol");
  });

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

    // Write via the store directly — does NOT fire onDataChange.
    onDataChange.mockClear();
    act(() => {
      store.set("/b", 2);
    });
    expect(onDataChange).not.toHaveBeenCalled();
  });

  it("does not trigger React's getSnapshot caching warning with a well-behaved store", () => {
    const store = createMockStore({ x: 1 });
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <DataProvider store={store}>{children}</DataProvider>
    );

    renderHook(() => useDataValue<number>("/x"), { wrapper });

    const cacheWarning = consoleErrorSpy.mock.calls.find((args) =>
      String(args[0] ?? "").includes("getSnapshot should be cached"),
    );
    expect(cacheWarning).toBeUndefined();

    consoleErrorSpy.mockRestore();
  });

  it("a deliberately broken store (new snapshot every call) causes React to error (Invariant 7)", () => {
    // React 19 escalates an unstable getSnapshot to "Maximum update depth
    // exceeded" rather than just logging a console warning. Both behaviours
    // (warning-only in older React or throwing in newer React) prove that the
    // broken store was detected. We accept either: a console.error whose
    // message includes "getSnapshot should be cached", OR an Error thrown.
    const brokenStore: ObservableDataModel = {
      get: () => undefined,
      set: () => {},
      delete: () => {},
      snapshot: () => ({ x: 1 }),
      subscribe: () => () => {},
    };

    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <DataProvider store={brokenStore}>{children}</DataProvider>
    );

    let threw = false;
    try {
      renderHook(() => useDataValue<number>("/x"), { wrapper });
    } catch (e) {
      // React 19: broken snapshot causes "Maximum update depth exceeded".
      // This IS the expected signal that a non-stable snapshot was detected.
      threw = true;
    }

    const cacheWarning = consoleErrorSpy.mock.calls.find((args) =>
      String(args[0] ?? "").includes("getSnapshot should be cached"),
    );

    // Either a console warning was emitted, OR React threw — both prove
    // the broken store was detected by useSyncExternalStore.
    expect(cacheWarning !== undefined || threw).toBe(true);
  });

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

  it("swapping store reference unmounts and remounts ExternalDataProvider", () => {
    const storeA = createMockStore({ which: "A" });
    const storeB = createMockStore({ which: "B" });

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

    const { rerender, getByTestId } = render(
      <DataProvider store={store}>
        <Probe />
      </DataProvider>,
    );
    expect(getByTestId("value").textContent).toBe("external");

    rerender(
      <DataProvider initialData={{ value: "internal" }}>
        <Probe />
      </DataProvider>,
    );
    expect(getByTestId("value").textContent).toBe("internal");

    rerender(
      <DataProvider store={store}>
        <Probe />
      </DataProvider>,
    );
    expect(getByTestId("value").textContent).toBe("external");

    const warnings = consoleErrorSpy.mock.calls
      .map((args) => String(args[0] ?? ""))
      .filter((msg) => /Hook|getSnapshot|useSyncExternalStore/.test(msg));
    expect(warnings).toEqual([]);

    consoleErrorSpy.mockRestore();
  });
});

describe("DataProvider — other contexts not modified (Invariant 10)", () => {
  const SIBLING_FILES = [
    "actions.tsx",
    "validation.tsx",
    "visibility.tsx",
  ] as const;

  for (const file of SIBLING_FILES) {
    it(`${file} still exists and starts with the "use client" directive (sentinel)`, () => {
      const filePath = path.join(
        process.cwd(),
        "packages/react/src/contexts",
        file,
      );
      const content = fs.readFileSync(filePath, "utf-8");
      expect(content.startsWith('"use client"')).toBe(true);
    });
  }
});
