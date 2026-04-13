# Core Runtime Types Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new `packages/core/src/runtime.ts` module to `@json-ui/core` exporting `FieldId`, `JSONValue`, `StagingSnapshot`, `StagingBuffer` + `createStagingBuffer`, `ObservableDataModel` + `createObservableDataModel`, `IntentEvent`, and `InitialDataNotSerializableError`. Purely additive to core's existing surface.

**Architecture:** Single new file plus barrel update. `runtime.ts` contains the type definitions, the structural-recursion validator, and the Map-backed observable store factories with cached snapshots and synchronous subscriber notification. Test files live alongside as `runtime.test.ts` and `runtime-validation.test.ts`.

**Tech Stack:** TypeScript 5.9, vitest 4 (already installed in the repo), zero new dependencies.

**Spec:** `docs/specs/2026-04-13-core-runtime-types-design.md`

**Dependencies:** None. This plan is the foundation that the React external store plan and the headless renderer plan both build on. Land this first.

---

### Task 1: Setup and baseline verification

**Goal:** Confirm the JSON-UI repo is in a buildable, testable state before adding new code. No code changes in this task — just verification.

**Files:** None modified.

- [ ] **Step 1: Verify the working directory is the JSON-UI repo root**

```bash
pwd
ls package.json packages/core packages/react
```

Expected: `package.json` and both package directories exist.

- [ ] **Step 2: Verify dependencies are installed**

```bash
npm ls @json-ui/core 2>&1 | head -5
```

Expected output includes `@json-ui/core@0.1.0 -> ...` (workspace-resolved, not registry).

- [ ] **Step 3: Run baseline typecheck**

```bash
npm run typecheck
```

Expected: clean exit, no errors. If errors appear, stop and fix the existing baseline before adding new code.

- [ ] **Step 4: Run baseline test suite**

```bash
npm test
```

Expected: 160 tests pass across 9 test files (the post-rewrite baseline). If any test fails, stop and fix before continuing.

- [ ] **Step 5: Confirm the target file does not yet exist**

```bash
test -f packages/core/src/runtime.ts && echo "EXISTS" || echo "OK - runtime.ts does not exist yet"
```

Expected: `OK - runtime.ts does not exist yet`. If it exists, you are not on a clean baseline.

---

### Task 2: Pure type definitions (FieldId, JSONValue, StagingSnapshot, IntentEvent)

**Goal:** Create `runtime.ts` with the foundational type aliases. No runtime code yet — just types that downstream tasks will reference.

**Files:**

- Create: `packages/core/src/runtime.ts`

- [ ] **Step 1: Create `packages/core/src/runtime.ts` with the four pure types**

```typescript
// Runtime types module — observable stores and shared types for the dual-backend
// architecture. See docs/specs/2026-04-13-core-runtime-types-design.md for the
// authoritative design and docs/specs/2026-04-13-headless-renderer-design.md
// for the type definitions and observable-store contracts.

/** Stable identifier for an input field within a rendered UI tree. */
export type FieldId = string;

/**
 * The subset of JavaScript values that survive a JSON.stringify / JSON.parse
 * round trip losslessly. Recursive: arrays and objects whose elements are
 * themselves JSONValue.
 */
export type JSONValue =
  | null
  | boolean
  | number
  | string
  | JSONValue[]
  | { [key: string]: JSONValue };

/** A plain-JSON snapshot of a staging buffer at a single point in time. */
export type StagingSnapshot = Record<FieldId, JSONValue>;

/**
 * Emitted when a catalog action fires — either through a headless session's
 * dispatch() or through a React backend's action handler. Structurally
 * identical across both backends so NC's orchestrator handles them uniformly.
 */
export interface IntentEvent {
  /** Name of the action from the NC catalog. */
  action_name: string;
  /** Parameters the caller passed to dispatch() or the LLM put in a Button's action. */
  action_params: Record<string, JSONValue>;
  /** Full snapshot of the staging buffer at flush time. */
  staging_snapshot: StagingSnapshot;
  /** Optional version string for the catalog in effect at emission time. */
  catalog_version?: string;
  /** Unix epoch milliseconds when the event fired. */
  timestamp: number;
}
```

- [ ] **Step 2: Verify typecheck passes**

```bash
npm run typecheck
```

