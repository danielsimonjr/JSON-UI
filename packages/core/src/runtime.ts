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
