import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderHook, act } from "@testing-library/react";
import {
  createObservableDataModel,
  createStagingBuffer,
  type IntentEvent,
} from "@json-ui/core";
import { JSONUIProvider } from "./renderer";
import { useData } from "./contexts/data";
import { useStaging, useStagingField } from "./contexts/staging";
import { useAction } from "./contexts/actions";

// Minimal registry — JSONUIProvider requires it structurally but none of
// these tests render catalog components, so an empty object is fine.
const registry = {} as never;

describe("JSONUIProvider — backward compat (no external stores)", () => {
  it("useData reads from the internal useState-backed DataProvider when no store is passed", () => {
    const { result } = renderHook(() => useData(), {
      wrapper: ({ children }) => (
        <JSONUIProvider
          registry={registry}
          initialData={{ user: { name: "Alice" } }}
        >
          {children}
        </JSONUIProvider>
      ),
    });
    expect(result.current.get("user/name")).toBe("Alice");
  });

  it("useStaging throws when no stagingStore is passed (no provider mounted)", () => {
    expect(() =>
      renderHook(() => useStaging(), {
        wrapper: ({ children }) => (
          <JSONUIProvider registry={registry}>{children}</JSONUIProvider>
        ),
      }),
    ).toThrow(/useStaging must be used within a StagingProvider/);
  });
});

