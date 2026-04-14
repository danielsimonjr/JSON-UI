import { describe, test, expect, vi } from "vitest";
import {
  createStagingBuffer,
  createObservableDataModel,
  InitialDataNotSerializableError,
  type StagingBuffer,
  type ObservableDataModel,
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

describe("createObservableDataModel - basic operations", () => {
  test("creates a model with all interface methods", () => {
    const model: ObservableDataModel = createObservableDataModel();
    expect(typeof model.get).toBe("function");
    expect(typeof model.set).toBe("function");
    expect(typeof model.delete).toBe("function");
    expect(typeof model.snapshot).toBe("function");
    expect(typeof model.subscribe).toBe("function");
  });
});

describe("createObservableDataModel - paths", () => {
  test("set and get with a single-segment path", () => {
    const m = createObservableDataModel();
    m.set("name", "Alice");
    expect(m.get("name")).toBe("Alice");
  });
  test("set and get with a nested path", () => {
    const m = createObservableDataModel();
    m.set("user/profile/name", "Bob");
    expect(m.get("user/profile/name")).toBe("Bob");
    expect(m.get("user/profile")).toEqual({ name: "Bob" });
  });
  test("get returns undefined for missing path", () => {
    const m = createObservableDataModel();
    expect(m.get("missing")).toBeUndefined();
    expect(m.get("missing/deeper")).toBeUndefined();
  });
  test("delete removes a leaf", () => {
    const m = createObservableDataModel();
    m.set("user/name", "Carol");
    m.delete("user/name");
    expect(m.get("user/name")).toBeUndefined();
  });
  test("initialData seeds the store", () => {
    const m = createObservableDataModel({ user: { name: "Dan" } });
    expect(m.get("user/name")).toBe("Dan");
  });
});

describe("createObservableDataModel - initialData validation", () => {
  test("throws on Date in initialData", () => {
    expect(() =>
      createObservableDataModel({ when: new Date() } as never),
    ).toThrow(InitialDataNotSerializableError);
  });
  test("throws on Map nested in initialData", () => {
    expect(() =>
      createObservableDataModel({ data: new Map() } as never),
    ).toThrow(InitialDataNotSerializableError);
  });
  test("throws on function in initialData", () => {
    expect(() => createObservableDataModel({ fn: () => 0 } as never)).toThrow(
      InitialDataNotSerializableError,
    );
  });
  test("error path reflects nested location", () => {
    expect.assertions(2);
    expect(() =>
      createObservableDataModel({ user: { dob: new Date() } } as never),
    ).toThrow(InitialDataNotSerializableError);
    try {
      createObservableDataModel({ user: { dob: new Date() } } as never);
    } catch (err) {
      expect((err as InitialDataNotSerializableError).path).toBe("/user/dob");
    }
  });
  test("accepts deeply nested plain object", () => {
    expect(() =>
      createObservableDataModel({
        user: { name: "Dan", scores: [1, 2, 3], meta: { active: true } },
      }),
    ).not.toThrow();
  });
});

describe("createObservableDataModel - snapshot identity and notification", () => {
  test("snapshot is identity-stable across calls with no mutation", () => {
    const m = createObservableDataModel({ x: 1 });
    const a = m.snapshot();
    const b = m.snapshot();
    expect(a).toBe(b);
  });
  test("snapshot reference changes after set", () => {
    const m = createObservableDataModel();
    const before = m.snapshot();
    m.set("x", 1);
    const after = m.snapshot();
    expect(after).not.toBe(before);
  });
  test("subscriber fires synchronously inside set", () => {
    const m = createObservableDataModel();
    let calls = 0;
    m.subscribe(() => {
      calls++;
    });
    m.set("x", 1);
    expect(calls).toBe(1);
  });
  test("subscriber fires synchronously inside delete", () => {
    const m = createObservableDataModel({ x: 1 });
    let calls = 0;
    m.subscribe(() => {
      calls++;
    });
    m.delete("x");
    expect(calls).toBe(1);
  });
  test("unsubscribe stops notifications", () => {
    const m = createObservableDataModel();
    let calls = 0;
    const unsub = m.subscribe(() => {
      calls++;
    });
    m.set("x", 1);
    unsub();
    m.set("y", 2);
    expect(calls).toBe(1);
  });
  test("listener errors are swallowed and do not affect other listeners", () => {
    // Mirrors the StagingBuffer listener-error-isolation test — the
    // ObservableDataModel has its own try/catch around listener() calls
    // and must satisfy the same spec invariant.
    const m = createObservableDataModel();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let goodCalls = 0;
    m.subscribe(() => {
      throw new Error("boom");
    });
    m.subscribe(() => {
      goodCalls++;
    });
    expect(() => m.set("x", 1)).not.toThrow();
    expect(goodCalls).toBe(1);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

describe("createObservableDataModel - empty-path edge cases (review fix)", () => {
  // Review caught two bugs in the initial implementation: get("") was
  // returning the live mutable `root` object, and set("") was firing
  // spurious subscriber notifications on a no-op write. These tests lock
  // in the correct behavior.
  test('get("") returns undefined, not the internal root reference', () => {
    const m = createObservableDataModel({ a: 1 });
    expect(m.get("")).toBeUndefined();
  });
  test('get("") does not let callers mutate internal state', () => {
    const m = createObservableDataModel({ a: 1 });
    const result = m.get("");
    expect(result).toBeUndefined();
    // Confirm the store is still pristine — snapshot returns identity-stable.
    const snap1 = m.snapshot();
    const snap2 = m.snapshot();
    expect(snap1).toBe(snap2);
    expect(snap1).toEqual({ a: 1 });
  });
  test('set("") is a no-op and fires NO subscriber notification', () => {
    const m = createObservableDataModel({ a: 1 });
    let calls = 0;
    m.subscribe(() => {
      calls++;
    });
    const snap1 = m.snapshot();
    m.set("", "ignored");
    const snap2 = m.snapshot();
    expect(calls).toBe(0);
    expect(snap1).toBe(snap2); // snapshot cache not invalidated
    expect(m.get("a")).toBe(1); // state unchanged
  });
  test('delete("") is a no-op and fires NO subscriber notification', () => {
    const m = createObservableDataModel({ a: 1 });
    let calls = 0;
    m.subscribe(() => {
      calls++;
    });
    m.delete("");
    expect(calls).toBe(0);
    expect(m.get("a")).toBe(1);
  });
});

describe("createStagingBuffer - self-unsubscribe during notify", () => {
  // Spec "Set-during-notify is allowed" covers the general case; the
  // implementation uses Array.from(listeners.values()) to snapshot the
  // listener set at notification time so iteration is not corrupted when
  // a callback unsubscribes another callback. This test exercises that
  // behavior end-to-end.
  test("listener A unsubscribing listener B mid-notify still fires B in the current tick", () => {
    const buf = createStagingBuffer();
    let bCalls = 0;
    let unsubB: (() => void) | null = null;
    buf.subscribe(() => {
      // First listener runs and unsubscribes the second — but iteration
      // already captured B via Array.from, so B still fires this tick.
      if (unsubB) unsubB();
    });
    unsubB = buf.subscribe(() => {
      bCalls++;
    });
    buf.set("x", 1);
    expect(bCalls).toBe(1);
    // On the NEXT write, B is no longer in the Map and does not fire.
    buf.set("x", 2);
    expect(bCalls).toBe(1);
  });
  test("listener that unsubscribes itself does not fire on subsequent writes", () => {
    const buf = createStagingBuffer();
    let calls = 0;
    let unsub: (() => void) | null = null;
    unsub = buf.subscribe(() => {
      calls++;
      if (unsub) unsub();
    });
    buf.set("x", 1);
    expect(calls).toBe(1);
    buf.set("y", 2);
    expect(calls).toBe(1); // no further fire after self-unsub
  });
});

describe("createObservableDataModel - self-unsubscribe during notify", () => {
  test("listener A unsubscribing listener B mid-notify still fires B in the current tick", () => {
    const m = createObservableDataModel();
    let bCalls = 0;
    let unsubB: (() => void) | null = null;
    m.subscribe(() => {
      if (unsubB) unsubB();
    });
    unsubB = m.subscribe(() => {
      bCalls++;
    });
    m.set("x", 1);
    expect(bCalls).toBe(1);
    m.set("y", 2);
    expect(bCalls).toBe(1);
  });
});
