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