Expected: clean exit. The new file has no consumers yet so nothing else can fail.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/runtime.ts
git commit -m "feat(core): add runtime.ts with FieldId, JSONValue, StagingSnapshot, IntentEvent types"
```

---

### Task 3: InitialDataNotSerializableError + validateJSONValue (TDD)

**Goal:** Add the error class and the structural-recursion validator that enforces JSONValue at runtime. Full TDD cycle for each disqualified-value class.

**Files:**

- Modify: `packages/core/src/runtime.ts`
- Create: `packages/core/src/runtime-validation.test.ts`

- [ ] **Step 1: Write failing test — InitialDataNotSerializableError exists**

Create `packages/core/src/runtime-validation.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run packages/core/src/runtime-validation.test.ts
```

Expected: FAIL with "InitialDataNotSerializableError is not exported".

- [ ] **Step 3: Add InitialDataNotSerializableError to `runtime.ts`**

Append to `packages/core/src/runtime.ts`:

```typescript
/**
 * Thrown by `createObservableDataModel` (and by the headless session constructor)
 * when initialData contains a value that is not JSON-serializable.
 */
export class InitialDataNotSerializableError extends Error {
  public readonly path: string;
  public readonly actualType: string;

  constructor(path: string, actualType: string) {
    super(
      `initialData contains non-JSON-serializable value at path '${path || "/"}': ${actualType}`,
    );
    this.name = "InitialDataNotSerializableError";
    this.path = path;
    this.actualType = actualType;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run packages/core/src/runtime-validation.test.ts
```

Expected: PASS (1 test).

- [ ] **Step 5: Write failing test — validateJSONValue accepts allowed leaves**

Append to `packages/core/src/runtime-validation.test.ts`:

```typescript
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
```

- [ ] **Step 6: Run test to verify it fails**

```bash
npx vitest run packages/core/src/runtime-validation.test.ts
```

Expected: FAIL with "validateJSONValue is not a function" or similar.

- [ ] **Step 7: Implement validateJSONValue in `runtime.ts`**

Append to `packages/core/src/runtime.ts`:

```typescript
/**
 * Structural-recursion validator. Throws InitialDataNotSerializableError on
 * the first non-JSONValue leaf encountered. See spec for the full disqualified
 * set. Used by createObservableDataModel and by the headless session constructor.
 */
export function validateJSONValue(
  value: unknown,
  path: string,
  visited: WeakSet<object> = new WeakSet(),
): void {
  // Allowed leaves
  if (value === null) return;
  if (typeof value === "boolean") return;
  if (typeof value === "string") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new InitialDataNotSerializableError(
        path,
        Number.isNaN(value)
          ? "NaN"
          : value === Infinity
            ? "Infinity"
            : "-Infinity",
      );
    }
    return;
  }

  // Disqualified primitives
  if (typeof value === "undefined") {
    throw new InitialDataNotSerializableError(path, "undefined");
  }
  if (typeof value === "bigint") {
    throw new InitialDataNotSerializableError(path, "BigInt");
  }
  if (typeof value === "symbol") {
    throw new InitialDataNotSerializableError(path, "Symbol");
  }
  if (typeof value === "function") {
    throw new InitialDataNotSerializableError(path, "Function");
  }

  // value is now an object (or null, but null was handled above)
  // Cycle detection
  if (visited.has(value as object)) {
    throw new InitialDataNotSerializableError(path, "<circular reference>");
  }
  visited.add(value as object);

  // Disqualified object types — checked before plain-object check
  if (value instanceof Date)
    throw new InitialDataNotSerializableError(path, "Date");
  if (value instanceof RegExp)
    throw new InitialDataNotSerializableError(path, "RegExp");
  if (value instanceof Error)
    throw new InitialDataNotSerializableError(path, "Error");
  if (value instanceof Map)
    throw new InitialDataNotSerializableError(path, "Map");
  if (value instanceof Set)
    throw new InitialDataNotSerializableError(path, "Set");
  if (value instanceof WeakMap)
    throw new InitialDataNotSerializableError(path, "WeakMap");
  if (value instanceof WeakSet)
    throw new InitialDataNotSerializableError(path, "WeakSet");
  if (value instanceof Promise)
    throw new InitialDataNotSerializableError(path, "Promise");
  if (value instanceof ArrayBuffer)
    throw new InitialDataNotSerializableError(path, "ArrayBuffer");
  // SharedArrayBuffer is a separate global; instanceof ArrayBuffer returns false
  // in V8 even though the contract is similar. Check it explicitly. The
  // typeof check guards environments where SAB is not available.
  if (
    typeof SharedArrayBuffer !== "undefined" &&
    value instanceof SharedArrayBuffer
  ) {
    throw new InitialDataNotSerializableError(path, "SharedArrayBuffer");
  }
  if (ArrayBuffer.isView(value)) {
    throw new InitialDataNotSerializableError(
      path,
      (value as object).constructor?.name ?? "TypedArray",
    );
  }

