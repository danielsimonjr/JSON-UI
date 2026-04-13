# @json-ui/core Runtime Types Module Design

**Status:** Design spec (not yet implemented)
**Date:** 2026-04-13
**Scope:** A new module `packages/core/src/runtime.ts` that adds observable-store primitives to `@json-ui/core`: `FieldId`, `StagingSnapshot`, `JSONValue`, `StagingBuffer` + `createStagingBuffer`, `ObservableDataModel` + `createObservableDataModel`, and `IntentEvent`. Purely additive to `@json-ui/core`'s public surface. This is Prerequisite 1 of the headless renderer spec and is required before either `@json-ui/headless` or the `@json-ui/react` external-store refactor can land.

## Context

The headless renderer spec (`2026-04-13-headless-renderer-design.md`) defines a dual-backend architecture where `@json-ui/react` and `@json-ui/headless` run simultaneously against shared state. For the two backends to actually share state, they both need to import the _same_ types — not structurally compatible parallel copies. The shared types must live in the common dependency, which is `@json-ui/core`.

The headless renderer spec describes these types in its "Runtime Types and the Observable Store Pattern" section. That section is the authoritative definition. This spec is a delivery spec: it defines how those types land in `@json-ui/core` as a concrete module, what the implementation requirements are, and how the additions integrate with core's existing exports without breaking anything.

The review team's Round 1 finding was that the first draft of the headless spec wanted to "promote" these types from the Neural Computer (NC) runtime into core. That turned out to be impossible because the types don't exist anywhere yet — NC's ephemeral-UI-state spec describes a raw `Map<FieldId, unknown>` staging buffer, no TypeScript source has been written for it, and the headless renderer needs a richer interface (subscribe/notify, identity-stable snapshots, structural validation) than a bare Map can provide. There is nothing to promote. This spec authors the runtime types fresh in core.

## Design Goals

**Framework-agnostic.** The new module imports nothing from `react`, `react-dom`, `jsdom`, or any DOM globals. It depends only on plain JavaScript primitives and `zod` (which `@json-ui/core` already depends on). A test asserts the import set is clean.

**Purely additive.** No existing `@json-ui/core` export is renamed, removed, or changed in shape. The new module adds eight new exports to `packages/core/src/index.ts`. Consumers who don't touch the new exports see identical behavior and identical types.

**React 18 useSyncExternalStore-compatible.** `StagingBuffer.subscribe` and `ObservableDataModel.subscribe` match React 18's external-store contract: subscribe takes a callback and returns an unsubscribe function; snapshots are identity-stable (same reference returned across successive calls with no mutation) so React's `Object.is` comparison doesn't trigger infinite re-render loops.

**Runtime validation.** `createObservableDataModel`'s factory validates any `initialData` at construction time using structural JSON recursion and throws `InitialDataNotSerializableError` on the first non-`JSONValue` leaf. The validator is strict (refuses `Date`, `Map`, `Set`, typed arrays, etc. — full list below) and runs exactly once at construction.

**Zero behavioral changes to existing core code.** No file under `packages/core/src/` other than the new `runtime.ts` and the `index.ts` barrel is modified. The existing `types.ts`, `visibility.ts`, `actions.ts`, `validation.ts`, `catalog.ts` are untouched.

## Module Layout

New file: `packages/core/src/runtime.ts`

Modified file: `packages/core/src/index.ts` (add re-exports)

New test files:

- `packages/core/src/runtime.test.ts` — covers the core behaviors
- `packages/core/src/runtime-validation.test.ts` — covers the disqualified-value validation matrix

Nothing else in `packages/core/` changes. The new file is a single self-contained module with roughly 200-300 lines of implementation plus tests.

## What This Spec Defines

The full type signatures and behavioral contracts are defined in the headless renderer spec's "Runtime Types and the Observable Store Pattern" section — that's the authoritative source. This spec does not repeat those type definitions; it references them and focuses on delivery:

1. **`FieldId`** — nominal `string` alias.
2. **`JSONValue`** — the recursive JSON-serializable type union.
3. **`StagingSnapshot`** — `Record<FieldId, JSONValue>`.
4. **`StagingBuffer` interface** — the seven-method observable contract.
5. **`createStagingBuffer(): StagingBuffer`** — factory for the default implementation.
6. **`ObservableDataModel` interface** — path-based observable store.
7. **`createObservableDataModel(initialData?: Record<string, JSONValue>): ObservableDataModel`** — factory with structural validation.
8. **`IntentEvent`** — cross-backend intent payload.
9. **`InitialDataNotSerializableError`** — thrown by the validator.

