import { describe, test, expect } from "vitest";
import { InitialDataNotSerializableError, validateJSONValue } from "./runtime";

describe("InitialDataNotSerializableError", () => {
  test("is a real Error subclass with path and actualType fields", () => {
    const err = new InitialDataNotSerializableError("/foo/bar", "Date");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("InitialDataNotSerializableError");
    expect(err.path).toBe("/foo/bar");
    expect(err.actualType).toBe("Date");
    expect(err.message).toContain("/foo/bar");
    expect(err.message).toContain("Date");
  });
});

describe("validateJSONValue - allowed leaves", () => {
  test("accepts null", () => {
    expect(() => validateJSONValue(null, "")).not.toThrow();
  });
  test("accepts true and false", () => {
    expect(() => validateJSONValue(true, "")).not.toThrow();
    expect(() => validateJSONValue(false, "")).not.toThrow();
  });
  test("accepts finite numbers", () => {
    expect(() => validateJSONValue(0, "")).not.toThrow();
    expect(() => validateJSONValue(-1.5, "")).not.toThrow();
    expect(() => validateJSONValue(Number.MAX_SAFE_INTEGER, "")).not.toThrow();
  });
  test("accepts strings", () => {
    expect(() => validateJSONValue("", "")).not.toThrow();
    expect(() => validateJSONValue("hello", "")).not.toThrow();
  });
});

describe("validateJSONValue - disqualified primitives", () => {
  const cases: Array<[string, unknown, string]> = [
    ["undefined", undefined, "undefined"],
    ["BigInt", BigInt(0), "BigInt"],
    ["Symbol", Symbol("x"), "Symbol"],
    ["function", () => 0, "Function"],
    ["NaN", Number.NaN, "NaN"],
    ["Infinity", Number.POSITIVE_INFINITY, "Infinity"],
    ["-Infinity", Number.NEGATIVE_INFINITY, "-Infinity"],
  ];
  for (const [name, value, expectedType] of cases) {
    test(`rejects ${name} at top level`, () => {
      expect(() => validateJSONValue(value, "")).toThrow(
        InitialDataNotSerializableError,
      );
      try {
        validateJSONValue(value, "");
      } catch (err) {
        expect((err as InitialDataNotSerializableError).actualType).toBe(
          expectedType,
        );
      }
    });
  }
});

describe("validateJSONValue - disqualified objects", () => {
  const cases: Array<[string, unknown, string]> = [
    ["Date", new Date(), "Date"],
    ["RegExp", /x/, "RegExp"],
    ["Error", new Error("x"), "Error"],
    ["Map", new Map(), "Map"],
    ["Set", new Set(), "Set"],
    ["WeakMap", new WeakMap(), "WeakMap"],
    ["WeakSet", new WeakSet(), "WeakSet"],
    ["ArrayBuffer", new ArrayBuffer(0), "ArrayBuffer"],
    ["Uint8Array", new Uint8Array(0), "Uint8Array"],
    ["Int32Array", new Int32Array(0), "Int32Array"],
    [
      "custom class",
      new (class X {
        x = 1;
      })(),
      "X (non-plain object)",
    ],
  ];
  for (const [name, value, expectedType] of cases) {
    test(`rejects ${name}`, () => {
      expect(() => validateJSONValue(value, "")).toThrow(
        InitialDataNotSerializableError,
      );
      try {
        validateJSONValue(value, "");
      } catch (err) {
        expect((err as InitialDataNotSerializableError).actualType).toBe(
          expectedType,
        );
      }
    });
  }
});

describe("validateJSONValue - disqualified at depth — exhaustive 3-position matrix", () => {
  // Spec Invariant 11 ("disqualified value matrix exhaustive") requires every
  // disqualified value to be tested in three positions: top-level (covered by
  // the two describe blocks above), nested-in-object, and nested-in-array.
  // Loop over the full disqualified set to assert every value × every nested
  // position throws with the correct path.
  const disqualified: Array<[string, () => unknown]> = [
    ["undefined", () => undefined],
    ["BigInt", () => BigInt(0)],
    ["Symbol", () => Symbol("x")],
    ["function", () => () => 0],
    ["NaN", () => Number.NaN],
    ["Infinity", () => Number.POSITIVE_INFINITY],
    ["-Infinity", () => Number.NEGATIVE_INFINITY],
    ["Date", () => new Date()],
    ["RegExp", () => /x/],
    ["Error", () => new Error("x")],
    ["Map", () => new Map()],
    ["Set", () => new Set()],
    ["WeakMap", () => new WeakMap()],
    ["WeakSet", () => new WeakSet()],
    ["Promise", () => Promise.resolve(0)],
    ["ArrayBuffer", () => new ArrayBuffer(0)],
    ["SharedArrayBuffer", () => new SharedArrayBuffer(0)],
    ["Uint8Array", () => new Uint8Array(0)],
    ["Int32Array", () => new Int32Array(0)],
    ["Float64Array", () => new Float64Array(0)],
    ["URL", () => new URL("https://example.com")],
    [
      "custom class",
      () =>
        new (class X {
          x = 1;
        })(),
    ],
  ];

  for (const [name, factory] of disqualified) {
    test(`rejects ${name} nested inside a plain object at /a/b`, () => {
      expect.assertions(2);
      const wrapper = { a: { b: factory() } };
      expect(() => validateJSONValue(wrapper, "")).toThrow(
        InitialDataNotSerializableError,
      );
      try {
        validateJSONValue(wrapper, "");
      } catch (err) {
        expect((err as InitialDataNotSerializableError).path).toBe("/a/b");
      }
    });

    test(`rejects ${name} nested inside an array at /list/2`, () => {
      expect.assertions(2);
      const wrapper = { list: ["ok", "ok", factory()] };
      expect(() => validateJSONValue(wrapper, "")).toThrow(
        InitialDataNotSerializableError,
      );
      try {
        validateJSONValue(wrapper, "");
      } catch (err) {
        expect((err as InitialDataNotSerializableError).path).toBe("/list/2");
      }
    });
  }
});

describe("validateJSONValue - circular references", () => {
  test("rejects a self-referencing object", () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(() => validateJSONValue(a, "")).toThrow(
      InitialDataNotSerializableError,
    );
    try {
      validateJSONValue(a, "");
    } catch (err) {
      expect((err as InitialDataNotSerializableError).actualType).toBe(
        "<circular reference>",
      );
    }
  });
});

describe("validateJSONValue - allowed containers", () => {
  test("accepts a deeply nested plain object", () => {
    expect(() =>
      validateJSONValue(
        { a: { b: { c: [1, 2, "three", null, true, { d: "deep" }] } } },
        "",
      ),
    ).not.toThrow();
  });
  test("accepts an empty object", () => {
    expect(() => validateJSONValue({}, "")).not.toThrow();
  });
  test("accepts an empty array", () => {
    expect(() => validateJSONValue([], "")).not.toThrow();
  });
  test("accepts Object.create(null)", () => {
    const obj = Object.create(null) as Record<string, unknown>;
    obj.x = "hello";
    expect(() => validateJSONValue(obj, "")).not.toThrow();
  });
});