  // Arrays
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      validateJSONValue(value[i], `${path}/${i}`, visited);
    }
    return;
  }

  // Plain objects: prototype must be Object.prototype or null
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    const constructorName = (value as object).constructor?.name ?? "object";
    throw new InitialDataNotSerializableError(
      path,
      `${constructorName} (non-plain object)`,
    );
  }

  // Symbol keys disallowed
  if (Object.getOwnPropertySymbols(value as object).length > 0) {
    throw new InitialDataNotSerializableError(path, "object with Symbol keys");
  }

  for (const key of Object.keys(value as object)) {
    validateJSONValue(
      (value as Record<string, unknown>)[key],
      `${path}/${key}`,
      visited,
    );
  }
}
```

- [ ] **Step 8: Run tests to verify the leaf-acceptance tests pass**

```bash
npx vitest run packages/core/src/runtime-validation.test.ts
```

Expected: PASS (5 tests — the original error-class test plus four leaf tests).

- [ ] **Step 9: Write failing tests — disqualified value matrix**

Append to `packages/core/src/runtime-validation.test.ts`:

```typescript
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
```

- [ ] **Step 10: Run all validation tests to verify they pass**

```bash
npx vitest run packages/core/src/runtime-validation.test.ts
```

Expected: PASS — approximately 25 tests across all describe blocks. Every disqualified value rejected, every allowed value accepted.

- [ ] **Step 11: Commit**

```bash
git add packages/core/src/runtime.ts packages/core/src/runtime-validation.test.ts
git commit -m "feat(core): add InitialDataNotSerializableError and validateJSONValue"
```

---

### Task 4: StagingBuffer + createStagingBuffer (TDD)

**Goal:** Implement the observable staging buffer. Map-backed, cached snapshot, synchronous notification, idempotent subscribe.

**Files:**

- Modify: `packages/core/src/runtime.ts`
- Create: `packages/core/src/runtime.test.ts`

- [ ] **Step 1: Write failing test — createStagingBuffer factory exists**

Create `packages/core/src/runtime.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run packages/core/src/runtime.test.ts
```

Expected: FAIL with "createStagingBuffer is not exported".

- [ ] **Step 3: Add StagingBuffer interface and createStagingBuffer factory to `runtime.ts`**

Append to `packages/core/src/runtime.ts`:

```typescript
/**
 * Observable store for in-progress user input. See spec for the full contract:
 * identity-stable snapshots, synchronous notification, idempotent subscribe.
 */
export interface StagingBuffer {
  get(fieldId: FieldId): JSONValue | undefined;
  set(fieldId: FieldId, value: JSONValue): void;
  delete(fieldId: FieldId): void;
  has(fieldId: FieldId): boolean;
  snapshot(): StagingSnapshot;
  reconcile(liveIds: ReadonlySet<FieldId>): void;
  subscribe(callback: () => void): () => void;
}

