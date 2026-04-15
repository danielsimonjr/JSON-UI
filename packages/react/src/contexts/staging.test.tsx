import { describe, it, expect } from "vitest";
import React from "react";
import { renderHook, render, act } from "@testing-library/react";
import { createStagingBuffer, type UITree } from "@json-ui/core";
import {
  StagingProvider,
  useStaging,
  useStagingField,
  useStagingSnapshot,
} from "./staging";

describe("StagingProvider — internal mode", () => {
  it("creates its own buffer when no store is provided", () => {
    const { result } = renderHook(() => useStaging(), {
      wrapper: ({ children }) => <StagingProvider>{children}</StagingProvider>,
    });
    expect(result.current.snapshot).toEqual({});
  });

  it("writes and reads back a single field", () => {
    const { result } = renderHook(() => useStaging(), {
      wrapper: ({ children }) => <StagingProvider>{children}</StagingProvider>,
    });
    act(() => {
      result.current.setField("email", "a@b.c");
    });
    expect(result.current.getField("email")).toBe("a@b.c");
    expect(result.current.hasField("email")).toBe(true);
    expect(result.current.snapshot).toEqual({ email: "a@b.c" });
  });

  it("deletes a field and removes it from the snapshot", () => {
    const { result } = renderHook(() => useStaging(), {
      wrapper: ({ children }) => <StagingProvider>{children}</StagingProvider>,
    });
    act(() => {
      result.current.setField("x", 1);
      result.current.setField("y", 2);
    });
    act(() => {
      result.current.deleteField("x");
    });
    expect(result.current.hasField("x")).toBe(false);
    expect(result.current.snapshot).toEqual({ y: 2 });
  });

  it("reconciles the buffer against a set of live IDs", () => {
    const { result } = renderHook(() => useStaging(), {
      wrapper: ({ children }) => <StagingProvider>{children}</StagingProvider>,
    });
    act(() => {
      result.current.setField("a", 1);
      result.current.setField("b", 2);
      result.current.setField("c", 3);
    });
    act(() => {
      result.current.reconcile(new Set(["a", "c"]));
    });
    expect(result.current.snapshot).toEqual({ a: 1, c: 3 });
  });

  it("reconcileAgainstTree collects field IDs from the tree and drops orphans", () => {
    const { result } = renderHook(() => useStaging(), {
      wrapper: ({ children }) => <StagingProvider>{children}</StagingProvider>,
    });
    act(() => {
      result.current.setField("email", "a@b.c");
      result.current.setField("name", "Alice");
      result.current.setField("orphan", "drop me");
    });
    const tree: UITree = {
      root: "root",
      elements: {
        root: {
          key: "root",
          type: "Container",
          props: {},
          children: ["email-field", "name-field"],
        },
        "email-field": {
          key: "email-field",
          type: "TextField",
          props: { id: "email", label: "Email" },
        },
        "name-field": {
          key: "name-field",
          type: "TextField",
          props: { id: "name", label: "Name" },
        },
      },
    };
    act(() => {
      result.current.reconcileAgainstTree(tree);
    });
    expect(result.current.snapshot).toEqual({
      email: "a@b.c",
      name: "Alice",
    });
    expect(result.current.hasField("orphan")).toBe(false);
  });
});

