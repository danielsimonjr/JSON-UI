import { describe, it, expect } from "vitest";
import {
  toSerializableError,
  UnknownComponentError,
  MissingChildError,
  OptionConflictError,
  SessionDestroyedError,
} from "./errors";

describe("toSerializableError", () => {
  it("converts a plain Error", () => {
    const err = new Error("boom");
    const s = toSerializableError(err, "component");
    expect(s.name).toBe("Error");
    expect(s.message).toBe("boom");
    expect(s.phase).toBe("component");
    expect(typeof s.stack === "string" || s.stack === undefined).toBe(true);
    expect(s.cause).toBeUndefined();
  });

  it("walks a single cause", () => {
    const inner = new Error("inner");
    const outer = new Error("outer", { cause: inner });
    const s = toSerializableError(outer, "walk");
    expect(s.message).toBe("outer");
    expect(s.cause?.name).toBe("Error");
    expect(s.cause?.message).toBe("inner");
    expect((s.cause as { phase?: string }).phase).toBeUndefined();
  });

  it("walks a multi-level cause chain", () => {
    const a = new Error("a");
    const b = new Error("b", { cause: a });
    const c = new Error("c", { cause: b });
    const s = toSerializableError(c, "validation");
    expect(s.message).toBe("c");
    expect(s.cause?.message).toBe("b");
    expect(s.cause?.cause?.message).toBe("a");
  });

  it("handles a string cause", () => {
    const err = new Error("outer", { cause: "primitive-cause-string" });
    const s = toSerializableError(err, "component");
    expect(s.cause?.name).toBe("UnknownError");
    expect(s.cause?.message).toBe("primitive-cause-string");
  });

  it("stops cause-chain walking at depth 8 with an explicit marker", () => {
    const root = new Error("root") as Error & { cause?: unknown };
    root.cause = root;
    const s = toSerializableError(root, "walk");
    type CursorNode = { name?: string; message?: string; cause?: CursorNode };
    let cursor: CursorNode | undefined = s;
    for (let i = 0; i < 8 && cursor?.cause; i++) {
      cursor = cursor.cause;
    }
    expect(cursor?.cause?.name).toBe("CauseChainDepthLimitExceeded");
  });

  it("coerces an unknown throwable (number)", () => {
    const s = toSerializableError(42, "dispatch");
    expect(s.name).toBe("UnknownError");
    expect(s.message).toBe("42");
    expect(s.phase).toBe("dispatch");
  });

  it("coerces an unknown throwable (plain object)", () => {
    const s = toSerializableError({ msg: "hi" }, "component");
    expect(s.name).toBe("UnknownError");
    expect(s.message).toBe("[object Object]");
  });

  it("coerces undefined", () => {
    const s = toSerializableError(undefined, "walk");
    expect(s.name).toBe("UnknownError");
    expect(s.message).toBe("undefined");
  });

  it("handles a duck-typed Error-like object", () => {
    const ducky = { name: "DOMException", message: "abort" };
    const s = toSerializableError(ducky, "component");
    expect(s.name).toBe("DOMException");
    expect(s.message).toBe("abort");
  });
});

describe("error classes", () => {
  it("UnknownComponentError carries the type", () => {
    const err = new UnknownComponentError("WidgetX", "elem-42");
    expect(err.name).toBe("UnknownComponentError");
    expect(err.elementType).toBe("WidgetX");
    expect(err.elementKey).toBe("elem-42");
    expect(err.message).toContain("WidgetX");
  });

  it("MissingChildError carries the missing key", () => {
    const err = new MissingChildError("missing-key-99", "parent-key");
    expect(err.name).toBe("MissingChildError");
    expect(err.missingKey).toBe("missing-key-99");
    expect(err.parentKey).toBe("parent-key");
  });

  it("OptionConflictError surfaces the conflicting fields", () => {
    const err = new OptionConflictError(["initialData", "data"]);
    expect(err.name).toBe("OptionConflictError");
    expect(err.fields).toEqual(["initialData", "data"]);
  });

  it("SessionDestroyedError has a stable name", () => {
    const err = new SessionDestroyedError();
    expect(err.name).toBe("SessionDestroyedError");
  });
});

describe("SerializableError JSON round-trip", () => {
  it("survives JSON.stringify / JSON.parse", () => {
    const inner = new Error("inner");
    const outer = new Error("outer", { cause: inner });
    const s = toSerializableError(outer, "walk");
    const round = JSON.parse(JSON.stringify(s));
    // Compare the round-trip to the ORIGINAL, not to another round-trip:
    // comparing round to round is a tautology that passes even if the
    // payload contained Date, Map, function, etc.
    expect(round).toEqual(s);
    expect(round.message).toBe("outer");
    expect(round.cause.message).toBe("inner");
  });
});