export function createStagingBuffer(): StagingBuffer {
  const store = new Map<FieldId, JSONValue>();
  const listeners = new Set<() => void>();
  let cachedSnapshot: StagingSnapshot | null = null;

  const invalidateAndNotify = () => {
    cachedSnapshot = null;
    // Snapshot the listener set so a listener that unsubscribes itself
    // mid-notify does not affect the current iteration.
    for (const listener of Array.from(listeners)) {
      try {
        listener();
      } catch (err) {
        // Swallow listener errors per spec; subscribers MUST NOT crash the store.
        // eslint-disable-next-line no-console
        console.error("[StagingBuffer] subscriber threw:", err);
      }
    }
  };

  return {
    get(fieldId) {
      return store.get(fieldId);
    },
    set(fieldId, value) {
      store.set(fieldId, value);
      invalidateAndNotify();
    },
    delete(fieldId) {
      if (store.delete(fieldId)) {
        invalidateAndNotify();
      }
    },
    has(fieldId) {
      return store.has(fieldId);
    },
    snapshot() {
      if (cachedSnapshot === null) {
        cachedSnapshot = Object.fromEntries(store);
      }
      return cachedSnapshot;
    },
    reconcile(liveIds) {
      for (const key of Array.from(store.keys())) {
        if (!liveIds.has(key)) {
          store.delete(key);
        }
      }
      // Always notify on reconcile, even if nothing was dropped — the call
      // itself is a mutation event in the store's contract.
      invalidateAndNotify();
    },
    subscribe(callback) {
      listeners.add(callback);
      let unsubscribed = false;
      return () => {
        if (unsubscribed) return;
        unsubscribed = true;
        listeners.delete(callback);
      };
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run packages/core/src/runtime.test.ts
```

Expected: PASS (1 test).

- [ ] **Step 5: Add invariant tests for get/set/delete/has**

Append to `packages/core/src/runtime.test.ts`:

```typescript
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
```

- [ ] **Step 6: Run and verify pass**

```bash
npx vitest run packages/core/src/runtime.test.ts
```

Expected: PASS (5 tests total).

- [ ] **Step 7: Add identity-stable snapshot test (Invariant 1 from spec)**

Append:

```typescript
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
```

- [ ] **Step 8: Run and verify pass**

```bash
npx vitest run packages/core/src/runtime.test.ts
```

Expected: PASS (9 tests total).

- [ ] **Step 9: Add synchronous notification test**

Append:

```typescript
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
```

- [ ] **Step 10: Run and verify pass**

```bash
npx vitest run packages/core/src/runtime.test.ts
```

Expected: PASS (17 tests total).

- [ ] **Step 11: Add reconcile semantics test**

Append:

```typescript
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
```

- [ ] **Step 12: Run and verify pass**

```bash
npx vitest run packages/core/src/runtime.test.ts
```

Expected: PASS (20 tests total).

- [ ] **Step 13: Commit**

```bash
git add packages/core/src/runtime.ts packages/core/src/runtime.test.ts
git commit -m "feat(core): add StagingBuffer interface and createStagingBuffer factory"
```

---

### Task 5: ObservableDataModel + createObservableDataModel (TDD)

**Goal:** Add the path-based observable data store with the same identity-stability and notification properties, plus initialData validation.

**Files:**

- Modify: `packages/core/src/runtime.ts`
- Modify: `packages/core/src/runtime.test.ts`

- [ ] **Step 1: Write failing test — createObservableDataModel exists**

This step has TWO edits to `packages/core/src/runtime.test.ts`. **Do them in order.**

**Edit 1 — replace the existing top-of-file import** (added in Task 4 Step 1) with the merged import. Locate the line that reads:

```typescript
import {
  createStagingBuffer,
  type StagingBuffer,
  type FieldId,
  type JSONValue,
} from "./runtime";
```

and replace it with the merged version that adds the three new names:

```typescript
import {
  createStagingBuffer,
  createObservableDataModel,
  InitialDataNotSerializableError,
  type StagingBuffer,
  type ObservableDataModel,
  type FieldId,
  type JSONValue,
} from "./runtime";
```

**ES modules require all imports at the top of the file — do NOT add a second `import` statement at the bottom or inside a `describe` block. That is a syntax error.**

**Edit 2 — append the new `describe` block** (NOT including any import statements) at the bottom of `runtime.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run packages/core/src/runtime.test.ts
```

Expected: FAIL with "createObservableDataModel is not exported".

- [ ] **Step 3: Add ObservableDataModel interface and createObservableDataModel factory**

Append to `packages/core/src/runtime.ts`:

```typescript
/**
 * Observable store for durable application data, keyed by `/`-separated paths.
 * Same identity-stability and synchronous-notification contract as StagingBuffer.
 */
export interface ObservableDataModel {
  get(path: string): JSONValue | undefined;
  set(path: string, value: JSONValue): void;
  delete(path: string): void;
  snapshot(): Readonly<Record<string, JSONValue>>;
  subscribe(callback: () => void): () => void;
}

/**
 * Internal helper: get a value at a `/`-separated path from a nested object.
 */
function getAtPath(
  root: Record<string, JSONValue>,
  path: string,
): JSONValue | undefined {
  if (path === "") return root;
  const parts = path.split("/").filter((p) => p.length > 0);
  let current: JSONValue | undefined = root;
  for (const part of parts) {
    if (
      current === null ||
      typeof current !== "object" ||
      Array.isArray(current)
    ) {
      return undefined;
    }
    current = (current as Record<string, JSONValue>)[part];
    if (current === undefined) return undefined;
  }
  return current;
}

/**
 * Internal helper: set a value at a `/`-separated path, creating intermediate
 * plain objects as needed. Mutates `root` in place.
 */
function setAtPath(
  root: Record<string, JSONValue>,
  path: string,
  value: JSONValue,
): void {
  const parts = path.split("/").filter((p) => p.length > 0);
  if (parts.length === 0) return;
  let current: Record<string, JSONValue> = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!;
    const next = current[key];
    if (
      next === undefined ||
      next === null ||
      typeof next !== "object" ||
      Array.isArray(next)
    ) {
      const fresh: Record<string, JSONValue> = {};
      current[key] = fresh;
      current = fresh;
    } else {
      current = next as Record<string, JSONValue>;
    }
  }
  current[parts[parts.length - 1]!] = value;
}

/**
 * Internal helper: delete the leaf at a `/`-separated path. Does not prune
 * empty parent containers (Open Question 2 in the spec — leaning leave-empty).
 */
function deleteAtPath(root: Record<string, JSONValue>, path: string): boolean {
  const parts = path.split("/").filter((p) => p.length > 0);
  if (parts.length === 0) return false;
  let current: Record<string, JSONValue> | undefined = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const next = current?.[parts[i]!];
    if (
      next === undefined ||
      next === null ||
      typeof next !== "object" ||
      Array.isArray(next)
    ) {
      return false;
    }
    current = next as Record<string, JSONValue>;
  }
  const lastKey = parts[parts.length - 1]!;
  if (current && lastKey in current) {
    delete current[lastKey];
    return true;
  }
  return false;
}

export function createObservableDataModel(
  initialData?: Record<string, JSONValue>,
): ObservableDataModel {
  // Validate at construction time — throws InitialDataNotSerializableError on
  // any disqualified value.
  if (initialData !== undefined) {
    validateJSONValue(initialData, "");
  }

  const root: Record<string, JSONValue> = initialData
    ? structuredClone(initialData)
    : {};
  const listeners = new Set<() => void>();
  let cachedSnapshot: Readonly<Record<string, JSONValue>> | null = null;

  const invalidateAndNotify = () => {
    cachedSnapshot = null;
    for (const listener of Array.from(listeners)) {
      try {
        listener();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[ObservableDataModel] subscriber threw:", err);
      }
    }
  };

  return {
    get(path) {
      return getAtPath(root, path);
    },
    set(path, value) {
      setAtPath(root, path, value);
      invalidateAndNotify();
    },
    delete(path) {
      if (deleteAtPath(root, path)) {
        invalidateAndNotify();
      }
    },
    snapshot() {
      if (cachedSnapshot === null) {
        // Deep clone via structuredClone — required for true point-in-time
        // isolation. A bare reference-cache (`cachedSnapshot = root`) would
        // alias the live mutable object: the previously-returned snapshot
        // would silently mutate when callers later wrote, breaking React's
        // useSyncExternalStore tearing protection (Object.is(prev, next)
        // would return true even after content changed). A shallow clone
        // (`{...root}`) is also insufficient because nested objects would
        // still alias the originals. structuredClone gives a true frozen-
        // in-time copy. Cost is O(n) per write (the cache absorbs repeated
        // reads) — acceptable for v1 since useSyncExternalStore only
        // re-snapshots on subscribe notifications.
        cachedSnapshot = structuredClone(root);
      }
      return cachedSnapshot;
    },
    subscribe(callback) {
      listeners.add(callback);
      let unsubscribed = false;
      return () => {
        if (unsubscribed) return;
        unsubscribed = true;
        listeners.delete(callback);
      };
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run packages/core/src/runtime.test.ts
```

Expected: PASS (21 tests total).

- [ ] **Step 5: Add path-based read/write tests**

**TDD note.** The implementation in Step 3 already provides path-based read/write through the `getAtPath`/`setAtPath` helpers. The tests below are therefore written **test-after** for additional behaviors not asserted in Step 1. Run them immediately after appending; if any test fails, the path helpers have a bug and you must fix the implementation in Step 3 before moving on. Treat a failure here as a red phase even though the test was written second.

Append to `packages/core/src/runtime.test.ts`:

```typescript
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
```

- [ ] **Step 6: Run and verify pass**

```bash
npx vitest run packages/core/src/runtime.test.ts
```

Expected: PASS (26 tests total).

- [ ] **Step 7: Add validation-at-construction tests**

**TDD note.** Same pattern as Step 5 — these tests verify the existing `validateJSONValue` integration (Step 3 wires it into the constructor). Run immediately after appending; any failure means the constructor isn't calling the validator correctly. Treat a failure as a red phase.

Append:

```typescript
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
```

- [ ] **Step 8: Run and verify pass**

```bash
npx vitest run packages/core/src/runtime.test.ts
```

Expected: PASS (31 tests total).

- [ ] **Step 9: Add identity-stability and notification tests for ObservableDataModel**

**TDD note.** These tests check the most fragile properties of the implementation: snapshot identity stability (which depends on the `structuredClone` cache rebuild on invalidation) and synchronous subscriber notification. The original Step 3 implementation MUST satisfy them. If the snapshot identity test fails, the cache implementation has regressed to aliasing the live `root` object — fix Step 3 before continuing.

Append:

```typescript
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
});
```

- [ ] **Step 10: Run and verify pass**

```bash
npx vitest run packages/core/src/runtime.test.ts
```

Expected: PASS (36 tests total).

- [ ] **Step 11: Commit**

```bash
git add packages/core/src/runtime.ts packages/core/src/runtime.test.ts
git commit -m "feat(core): add ObservableDataModel interface and createObservableDataModel factory"
```

---

### Task 6: Update `packages/core/src/index.ts` barrel

**Goal:** Re-export the new runtime types from core's public surface so consumers can `import { StagingBuffer, createStagingBuffer, ... } from "@json-ui/core"`.

**Files:**

- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Read the current index.ts barrel**

```bash
cat packages/core/src/index.ts
```

Expected: existing exports for `Catalog`, `UITree`, `UIElement`, `Action`, `VisibilityCondition`, `ValidationConfig`, `ValidationFunction`, `ComponentDefinition`, `DataModel`, `createCatalog`, `evaluateVisibility`, `runValidation`, `resolveAction`, `resolveDynamicValue`. The exact current order does not matter — you will append the runtime exports at the bottom.

- [ ] **Step 2: Append runtime re-exports to the bottom of `packages/core/src/index.ts`**

Add this block at the end of the file:

```typescript
// Runtime types — see runtime.ts and the spec at
// docs/specs/2026-04-13-core-runtime-types-design.md
export type {
  FieldId,
  StagingSnapshot,
  JSONValue,
  StagingBuffer,
  ObservableDataModel,
  IntentEvent,
} from "./runtime";

export {
  createStagingBuffer,
  createObservableDataModel,
  validateJSONValue,
  InitialDataNotSerializableError,
} from "./runtime";
```

- [ ] **Step 3: Verify typecheck passes after the barrel update**

```bash
npm run typecheck
```

Expected: clean exit. Both packages typecheck cleanly because the additions are purely additive.

- [ ] **Step 4: Verify the new exports are importable from `@json-ui/core`**

Create a temporary verification file at `packages/core/src/runtime-export-check.ts`:

```typescript
import {
  createStagingBuffer,
  createObservableDataModel,
  validateJSONValue,
  InitialDataNotSerializableError,
  type FieldId,
  type StagingSnapshot,
  type JSONValue,
  type StagingBuffer,
  type ObservableDataModel,
  type IntentEvent,
} from "./index";

// Use each name to ensure TypeScript resolves them.
const _b: StagingBuffer = createStagingBuffer();
const _m: ObservableDataModel = createObservableDataModel();
const _v: typeof validateJSONValue = validateJSONValue;
const _e: typeof InitialDataNotSerializableError =
  InitialDataNotSerializableError;
const _id: FieldId = "field-1";
const _snap: StagingSnapshot = {};
const _json: JSONValue = null;
const _evt: IntentEvent = {
  action_name: "test",
  action_params: {},
  staging_snapshot: {},
  timestamp: 0,
};
void _b;
void _m;
void _v;
void _e;
void _id;
void _snap;
void _json;
void _evt;
```

```bash
npm run typecheck
```

Expected: clean exit. The verification file confirms every new export resolves correctly through the barrel.

- [ ] **Step 5: Add a runtime regression test for Invariants 14 and 15**

Spec Invariant 14 ("purely additive to core exports") and Invariant 15 ("`IntentEvent` shape matches headless spec") require runtime assertions, not just compile-time resolution. Create `packages/core/src/runtime-barrel.test.ts`:

```typescript
import { describe, test, expect } from "vitest";
import * as core from "./index";

describe("runtime barrel — Invariant 14 (purely additive)", () => {
  // Names that existed BEFORE the runtime module landed. If any of these
  // disappears, the addition stopped being purely additive and a downstream
  // package will break. Update only when intentionally removing/renaming.
  const PREEXISTING_VALUE_EXPORTS = [
    "DynamicValueSchema",
    "DynamicStringSchema",
    "DynamicNumberSchema",
    "DynamicBooleanSchema",
    "resolveDynamicValue",
    "getByPath",
    "setByPath",
    "VisibilityConditionSchema",
    "LogicExpressionSchema",
    "evaluateVisibility",
    "evaluateLogicExpression",
    "visibility",
    "ActionSchema",
    "ActionConfirmSchema",
    "ActionOnSuccessSchema",
    "ActionOnErrorSchema",
    "resolveAction",
    "executeAction",
    "interpolateString",
    "action",
    "ValidationCheckSchema",
    "ValidationConfigSchema",
    "builtInValidationFunctions",
    "runValidationCheck",
    "runValidation",
    "check",
    "createCatalog",
    "generateCatalogPrompt",
  ] as const;

  for (const name of PREEXISTING_VALUE_EXPORTS) {
    test(`pre-existing export "${name}" is still defined`, () => {
      expect((core as Record<string, unknown>)[name]).toBeDefined();
    });
  }

  test("the four new value exports are defined", () => {
    expect(core.createStagingBuffer).toBeDefined();
    expect(core.createObservableDataModel).toBeDefined();
    expect(core.validateJSONValue).toBeDefined();
    expect(core.InitialDataNotSerializableError).toBeDefined();
  });
});

describe("runtime barrel — Invariant 15 (IntentEvent shape)", () => {
  test("IntentEvent satisfies the spec's required field shape", () => {
    // Compile-time check via type assignment + runtime construction. If any
    // required field is renamed or its type tightened, this file fails to
    // typecheck — that's the assertion. The runtime expect is a sanity check.
    const event: core.IntentEvent = {
      action_name: "submit",
      action_params: {
        foo: "bar",
        n: 42,
        ok: true,
        list: [1, 2, 3],
        nested: { k: "v" },
      },
      staging_snapshot: { email: "x@y.z", agree: true },
      catalog_version: "v1.2.3",
      timestamp: Date.now(),
    };
    expect(event.action_name).toBe("submit");
    expect(event.staging_snapshot).toEqual({ email: "x@y.z", agree: true });
    expect(typeof event.timestamp).toBe("number");
  });
});
```

```bash
npx vitest run packages/core/src/runtime-barrel.test.ts
```

Expected: PASS. ~30 tests (one per pre-existing export plus the new-exports test plus the IntentEvent shape test).

- [ ] **Step 6: Delete the temporary verification file**

```bash
rm packages/core/src/runtime-export-check.ts
```

The barrel regression test from Step 5 stays — it's a permanent regression guard.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/index.ts packages/core/src/runtime-barrel.test.ts
git commit -m "feat(core): re-export runtime types from index.ts barrel + add Invariant 14/15 regression tests"
```

---

### Task 7: Final verification

**Goal:** Confirm the complete plan deliverables work end-to-end. Run typecheck, full test suite, and build. No code changes — pure verification.

**Files:** None modified.

- [ ] **Step 1: Run full typecheck across both packages**

```bash
npm run typecheck
```

Expected: clean exit, both `@json-ui/core` and `@json-ui/react` typecheck successfully.

- [ ] **Step 2: Run the full vitest suite**

```bash
npm test
```

Expected: PASS. The test count is the previous baseline (160 tests) plus approximately 60 new tests from `runtime.test.ts` and `runtime-validation.test.ts`. Total approximately 220 tests across 11 files.

- [ ] **Step 3: Run the production build**

```bash
npm run build
```

Expected: clean build of both packages. The new `runtime.ts` is bundled into `packages/core/dist/` via tsup. Verify the dist outputs include the new exports:

```bash
grep -c "createStagingBuffer\|createObservableDataModel\|InitialDataNotSerializableError" packages/core/dist/index.js
```

Expected: a number greater than 3 (each exported name appears at least once in the bundled output).

- [ ] **Step 4: Verify no React imports leaked into runtime.ts**

```bash
grep -E "from ['\"](react|react-dom|jsdom)['\"]" packages/core/src/runtime.ts || echo "OK - no framework imports"
```

Expected: `OK - no framework imports`.

- [ ] **Step 5: Final commit (no-op or cleanup)**

If any cosmetic changes were needed during verification, commit them. Otherwise this task ends without a commit.

```bash
git status
```

Expected: clean working tree. If clean, no commit needed.

---

## Self-Review

**Spec coverage:** The spec defines `FieldId` (Task 2), `JSONValue` (Task 2), `StagingSnapshot` (Task 2), `IntentEvent` (Task 2), `InitialDataNotSerializableError` (Task 3), `validateJSONValue` (Task 3), `StagingBuffer` interface and `createStagingBuffer` factory (Task 4), `ObservableDataModel` interface and `createObservableDataModel` factory (Task 5), and core barrel exports (Task 6). Every spec deliverable maps to a task.

**Spec testable invariants coverage:**

- Invariant 1 (identity-stable snapshots) → Task 4 Step 7, Task 5 Step 9
- Invariant 2 (snapshot invalidates on set) → Task 4 Step 7, Task 5 Step 9
- Invariant 3 (snapshot invalidates on delete) → Task 4 Step 7
- Invariant 4 (snapshot invalidates on reconcile) → Task 4 Step 7
- Invariant 5 (synchronous notification) → Task 4 Step 9, Task 5 Step 9
- Invariant 6 (listener errors swallowed) → Task 4 Step 9
- Invariant 7 (idempotent subscribe) → Task 4 Step 9
- Invariant 8 (idempotent unsubscribe) → Task 4 Step 9
- Invariant 9 (set notifies on equal value) → Task 4 Step 9
- Invariant 10 (initialData validation) → Task 5 Step 7
- Invariant 11 (disqualified value matrix exhaustive) → Task 3 Step 9
- Invariant 12 (plain-object acceptance) → Task 3 Step 9
- Invariant 13 (no React/DOM imports) → Task 7 Step 4
- Invariant 14 (purely additive to core exports) → Task 6 Step 4
- Invariant 15 (IntentEvent shape matches headless spec) → Task 2 Step 1 (declaration matches spec)

**Placeholder scan:** No TBDs, TODOs, or "implement later" anywhere. Each step has full code.

**Type consistency:** The interface declarations in Tasks 4 and 5 match the type signatures referenced in subsequent test code. Method names (`get`, `set`, `delete`, `has`, `snapshot`, `reconcile`, `subscribe`) and field names (`fieldId`, `path`, `liveIds`) are consistent across declaration and tests.

**No issues found in self-review.** Plan is ready for execution.

---

## What's done after this plan

After Task 7 commits cleanly:

- `@json-ui/core` exports the full runtime types module: types, error class, validator, and two observable-store factories.
- Approximately 60 new tests across `runtime.test.ts` and `runtime-validation.test.ts` cover every testable invariant from the spec.
- The new code has zero framework dependencies and no breaking changes to existing core exports.
- The next plans (`2026-04-13-react-external-data-store-plan.md` and `2026-04-13-headless-renderer-plan.md`) can both consume from `@json-ui/core` immediately. They are independent of each other and can be executed in either order or in parallel.