Plus one new internal helper:

10. **`validateJSONValue(value: unknown, path: string): void`** — the structural-recursion validator, exported as internal-use (used by `createObservableDataModel` and by `@json-ui/headless`'s session constructor for `initialData` on the ephemeral path).

## Implementation Requirements

### `createStagingBuffer()`

Default implementation is `Map<FieldId, JSONValue>`-backed with a cached snapshot and a listener set. The cache invalidates on `set`, `delete`, and `reconcile`. Notifications fire synchronously before the mutating call returns.

Sketch:

```typescript
export function createStagingBuffer(): StagingBuffer {
  const store = new Map<FieldId, JSONValue>();
  const listeners = new Set<() => void>();
  let cachedSnapshot: StagingSnapshot | null = null;

  const invalidateAndNotify = () => {
    cachedSnapshot = null;
    // Copy listener set first so a listener that unsubscribes itself mid-notify
    // does not affect the current iteration.
    for (const listener of Array.from(listeners)) {
      try {
        listener();
      } catch (err) {
        // Swallow listener errors; subscribe callbacks MUST NOT crash the store.
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
      let changed = false;
      for (const key of Array.from(store.keys())) {
        if (!liveIds.has(key)) {
          store.delete(key);
          changed = true;
        }
      }
      // Reconcile notifies once at end per the headless spec, regardless of
      // whether anything was actually dropped — the call itself is a mutation
      // event in the store's contract.
      cachedSnapshot = null;
      invalidateAndNotify();
      void changed;
    },
    subscribe(callback) {
      listeners.add(callback);
      let unsubscribed = false;
      return () => {
        if (unsubscribed) return; // idempotent
        unsubscribed = true;
        listeners.delete(callback);
      };
    },
  };
}
```

Key implementation notes:

- **Identity-stable snapshots.** `cachedSnapshot` is set once after each mutation and reused until the next mutation. Two back-to-back `snapshot()` calls with no intervening write return the same reference. Required for React's `useSyncExternalStore`.
- **Listener errors are swallowed.** A subscriber callback that throws must not affect the store's state or prevent other subscribers from firing. Errors are logged via `console.error` and discarded.
- **Set-during-notify is allowed.** A subscriber that calls `set` or `delete` during its own notification does not cause infinite recursion _within that call_ — the nested mutation runs, invalidates the cache, and notifies other subscribers (the notifying listener is already in the Array.from'd iteration set, so it doesn't re-notify itself within the current loop). Tests must verify this behavior and document the iteration semantics.
- **Registering the same callback twice creates two independent subscriptions.** Each call to `subscribe` returns a distinct unsubscribe handle.
- **Double-unsubscribe is a no-op.** The returned unsubscribe closes over a local `unsubscribed` flag.

### `createObservableDataModel(initialData?)`

Same pattern as `createStagingBuffer` but keyed by path (using the same `/`-separated path convention as core's existing `getByPath` / `setByPath` helpers in `packages/core/src/types.ts`).

The factory runs `validateJSONValue(initialData, "")` before constructing the store. If validation throws, the factory rethrows as `InitialDataNotSerializableError`, surfacing the offending path and the offending value's type.

The internal store is `Record<string, JSONValue>` (a plain nested object), NOT a `Map`. This matches how `getByPath`/`setByPath` already work in core.

The `snapshot()` method returns a cached reference to the internal object, identity-stable until the next mutation. `set(path, value)` mutates the object in place (via `setByPath`) and invalidates the cache. `delete(path)` removes the leaf (and prunes now-empty parent containers — or leaves them; Open Question 2 below).

### `validateJSONValue(value, path)`

Structural recursion validator. Rules:

**Allowed leaves:** `null`, `true`, `false`, finite `number` (excluding `NaN`, `Infinity`, `-Infinity`), `string`.

**Allowed containers:**

- `Array.isArray(value)` is true, AND every element passes `validateJSONValue(element, path + "/" + index)`.
- `typeof value === "object"`, `value !== null`, AND (`Object.getPrototypeOf(value) === Object.prototype` OR `Object.getPrototypeOf(value) === null`), AND every enumerable own-property value passes `validateJSONValue(v, path + "/" + key)`. No symbol keys allowed.

**Disqualified:** everything else, explicitly including:

- `undefined`
- `BigInt`
- `Symbol`
- `function`
- `NaN`, `Infinity`, `-Infinity`
- Circular references (detected via a WeakSet of visited objects — any object reached twice during recursion throws `InitialDataNotSerializableError` with path `"<circular reference>"`)
- `Date`, `Map`, `Set`, `WeakMap`, `WeakSet`, `RegExp`
- `Error` and all subclasses
- Typed arrays (`Uint8Array`, `Int32Array`, `Float64Array`, etc.) and `ArrayBuffer`/`SharedArrayBuffer`
- Any object whose prototype is neither `Object.prototype` nor `null` (catches class instances like `URL`, `Buffer`, `Promise`, and user classes)

**Failure mode:** throw `new InitialDataNotSerializableError(path, value)` where the error's `message` is `"initialData contains non-JSON-serializable value at path '<path>': <typeName>"`. The error class exposes `path: string` and `actualType: string` fields for programmatic inspection.

**Realm-crossing plain objects** (e.g., from `vm.runInNewContext`) have a different `Object.prototype` reference than the current realm. The validator accepts them if the prototype chain exits at `null` after one step, or if structural-typing tests confirm the object behaves like a plain data container. Simplest implementation: check `Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null || Object.getPrototypeOf(Object.getPrototypeOf(value)) === null`. A more conservative implementation serializes the suspicious object with `JSON.stringify` and `JSON.parse`s it back, comparing deep equality — but that is v1.1 work if the simple check proves insufficient.

## Integration with Existing Core Exports

`packages/core/src/index.ts` adds these lines (in alphabetical / logical order alongside existing exports):

```typescript
// Runtime types (new in this spec — see runtime.ts and the headless renderer spec)
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
  InitialDataNotSerializableError,
} from "./runtime";
```

No other change to `index.ts`. The existing catalog, visibility, actions, and validation exports are preserved in the same order they are today.

## Testable Invariants

Every invariant maps to a test in `runtime.test.ts` or `runtime-validation.test.ts`.

1. **Identity-stable snapshots.** Two back-to-back `buf.snapshot()` calls with no intervening mutation return the same reference (`===`).
2. **Snapshot invalidates on set.** After `buf.set("x", 1)`, `buf.snapshot()` returns a new reference distinct from the previous snapshot.
3. **Snapshot invalidates on delete.** After `buf.delete("x")`, `buf.snapshot()` returns a new reference.
4. **Snapshot invalidates on reconcile.** After `buf.reconcile(new Set(["x"]))`, `buf.snapshot()` returns a new reference even if no entries were actually dropped.
5. **Synchronous notification.** A subscriber registered via `buf.subscribe(cb)` fires synchronously before `buf.set(id, value)` returns. Test verifies this with a counter incremented by the subscriber and asserted on the line following `set`.
6. **Listener errors are swallowed.** A subscriber that throws does not crash `set` / `delete` / `reconcile` and does not prevent other subscribers from firing. The error is written to `console.error`; no other side effect.
7. **Idempotent subscribe.** Registering the same callback twice creates two subscriptions (both fire on every mutation, each has a distinct unsubscribe handle).
8. **Idempotent unsubscribe.** Calling a returned unsubscribe function twice is a no-op; the second call does not throw.
9. **`set` notifies on equal value.** Calling `buf.set("x", 1)` and then `buf.set("x", 1)` (same value) fires the subscriber twice. Idempotent-notification contract.
10. **`createObservableDataModel` validates initialData.** Passing any disqualified value throws `InitialDataNotSerializableError` with a non-empty `path` field.
11. **Disqualified value matrix — exhaustive.** Every disqualified value (per the list above) is tested in three positions: top-level property, nested one level inside a plain object, nested inside an array. Each position asserts the factory throws and the error's `path` field reflects the nested position correctly.
12. **Plain-object acceptance.** Realm-crossing plain objects (constructed via `Object.create(null)`) are accepted if their own-enumerable values all pass. `Object.create(null)` with a `string` property passes; `Object.create(null)` with a `Date` property throws.
13. **No React or DOM imports.** `runtime.ts` has zero static imports from `react`, `react-dom`, `jsdom`, or any DOM-global module. Enforced by a test that reads the file content and asserts the import set.
14. **Purely additive to core exports.** A test imports every pre-existing export from `@json-ui/core`'s `index.ts` and asserts each is still present and has the same type signature. Regression guard against accidental removal.
15. **`IntentEvent` shape matches headless spec.** The `IntentEvent` interface has exactly the fields `action_name`, `action_params`, `staging_snapshot`, `catalog_version?`, `timestamp` with the types the headless spec defines. Structural equality check via a type-level assertion.

## What This Spec Is Not

- **Not a redefinition of the runtime types.** The authoritative definitions live in the headless renderer spec's "Runtime Types and the Observable Store Pattern" section. This spec is the delivery vehicle into core, not the design of the types themselves.
- **Not a React integration spec.** The React-side work lives in `2026-04-13-react-external-data-store-design.md` (Prerequisite 2). This spec defines what core provides; that spec defines how `@json-ui/react` consumes it.
- **Not a performance spec.** The implementation is a `Map`/object-backed store with cached snapshots. No micro-optimization, no benchmarks, no lazy invalidation. If performance becomes an issue, v1.1 addresses it.
- **Not a persistence spec.** Both stores are in-memory only. Consumers who want persistence wrap the store with their own serialization layer.
- **Not a CRDT or conflict-resolution spec.** The stores are last-write-wins with no versioning or vector clocks. Coordination across writers is the caller's concern (NC handles this at the orchestrator level).

## Open Questions

1. **How are path components with slashes escaped in `ObservableDataModel`?** Core's existing `getByPath` / `setByPath` use `/` as the path separator. If a user wants a literal `/` in a key, the spec is silent. Options: (a) disallow `/` in path components (validate at `set`-time), (b) use URL-style `%2F` escaping, (c) support array-based path arguments as an alternative to string paths. **Leaning** option (a) for v1 — disallow literal slashes in path components, document the restriction, and revisit if a consumer hits it. The existing `getByPath` doesn't document this either, so this spec's decision is consistent with current core behavior.

2. **Does `delete(path)` prune now-empty parent containers?** If `ObservableDataModel.set("user/profile/name", "Alice")` creates `{user: {profile: {name: "Alice"}}}`, what does `delete("user/profile/name")` leave behind? (a) Leaves `{user: {profile: {}}}` — simple but accumulates empty containers over time. (b) Prunes empty containers, leaving `{}`. (c) Leaves `{user: {profile: {}}}` but exposes a separate `vacuum()` method for explicit pruning. **Leaning** option (a) for v1 — simplest, predictable, and lets consumers prune explicitly if they want.

3. **Should `snapshot()` be deep-frozen (`Object.freeze` recursively)?** Currently the spec says "not frozen but callers MUST NOT mutate." A deep freeze would enforce this at runtime. Cost: traversing the snapshot to freeze every nested object; O(n) per invalidation. Benefit: catches bugs where a consumer mutates the snapshot and then reads from it expecting the mutation to take effect. **Leaning** no freeze in v1 — the cost is real and the snapshot's honor-system contract is documented. v1.1 can add a `createStagingBuffer({ freezeSnapshots: true })` option if a consumer hits a real bug.

## Non-Goals

- **No cross-process sharing.** Both stores are in-process only. Consumers that want to share a store across workers serialize it themselves.
- **No write batching.** Every `set` fires subscribers synchronously. Consumers that want batching install a debounced adapter between their writer and the store.
- **No type inference from a schema.** `StagingBuffer` is untyped at the value level — `get("anything")` returns `JSONValue | undefined`, not a narrower type. Type-safe keyed stores are a separate concern (NC's catalog provides that discipline at the component layer).
- **No integration tests with `@json-ui/react` in this spec.** Those live in the Prerequisite 2 spec.

## Prior Art

- **React 18's `useSyncExternalStore`.** The subscribe/snapshot contract for `StagingBuffer` and `ObservableDataModel` is designed to be a drop-in external store for this hook. React's documentation on concurrent-mode tearing and the `Object.is`-based snapshot comparison directly informed the identity-stable caching requirement.
- **Zustand's `StoreApi`.** Zustand's minimal external-store API (`getState`, `setState`, `subscribe`, `destroy`) is structurally similar. This spec's stores differ in being path-based (for the data model) and field-id-based (for the staging buffer) rather than whole-state-replacement.
- **Jotai and Valtio.** Both offer observable stores with React integration, but bind their API to JSX-side atoms and proxies. This spec deliberately stays framework-agnostic — no JSX, no proxies in the default implementation.
- **`@json-ui/core`'s existing `getByPath` / `setByPath`.** The `ObservableDataModel`'s path semantics match these existing helpers to minimize cognitive load for consumers already familiar with core.