describe("StagingProvider — external mode", () => {
  it("binds to an external StagingBuffer via useSyncExternalStore", () => {
    const buffer = createStagingBuffer();
    buffer.set("email", "pre-mount");
    const { result } = renderHook(() => useStaging(), {
      wrapper: ({ children }) => (
        <StagingProvider store={buffer}>{children}</StagingProvider>
      ),
    });
    expect(result.current.getField("email")).toBe("pre-mount");
    expect(result.current.snapshot).toEqual({ email: "pre-mount" });
  });

  it("picks up writes made directly to the shared buffer", () => {
    // This is the Path C primary use case: a headless renderer session
    // writes through the shared buffer, and the React side re-renders
    // automatically via useSyncExternalStore.
    const buffer = createStagingBuffer();
    const { result } = renderHook(() => useStaging(), {
      wrapper: ({ children }) => (
        <StagingProvider store={buffer}>{children}</StagingProvider>
      ),
    });
    act(() => {
      buffer.set("email", "written-externally");
    });
    expect(result.current.getField("email")).toBe("written-externally");
    expect(result.current.snapshot).toEqual({ email: "written-externally" });
  });

  it("writes through the context propagate to the shared buffer", () => {
    const buffer = createStagingBuffer();
    const { result } = renderHook(() => useStaging(), {
      wrapper: ({ children }) => (
        <StagingProvider store={buffer}>{children}</StagingProvider>
      ),
    });
    act(() => {
      result.current.setField("email", "via-context");
    });
    expect(buffer.get("email")).toBe("via-context");
  });

  it("two providers sharing one buffer stay in sync", () => {
    const buffer = createStagingBuffer();
    let renderCountA = 0;
    let renderCountB = 0;
    function ComponentA() {
      renderCountA++;
      const [value] = useStagingField<string>("name");
      return <span data-testid="a">{value ?? ""}</span>;
    }
    function ComponentB() {
      renderCountB++;
      const { setField } = useStaging();
      return (
        <button
          data-testid="b"
          onClick={() => setField("name", "from-b")}
        >
          set
        </button>
      );
    }
    const { getByTestId } = render(
      <>
        <StagingProvider store={buffer}>
          <ComponentA />
        </StagingProvider>
        <StagingProvider store={buffer}>
          <ComponentB />
        </StagingProvider>
      </>,
    );
    const initialA = renderCountA;
    act(() => {
      getByTestId("b").click();
    });
    expect(getByTestId("a").textContent).toBe("from-b");
    // Component A re-rendered at least once after the external write.
    expect(renderCountA).toBeGreaterThan(initialA);
  });
});

describe("useStagingField", () => {
  it("returns [undefined, setter] before the field is written", () => {
    const { result } = renderHook(() => useStagingField<string>("email"), {
      wrapper: ({ children }) => <StagingProvider>{children}</StagingProvider>,
    });
    const [value, setValue] = result.current;
    expect(value).toBeUndefined();
    expect(typeof setValue).toBe("function");
  });

  it("re-renders with the new value after setValue", () => {
    const { result } = renderHook(() => useStagingField<string>("email"), {
      wrapper: ({ children }) => <StagingProvider>{children}</StagingProvider>,
    });
    act(() => {
      result.current[1]("user@example.com");
    });
    expect(result.current[0]).toBe("user@example.com");
  });

  it("binds two fields on the same field id independently but to the same value", () => {
    // Two hooks with the same id see the same underlying state — they are
    // views, not independent state cells. Matches the DataProvider contract.
    const { result } = renderHook(
      () => ({
        a: useStagingField<string>("same"),
        b: useStagingField<string>("same"),
      }),
      {
        wrapper: ({ children }) => (
          <StagingProvider>{children}</StagingProvider>
        ),
      },
    );
    act(() => {
      result.current.a[1]("written-through-a");
    });
    expect(result.current.a[0]).toBe("written-through-a");
    expect(result.current.b[0]).toBe("written-through-a");
  });
});

describe("useStagingSnapshot", () => {
  it("returns the current snapshot and updates after writes", () => {
    const { result, rerender } = renderHook(
      () => ({
        snapshot: useStagingSnapshot(),
        staging: useStaging(),
      }),
      {
        wrapper: ({ children }) => (
          <StagingProvider>{children}</StagingProvider>
        ),
      },
    );
    expect(result.current.snapshot).toEqual({});
    act(() => {
      result.current.staging.setField("x", 1);
    });
    rerender();
    expect(result.current.snapshot).toEqual({ x: 1 });
  });
});

describe("useStaging error path", () => {
  it("throws when called outside a StagingProvider", () => {
    // renderHook inside a wrapperless context — expect useContext to be null.
    expect(() =>
      renderHook(() => useStaging()),
    ).toThrow(/useStaging must be used within a StagingProvider/);
  });
});
