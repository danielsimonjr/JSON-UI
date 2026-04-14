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
