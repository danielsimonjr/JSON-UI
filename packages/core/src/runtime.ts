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
  // URL has its own instanceof branch so the error message reads "URL" rather
  // than falling through to the "URL (non-plain object)" generic path. This
  // matches the Date/RegExp/Error/Map/Set error-message convention.
  if (typeof URL !== "undefined" && value instanceof URL)
    throw new InitialDataNotSerializableError(path, "URL");
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
  // Use a Map keyed by a unique symbol per subscription so that the same
  // callback function can be registered multiple times as independent
  // subscriptions. This satisfies the spec requirement that registering
  // the same callback twice produces two independent subscriptions.
  const listeners = new Map<symbol, () => void>();
  let cachedSnapshot: StagingSnapshot | null = null;

  const invalidateAndNotify = () => {
    cachedSnapshot = null;
    // Snapshot the listener values so a listener that unsubscribes itself
    // mid-notify does not affect the current iteration.
    for (const listener of Array.from(listeners.values())) {
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
      const id = Symbol();
      listeners.set(id, callback);
      let unsubscribed = false;
      return () => {
        if (unsubscribed) return;
        unsubscribed = true;
        listeners.delete(id);
      };
    },
  };
}

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
 * Returns `undefined` for the empty path — callers that want the whole state
 * should use `snapshot()`, which returns an identity-stable immutable view.
 * Returning `root` here would hand callers a reference to the live mutable
 * internal store, letting them bypass `invalidateAndNotify()` and break
 * React's `useSyncExternalStore` tearing protection.
 */
function getAtPath(
  root: Record<string, JSONValue>,
  path: string,
): JSONValue | undefined {
  if (path === "") return undefined;
  const parts = path.split("/").filter((p) => p.length > 0);
  if (parts.length === 0) return undefined;
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
 * plain objects as needed. Mutates `root` in place. Returns `true` if a value
 * was written, `false` if the path was empty (no-op). The boolean return lets
 * the caller skip `invalidateAndNotify()` for no-op writes so subscribers are
 * not fired for mutations that never happened.
 */
function setAtPath(
  root: Record<string, JSONValue>,
  path: string,
  value: JSONValue,
): boolean {
  const parts = path.split("/").filter((p) => p.length > 0);
  if (parts.length === 0) return false;
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
  return true;
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
  // Use a Map keyed by a unique symbol per subscription so that the same
  // callback function can be registered multiple times as independent
  // subscriptions. Matches the StagingBuffer listener pattern (Task 4 fix).
  const listeners = new Map<symbol, () => void>();
  let cachedSnapshot: Readonly<Record<string, JSONValue>> | null = null;

  const invalidateAndNotify = () => {
    cachedSnapshot = null;
    for (const listener of Array.from(listeners.values())) {
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
      // Mirror the delete() pattern: only notify subscribers if the path
      // helper actually wrote something. Empty paths are a no-op that must
      // not fire spurious notifications or invalidate the snapshot cache.
      if (setAtPath(root, path, value)) {
        invalidateAndNotify();
      }
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
      const id = Symbol();
      listeners.set(id, callback);
      let unsubscribed = false;
      return () => {
        if (unsubscribed) return;
        unsubscribed = true;
        listeners.delete(id);
      };
    },
  };
}