describe("JSONUIProvider — external store forwarding (NC Path C, G-R2)", () => {
  it("forwards `store` to DataProvider so useData reads from the external ObservableDataModel", () => {
    // This is the exact contract NC Path C requires: a memoryjs-backed
    // adapter passed via <JSONUIProvider store={adapter}> must back the
    // useData() context, NOT a nested InternalDataProvider that shadows
    // it. Before the G-R2 fix, JSONUIProvider unconditionally rendered
    // its own <DataProvider initialData={...}> which would have been an
    // InternalDataProvider in this test — useData() would have returned
    // an empty object.
    const store = createObservableDataModel({
      user: { name: "Alice", role: "admin" },
    });

    const { result } = renderHook(() => useData(), {
      wrapper: ({ children }) => (
        <JSONUIProvider registry={registry} store={store}>
          {children}
        </JSONUIProvider>
      ),
    });

    expect(result.current.get("user/name")).toBe("Alice");
    expect(result.current.get("user/role")).toBe("admin");
  });

  it("writes through useData.set propagate to the external store (shared state)", () => {
    const store = createObservableDataModel({ counter: 0 });

    const { result } = renderHook(() => useData(), {
      wrapper: ({ children }) => (
        <JSONUIProvider registry={registry} store={store}>
          {children}
        </JSONUIProvider>
      ),
    });

    act(() => {
      result.current.set("counter", 42);
    });

    // The external store received the write.
    expect(store.get("counter")).toBe(42);
    // The context reflects it on the next render.
    expect(result.current.get("counter")).toBe(42);
  });

  it("external-mode reads reflect writes made directly to the shared store", () => {
    // The Path C primary use case: a headless renderer session writes
    // through the shared ObservableDataModel (or the orchestrator runs a
    // memoryjs transaction), and the React side re-renders automatically
    // via useSyncExternalStore.
    const store = createObservableDataModel({ message: "initial" });

    const { result } = renderHook(() => useData(), {
      wrapper: ({ children }) => (
        <JSONUIProvider registry={registry} store={store}>
          {children}
        </JSONUIProvider>
      ),
    });

    expect(result.current.get("message")).toBe("initial");

    act(() => {
      store.set("message", "updated-externally");
    });

    expect(result.current.get("message")).toBe("updated-externally");
  });

  it("silently ignores initialData when store is provided", () => {
    // The DataProvider external mode spec (Plan 2) commits to silently
    // ignoring `initialData` when `store` is present. Verify
    // JSONUIProvider honors the same commitment.
    const store = createObservableDataModel({ real: "from store" });

    const { result } = renderHook(() => useData(), {
      wrapper: ({ children }) => (
        <JSONUIProvider
          registry={registry}
          store={store}
          initialData={{ real: "from initialData — should be ignored" }}
        >
          {children}
        </JSONUIProvider>
      ),
    });

    expect(result.current.get("real")).toBe("from store");
  });

  it("forwards `stagingStore` so useStaging works inside the provider tree", () => {
    const stagingStore = createStagingBuffer();
    stagingStore.set("email", "alice@example.com");

    const { result } = renderHook(() => useStaging(), {
      wrapper: ({ children }) => (
        <JSONUIProvider registry={registry} stagingStore={stagingStore}>
          {children}
        </JSONUIProvider>
      ),
    });

    expect(result.current.getField("email")).toBe("alice@example.com");
    expect(result.current.snapshot).toEqual({ email: "alice@example.com" });
  });

  it("useStagingField writes through JSONUIProvider propagate to the shared buffer", () => {
    const stagingStore = createStagingBuffer();

    const { result } = renderHook(() => useStagingField<string>("name"), {
      wrapper: ({ children }) => (
        <JSONUIProvider registry={registry} stagingStore={stagingStore}>
          {children}
        </JSONUIProvider>
      ),
    });

    act(() => {
      result.current[1]("Daniel");
    });

    expect(stagingStore.get("name")).toBe("Daniel");
    expect(result.current[0]).toBe("Daniel");
  });

  it("accepts both `store` and `stagingStore` simultaneously for full Path C wiring", () => {
    // This is the final Path C assertion: NC mounts
    // <JSONUIProvider store={durableStore} stagingStore={staging}> and
    // gets both external contexts wired up in one mount.
    const store = createObservableDataModel({ user: { name: "Carol" } });
    const stagingStore = createStagingBuffer();
    stagingStore.set("email", "carol@example.com");

    const { result } = renderHook(
      () => ({
        data: useData(),
        staging: useStaging(),
      }),
      {
        wrapper: ({ children }) => (
          <JSONUIProvider
            registry={registry}
            store={store}
            stagingStore={stagingStore}
          >
            {children}
          </JSONUIProvider>
        ),
      },
    );

    expect(result.current.data.get("user/name")).toBe("Carol");
    expect(result.current.staging.getField("email")).toBe(
      "carol@example.com",
    );
  });

  it("forwards onIntent + catalogVersion to ActionProvider so execute() emits a full IntentEvent", async () => {
    // End-to-end Path C wiring check: NC passes `stagingStore`,
    // `onIntent`, and `catalogVersion` to JSONUIProvider; the nested
    // ActionProvider uses the same staging buffer to resolve params AND
    // snapshot state, and fires onIntent with both. This replaces the
    // ~20-line makeActionHandlers factory NC's plan Task 9 originally
    // required.
    const stagingStore = createStagingBuffer();
    stagingStore.set("email", "dan@example.com");
    const onIntent = vi.fn();

    const { result } = renderHook(
      () =>
        useAction({
          name: "submit_form",
          params: { to: { path: "email" } }, // resolves via staging
        }),
      {
        wrapper: ({ children }) => (
          <JSONUIProvider
            registry={registry}
            stagingStore={stagingStore}
            onIntent={onIntent}
            catalogVersion="nc-starter-0.1"
          >
            {children}
          </JSONUIProvider>
        ),
      },
    );

    await act(async () => {
      await result.current.execute();
    });

    expect(onIntent).toHaveBeenCalledTimes(1);
    const event = onIntent.mock.calls[0]![0] as IntentEvent;
    expect(event.action_name).toBe("submit_form");
    // DynamicValue `{path: "email"}` resolved against the shared buffer.
    expect(event.action_params).toEqual({ to: "dan@example.com" });
    // Full snapshot (not just referenced keys).
    expect(event.staging_snapshot).toEqual({ email: "dan@example.com" });
    // Catalog version threaded through.
    expect(event.catalog_version).toBe("nc-starter-0.1");
  });
});
