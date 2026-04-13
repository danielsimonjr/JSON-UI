import { describe, test, expect, vi } from "vitest";
import {
  createStagingBuffer,
  type StagingBuffer,
  type FieldId,
  type JSONValue,
} from "./runtime";

describe("createStagingBuffer - basic operations", () => {
  test("creates a buffer with all interface methods", () => {
    const buf: StagingBuffer = createStagingBuffer();
    expect(typeof buf.get).toBe("function");
    expect(typeof buf.set).toBe("function");
    expect(typeof buf.delete).toBe("function");
    expect(typeof buf.has).toBe("function");
    expect(typeof buf.snapshot).toBe("function");
    expect(typeof buf.reconcile).toBe("function");
    expect(typeof buf.subscribe).toBe("function");
  });
});

describe("createStagingBuffer - get/set/delete/has", () => {
  test("get returns undefined for absent field", () => {
    const buf = createStagingBuffer();
    expect(buf.get("missing")).toBeUndefined();
  });
  test("set stores a value retrievable by get", () => {
    const buf = createStagingBuffer();
    buf.set("name", "Alice");
    expect(buf.get("name")).toBe("Alice");
  });
  test("has returns true for set fields, false otherwise", () => {
    const buf = createStagingBuffer();
    buf.set("x", 1);
    expect(buf.has("x")).toBe(true);
    expect(buf.has("y")).toBe(false);
  });
  test("delete removes a field", () => {
    const buf = createStagingBuffer();
    buf.set("x", 1);
    buf.delete("x");
    expect(buf.has("x")).toBe(false);
    expect(buf.get("x")).toBeUndefined();
  });
});

describe("createStagingBuffer - snapshot identity stability", () => {
  test("two back-to-back snapshot calls return the same reference", () => {
    const buf = createStagingBuffer();
    buf.set("x", 1);
    const a = buf.snapshot();
    const b = buf.snapshot();
    expect(a).toBe(b);
  });
  test("snapshot reference changes after set", () => {
    const buf = createStagingBuffer();
    buf.set("x", 1);
    const before = buf.snapshot();
    buf.set("y", 2);
    const after = buf.snapshot();
    expect(after).not.toBe(before);
  });
  test("snapshot reference changes after delete", () => {
    const buf = createStagingBuffer();
    buf.set("x", 1);
    const before = buf.snapshot();
    buf.delete("x");
    const after = buf.snapshot();
    expect(after).not.toBe(before);
  });
  test("snapshot reference changes after reconcile, even if nothing dropped", () => {
    const buf = createStagingBuffer();
    buf.set("x", 1);
    const before = buf.snapshot();
    buf.reconcile(new Set(["x"]));
    const after = buf.snapshot();
    expect(after).not.toBe(before);
  });
});

describe("createStagingBuffer - subscribe", () => {
  test("subscriber fires synchronously inside set", () => {
    const buf = createStagingBuffer();
    let calls = 0;
    buf.subscribe(() => {
      calls++;
    });
    expect(calls).toBe(0);
    buf.set("x", 1);
    expect(calls).toBe(1); // synchronous: incremented before the next statement
  });
  test("subscriber fires synchronously inside delete", () => {
    const buf = createStagingBuffer();
    buf.set("x", 1);
    let calls = 0;
    buf.subscribe(() => {
      calls++;
    });
    buf.delete("x");
    expect(calls).toBe(1);
  });
  test("subscriber fires synchronously inside reconcile", () => {
    const buf = createStagingBuffer();
    buf.set("x", 1);
    let calls = 0;
    buf.subscribe(() => {
      calls++;
    });
    buf.reconcile(new Set(["x"]));
    expect(calls).toBe(1);
  });
  test("subscriber fires on equal-value set (idempotent notification)", () => {
    const buf = createStagingBuffer();
    let calls = 0;
    buf.subscribe(() => {
      calls++;
    });
    buf.set("x", 1);
    buf.set("x", 1); // same value
    expect(calls).toBe(2);
  });
  test("registering the same callback twice creates two independent subscriptions", () => {
    const buf = createStagingBuffer();
    let calls = 0;
    const cb = () => {
      calls++;
    };
    buf.subscribe(cb);
    buf.subscribe(cb);
    buf.set("x", 1);
    expect(calls).toBe(2);
  });
  test("unsubscribe removes the subscription", () => {
    const buf = createStagingBuffer();
    let calls = 0;
    const unsub = buf.subscribe(() => {
      calls++;
    });
    buf.set("x", 1);
    expect(calls).toBe(1);
    unsub();
    buf.set("y", 2);
    expect(calls).toBe(1);
  });
  test("double unsubscribe is a no-op", () => {
    const buf = createStagingBuffer();
    let calls = 0;
    const unsub = buf.subscribe(() => {
      calls++;
    });
    unsub();
    expect(() => unsub()).not.toThrow();
    buf.set("x", 1);
    expect(calls).toBe(0);
  });
  test("listener errors are swallowed and do not affect other listeners", () => {
    const buf = createStagingBuffer();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let goodCalls = 0;
    buf.subscribe(() => {
      throw new Error("boom");
    });
    buf.subscribe(() => {
      goodCalls++;
    });
    expect(() => buf.set("x", 1)).not.toThrow();
    expect(goodCalls).toBe(1);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

describe("createStagingBuffer - reconcile", () => {
  test("drops fields not in the live set", () => {
    const buf = createStagingBuffer();
    buf.set("a", 1);
    buf.set("b", 2);
    buf.set("c", 3);
    buf.reconcile(new Set(["a", "c"]));
    expect(buf.has("a")).toBe(true);
    expect(buf.has("b")).toBe(false);
    expect(buf.has("c")).toBe(true);
  });
  test("preserves all fields when live set is a superset", () => {
    const buf = createStagingBuffer();
    buf.set("a", 1);
    buf.reconcile(new Set(["a", "b", "c"]));
    expect(buf.has("a")).toBe(true);
  });
  test("snapshot reflects reconciled state", () => {
    const buf = createStagingBuffer();
    buf.set("keep", "yes");
    buf.set("drop", "no");
    buf.reconcile(new Set(["keep"]));
    expect(buf.snapshot()).toEqual({ keep: "yes" });
  });
});
