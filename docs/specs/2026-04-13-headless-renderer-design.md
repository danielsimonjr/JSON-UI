# Headless Renderer Design

**Status:** Design spec (not yet implemented)
**Date:** 2026-04-13
**Scope:** A third JSON-UI package, `@json-ui/headless`, that renders constrained-catalog UI trees to a normalized intermediate representation — no React, no DOM, no browser assumptions. Primary consumer: the Neural Computer runtime's LLM Observer layer, which needs a machine-readable view of the UI state that runs simultaneously with (not instead of) the browser-based React renderer, sharing staging and data state so both backends see the same world.

## Context and Motivation

The Neural Computer (NC) runtime has three system components plus a cross-cutting observer:

1. **UI Layer — JSON-UI.** Renders via `@json-ui/react` into a browser window (Chrome or Electron). This is what the user sees.
2. **Process Layer — Python/Node REPL.** Handles compute, I/O, and the interface to storage. Executes work on behalf of actions.
3. **Memory Layer — memoryjs.** Durable state, short- and long-term memory, and LLM context material.
4. **Observer Layer — the LLM (Agentic Interface).** Not one of the three components but a cross-cutting layer that monitors logs and transactions flowing between the components and intervenes when necessary to translate user intentions into actions. The LLM extends the UI for the user on demand — dispatching actions, injecting new UI trees, modifying state — through the same primitives the user's own interactions flow through.

The React backend serves the first three components adequately. It does not serve the Observer. A React element tree inside a Chrome window is opaque to an LLM — there is no machine-readable snapshot of "what the user currently sees" that the Observer can reason about, no structured event stream of "what just happened across the components" it can subscribe to, and no ergonomic path for the Observer to dispatch actions through the same catalog contract the user's clicks go through.

The headless renderer fills this gap. It is **not an alternative** to the React renderer — both run simultaneously. They share staging-buffer and data-model references (ultimately backed by memoryjs), so a user typing in the browser immediately shows up in the headless view, and an Observer-dispatched action immediately reflects in the browser. The React backend produces pixels for the user; the headless backend produces a `NormalizedNode` tree for the Observer. Both emit `IntentEvent`s through the same NC contract.

## The Problem

The React backend couples three concerns that can be separated:

1. **Rendering** — walking the catalog tree, evaluating visibility, resolving dynamic values, invoking components to produce output.
2. **Execution environment** — React's fiber reconciler + hooks + context propagation.
3. **Output format** — React elements rendered into a browser DOM.

Any consumer that wants the first without the second two is stuck reimplementing the catalog walking, visibility evaluation, and action dispatch from scratch. The whole point of `@json-ui/core` is that these primitives are framework-agnostic, but without a second backend there is no forcing function to keep them that way. And for the NC Observer, there is currently no way to observe the render loop at all — React's reconciler does not expose a structured event stream a non-React subscriber can consume.

The headless renderer is the forcing function for both problems. Building it proves `@json-ui/core` can drive a render loop in a non-React environment, and its `RenderHooks` interface gives the Observer a serializable, subscribable stream of everything happening in the UI Layer — the events that feed into NC's cross-component transaction log.

## Design Goals

Three properties are called out explicitly because the spec trades against other concerns (upfront complexity, surface area) to get them:

**Extensibility.** Every axis on which a consumer might want to plug something in is an explicit extension point with a named interface, not a fork-point requiring internal changes. The extension points are: components (via a typed registry), serializers (via a `Serializer<Output>` interface), state backends (staging buffer and data model are both swappable), render lifecycle hooks (observability), and validation functions (inherited from core's existing `customFunctions` mechanism).

**Maintainability.** Files are small and single-responsibility. The `walker` knows nothing about components. The `renderer` knows nothing about HTML. The `serializers` know nothing about state. The `context` knows nothing about the tree shape. This lets each unit be reasoned about in isolation, tested in isolation, and replaced without cascading edits.

**Observability.** Every render is traceable through a `RenderHooks` interface that exposes before/after events for the render loop, per-element render events, visibility evaluation, validation runs, action dispatch, state mutations, and errors (categorized by phase). This is the load-bearing infrastructure the NC Observer uses to perceive the system. In the NC architecture, the LLM monitors logs and transactions flowing between components and intervenes when necessary to translate user intent into action; the headless renderer is one of the primary publishers to that transaction stream, and its `RenderHooks` interface defines what the UI Layer contributes. The default hooks are still no-ops for consumers that don't need them, but the design point is that observability is not optional for NC — it is how the Observer sees the UI Layer at all. This is the single largest addition over `@json-ui/react`, which has no render-level observability surface.

**Events are serializable.** Every hook event is a plain JavaScript object that round-trips through `JSON.stringify` / `JSON.parse` without loss. No React refs, no class instances, no closures, no symbols. This constraint is what makes cross-process observation possible: the NC Observer can run in the same Node process as the headless renderer and subscribe to hooks directly, or it can run in a separate process (or even a separate machine) and consume a log file, a socket, or a message-queue feed of the same event stream. The spec enforces this at the test level — see Testable Invariant 11.

Two other goals are non-negotiable but less interesting:

**Framework-agnostic.** The package depends on `@json-ui/core` and nothing else at runtime. No React, no ReactDOM, no jsdom. Dev dependencies include `tsup`, `typescript`, `vitest` for building and testing.

**Dual-backend shared state.** The headless renderer is designed to run simultaneously with the React backend, sharing staging-buffer and data-model references. A `HeadlessRenderer` session accepts `options.staging` and `options.data` so NC can construct both sessions against the same state references; mutations in either backend are visible to both. A session that omits these options gets its own fresh staging/data — useful for standalone testing — but the production NC architecture always passes shared references.

**NC intent-loop compatible.** The session API must support NC's full intent-event loop: catalog-driven action dispatch, staging buffer reconciliation, `DynamicValue` pre-resolution, `IntentEvent` emission with the same shape NC already consumes. Actions dispatched through the headless session produce `IntentEvent`s structurally identical to those from the React backend, and both feed the same NC intent handler — whether the dispatcher was the user (via a React button click) or the LLM Observer (via a programmatic `session.dispatch(...)` call).

## Package Layout

```
packages/headless/
├── src/
│   ├── index.ts              # public exports (barrel)
│   ├── types.ts              # NormalizedNode, NormalizedAction, NormalizedValidation
│   ├── context.ts            # HeadlessContext interface + createHeadlessContext
│   ├── staging.ts            # re-export of a headless-friendly StagingBuffer
│   ├── registry.ts           # HeadlessComponent type + HeadlessRegistry type
│   ├── walker.ts             # tree traversal that produces NormalizedNode output
│   ├── renderer.ts           # createHeadlessRenderer — the session factory
│   ├── hooks.ts              # RenderHooks interface + no-op default
│   ├── errors.ts             # typed errors (RenderError, DispatchError, etc.)
│   ├── helpers/
│   │   └── collect-ids.ts    # field ID walker for staging reconciliation
│   └── serializers/
│       ├── index.ts          # serializer interface + barrel
│       ├── html.ts           # NormalizedNode -> HTML string
│       └── json.ts           # NormalizedNode -> JSON (identity + safe stringify)
├── package.json              # depends on @json-ui/core only
├── tsconfig.json             # extends ../../tsconfig.base.json
├── tsup.config.ts            # CJS + ESM + .d.ts outputs
└── README.md
```

Every file has one clear responsibility. The longest file in v1 is expected to be `renderer.ts` (the session factory wiring everything together), and even that should stay under 200 lines. Anything bigger is a signal that a unit is doing too much and should be split.

## The Normalized Tree

The central data structure the renderer produces. It is a pure JavaScript object, serializable without any custom logic, and contains everything a consumer needs to display the UI or assert on its state without re-running any evaluation.

_Note: `NormalizedNode` uses `JSONValue` in several field types. `JSONValue` is defined in the "Runtime Types and the Observable Store Pattern" section below. For the moment, read `JSONValue` as "any JSON-round-trippable value" — the formal definition is a union of `null | boolean | number | string | JSONValue[] | {[k: string]: JSONValue}`._

```typescript
/** A rendered element node. Fully resolved — no dynamic values, no unevaluated visibility. */
export interface NormalizedNode {
  /** Stable element key from the original UITree. Used for testing, diffing, tracing. */
  key: string;
  /** Component type from the catalog (e.g., "TextField", "Checkbox"). */
  type: string;
  /** Resolved props. DynamicValue entries have been substituted against data + staging. JSON-serializable. */
  props: Record<string, JSONValue>;
  /** Rendered children in document order. Elements filtered by visibility are absent. */
  children: NormalizedNode[];
  /** Resolved action descriptors, keyed by the prop name that carried the action in the source tree. */
  actions?: Record<string, NormalizedAction>;
  /** Current validation state for this element, if the element had a validation config. */
  validation?: NormalizedValidation;
  /** Optional metadata for observability — set only when RenderHooks are in use. */
  meta?: {
    renderDurationMs?: number;
    visible: boolean; // always true in output; false-visibility elements are pruned
    validatedAt?: number; // timestamp of last validation run
  };
}

/** A fully-resolved action, ready for dispatch. */
export interface NormalizedAction {
  /** Action name from the catalog (e.g., "submit_form"). */
  name: string;
  /** Resolved params. DynamicValue entries substituted against data + staging. JSON-serializable. */
  params: Record<string, JSONValue>;
  /** Optional confirmation dialog config, pass-through from catalog. */
  confirm?: {
    title: string;
    message: string;
    variant?: "default" | "danger";
  };
}

/** Validation state for a single element's input. */
export interface NormalizedValidation {
  valid: boolean;
  errors: Array<{ message: string; fn?: string }>;
}
```

Elements whose `evaluateVisibility` returns false are **absent from the parent's `children` array**, not included with a `visible: false` flag. This is deliberate: it means every consumer (HTML serializer, JSON serializer, test assertion) sees only what the user would see, without needing to filter. The `meta.visible` field always holds `true` on nodes that reach the output — it exists so that observability hooks can emit before/after data.

`NormalizedNode` is recursive and cycle-free. Consumers can `JSON.stringify` it directly. There are no class instances, no React elements, no functions — just data.

## Runtime Types and the Observable Store Pattern

Before the Session API, this spec defines the runtime types that the session operates on. These types are **authored fresh in `@json-ui/core`** (not promoted from anywhere — see Open Question 5). They are the foundation that both the headless backend and `@json-ui/react`'s future external-store mode build on, and the NC runtime consumes them unchanged.

All runtime types are declared in a new core module `packages/core/src/runtime.ts`. The types are exported from `@json-ui/core`'s public index alongside the existing catalog and visibility exports.

### FieldId and StagingSnapshot

```typescript
/** Stable identifier for an input field within a rendered UI tree. */
export type FieldId = string;

/** A plain-JSON snapshot of the staging buffer at a single point in time. */
export type StagingSnapshot = Record<FieldId, JSONValue>;
```

`FieldId` is a nominal string alias; making it nominal costs nothing and documents the intent. `StagingSnapshot` values are constrained to `JSONValue` (defined below) rather than `unknown` — consumers who want non-JSON values in input fields must serialize at the boundary.

### JSONValue

```typescript
/** The subset of JavaScript values that survive a JSON.stringify / JSON.parse round trip losslessly. */
export type JSONValue =
  | null
  | boolean
  | number
  | string
  | JSONValue[]
  | { [key: string]: JSONValue };
```

`JSONValue` is the canonical "serializable" type across the runtime module. Every hook event payload, every staging buffer value, and every data-model entry the spec claims is "serializable" must satisfy this type. TypeScript enforces it at compile time; the session constructor validates runtime input at session creation and throws if `initialData` or pre-seeded staging values contain a `Date`, `Map`, `Set`, class instance, function, or symbol. This is how Testable Invariant 11 (hook event serializability) becomes mechanically enforceable instead of a polite comment.

### StagingBuffer — observable, not a bare Map

The dual-backend shared-state architecture requires that mutations made through one backend propagate to the other's rendering subscribers. A bare `Map<FieldId, unknown>` cannot do this because neither React nor the headless session knows when the Map was mutated. `StagingBuffer` is therefore defined as an **observable store** with an explicit subscribe/notify contract:

```typescript
/**
 * An observable store for in-progress user input. Both the React backend
 * (via useSyncExternalStore) and the headless backend subscribe to the same
 * store instance; writes made through either backend notify all subscribers.
 */
export interface StagingBuffer {
  /** Get the current value for a field. Returns undefined if absent. */
  get(fieldId: FieldId): JSONValue | undefined;

  /**
   * Write a value and synchronously notify all subscribers before returning.
   * Calling `set(id, value)` with a value that deeply equals the current value
   * still fires subscribers — this matches the idempotent-notification contract
   * React's useSyncExternalStore expects and keeps the implementation trivial.
   * Passing `undefined` is a type error (values must be JSONValue); callers
   * that want to clear a field use `delete(id)` instead.
   */
  set(fieldId: FieldId, value: JSONValue): void;

  /** Remove a field and notify subscribers. After `delete`, `has(id)` returns false. */
  delete(fieldId: FieldId): void;

  /** Check whether a field has been written. */
  has(fieldId: FieldId): boolean;

  /**
   * Full snapshot as a plain object. Identity-stable: two successive calls
   * with no intervening mutation return the SAME reference. This is required
   * by React's `useSyncExternalStore`, which compares successive `getSnapshot`
   * returns with `Object.is` and enters an infinite re-render loop if a new
   * object is produced on every call. Implementations cache the snapshot and
   * invalidate the cache on `set` / `delete` / `reconcile`. The returned
   * object is not frozen but callers MUST NOT mutate it.
   */
  snapshot(): StagingSnapshot;

  /**
   * Drop fields whose IDs are not in the provided set. Fires subscribers
   * ONCE at the end of the pass, regardless of how many fields were dropped.
   * If no fields were dropped (all current IDs are in the live set), the
   * subscriber callback is still fired — the call is a mutation event by
   * definition.
   */
  reconcile(liveIds: ReadonlySet<FieldId>): void;

  /**
   * Subscribe to change notifications. Returns an unsubscribe function.
   *
   * The callback fires SYNCHRONOUSLY inside `set` / `delete` / `reconcile`,
   * after the store's internal state is updated but before the mutating call
   * returns control. This ordering is load-bearing for React's
   * `useSyncExternalStore` tearing protection: subscribers must observe the
   * new state during the same synchronous tick that caused the mutation.
   *
   * Fires with no arguments — subscribers re-read via `get` / `snapshot` as
   * needed. Registering the same callback twice creates two independent
   * subscriptions (both fire, each has its own unsubscribe handle). Calling
   * the returned unsubscribe function a second time is a no-op.
   *
   * This signature is chosen to match React's `useSyncExternalStore`
   * subscribe contract.
   */
  subscribe(callback: () => void): () => void;
}

/** Factory that creates a new observable staging buffer. Default implementation is a Map-backed store with a cached snapshot. */
export function createStagingBuffer(): StagingBuffer;
```

The `subscribe` method is what makes the React backend and the headless backend see the same world. React's `DataProvider` (in a follow-up React-package change — see Prerequisites section) consumes `StagingBuffer` via `useSyncExternalStore(buffer.subscribe, buffer.snapshot)`, which is React 18's primitive for binding to external mutable stores with concurrent-mode tearing protection. The headless session's `render()` reads `buffer.snapshot()` on every call, so it always sees current state. Writes from either backend fire `subscribe` callbacks synchronously on all listeners, triggering React re-renders without needing React's `setState`.

### ObservableDataModel

The durable data model follows the same pattern for the same reason:

```typescript
/** Path-based observable store for durable application data. Shared across backends. */
export interface ObservableDataModel {
  /** Get a value by path (e.g., "user/name"). Returns undefined if absent. */
  get(path: string): JSONValue | undefined;

  /**
   * Write a value by path and synchronously notify all subscribers before
   * returning. Same idempotent-notification contract as StagingBuffer.set.
   */
  set(path: string, value: JSONValue): void;

  /** Remove a path and notify subscribers. */
  delete(path: string): void;

  /**
   * Full snapshot as a plain nested object, strictly `Record<string, JSONValue>`.
   * Identity-stable: two successive calls with no intervening mutation return
   * the SAME reference. Same rationale as StagingBuffer.snapshot — required for
   * React's useSyncExternalStore. Returns a cached object that is invalidated
   * on any mutation. Not frozen but callers MUST NOT mutate.
   */
  snapshot(): Readonly<Record<string, JSONValue>>;

  /**
   * Subscribe to any-key change notifications. Returns unsubscribe.
   * Same synchronous-firing + idempotent + double-unsubscribe-is-no-op
   * semantics as StagingBuffer.subscribe.
   */
  subscribe(callback: () => void): () => void;
}

/**
 * Factory that creates a new observable data model, optionally seeded with
 * initial JSON data. Validates `initialData` by structural recursion and
 * throws `InitialDataNotSerializableError` on the first non-JSONValue leaf.
 *
 * The validator walks the tree: every leaf must be `null`, `boolean`, finite
 * `number`, or `string`; every container must be a plain object (prototype
 * is `Object.prototype` or `null`) or an array. Disqualified values include
 * `undefined`, `BigInt`, `symbol`, `function`, `NaN`, `Infinity`, `-Infinity`,
 * circular references, `Date`, `Map`, `Set`, `WeakMap`, `WeakSet`, `RegExp`,
 * `Error` and subclasses, typed arrays (`Uint8Array` and siblings),
 * `ArrayBuffer`, and any object whose prototype is neither `Object.prototype`
 * nor `null` (catching class instances like `URL`, `Buffer`, and user classes).
 *
 * The validator runs exactly once at construction time. Post-construction,
 * the `JSONValue` TypeScript constraint on `set(path, value)` provides the
 * ongoing guarantee; callers that bypass the type system via `as unknown`
 * can still inject invalid values, and such writes are the caller's bug.
 *
 * The same validation is reused by `createHeadlessRenderer` when it
 * constructs its own internal data model from `options.initialData`, and by
 * the headless session whenever it pipes untrusted data through `setData`.
 */
export function createObservableDataModel(
  initialData?: Record<string, JSONValue>,
): ObservableDataModel;
```

Note on the legacy `DataModel` type: `@json-ui/core`'s existing `types.ts` declares `export type DataModel = Record<string, unknown>` for backward compatibility with `@json-ui/react`'s current `DataProvider`. The new observable store uses the tighter `Record<string, JSONValue>` shape at every surface — the session API, hook events, and `ObservableDataModel.snapshot()` all speak `JSONValue`, not `unknown`. There is no type widening seam: `createObservableDataModel` accepts `Record<string, JSONValue>` as its parameter type (not the legacy `DataModel`), and its `snapshot()` return type is `Readonly<Record<string, JSONValue>>`. The legacy `DataModel` alias survives in core only because removing it would be a breaking change to `@json-ui/react`; the headless package avoids using it anywhere in its own API surface.

### IntentEvent

```typescript
/**
 * Emitted when a catalog action fires — either through a headless session's dispatch()
 * or through a React backend's action handler. Structurally identical across both
 * backends so NC's orchestrator handles them uniformly.
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
  /**
   * Cross-component correlation ID. Optional in v1 but pre-allocated in the type so
   * the cross-layer transaction log can populate it without a breaking change to
   * the interface. Any value is an opaque string the Observer uses to correlate this
   * event with Process-Layer and Memory-Layer events in the shared log.
   */
}
```

### Why inline rather than promoted

The headless spec's first draft said "promote `FieldId`, `StagingBuffer`, and `IntentEvent` from NC into core." The review team pointed out that these types don't exist anywhere yet — NC's ephemeral-UI-state spec describes a raw `Map<FieldId, unknown>` for the staging buffer, which is incompatible with the dual-backend observable requirement, and no actual TypeScript code has been written. There is nothing to promote. This spec therefore authors the runtime types fresh in `@json-ui/core`, and NC's ephemeral-UI-state spec will need a follow-up amendment to use the observable `StagingBuffer` interface instead of a raw `Map` via `useRef`. That amendment is listed in the Prerequisites section below.

### Prerequisites

Three concrete prerequisites must land before or alongside `@json-ui/headless`:

**Prerequisite 1: `packages/core/src/runtime.ts`.** The new module described above, exporting `FieldId`, `StagingSnapshot`, `JSONValue`, `StagingBuffer`, `createStagingBuffer`, `ObservableDataModel`, `createObservableDataModel`, and `IntentEvent`. Also exported from `packages/core/src/index.ts` alongside the existing exports. Breaking nothing, purely additive to core's surface.

**Prerequisite 2: `@json-ui/react`'s `DataProvider` accepts an external observable data model.** The current `packages/react/src/contexts/data.tsx` uses `useState<DataModel>(initialData)` which consumes `initialData` as a seed and cannot be externally mutated. The change: add an optional `store?: ObservableDataModel` prop; when provided, use `useSyncExternalStore(store.subscribe, store.snapshot)` to bind to the external store; when absent, fall back to the current `useState`-based behavior for backward compatibility. Scope is limited to `contexts/data.tsx` — `ValidationProvider` and `ActionProvider` do not hold `DataModel` state and do not need changes. Scheduled as a separate plan (`packages/react` follow-up).

**Prerequisite 3: NC's `NCRenderer` accepts an external `StagingBuffer` reference.** NC's ephemeral-UI-state spec (`neural-computer/docs/specs/2026-04-11-ephemeral-ui-state-design.md`) currently has `StagingBufferProvider` create a fresh buffer via `useRef`. That spec needs a follow-up amendment adding a `store?: StagingBuffer` prop to `StagingBufferProvider`, with the same conditional-external-vs-internal fallback. Input components consume the buffer via the existing `useStagingBuffer` hook, which transparently reads from whichever buffer the provider holds. This is an NC-side change documented here but speced there. Note that the _staging_ side of dual-backend sharing is Prerequisite 3 (NC-owned), not Prerequisite 2 — `@json-ui/react` does not host a staging-buffer provider, only a data provider.

Until Prerequisites 2 and 3 ship, the headless package can be implemented, tested, and used standalone (its own sessions, its own state), but the dual-backend sample code in the Session API section assumes they exist. Standalone-testing of the headless package does not require them — it creates its own stores internally.

## The Session API

Consumers don't walk trees directly. They create a **session** that holds the catalog, registry, context state, and hooks, and call `render` / `dispatch` / inspection methods against it.

```typescript
export interface HeadlessRendererOptions {
  /** The catalog built with @json-ui/core's createCatalog. */
  catalog: Catalog;
  /** Component type -> HeadlessComponent map. Must cover every type the LLM may emit. */
  registry: HeadlessRegistry;
  /** Invoked when a catalog action fires. Same shape as NC's IntentEvent contract. */
  onIntent?: (event: IntentEvent) => void;
  /**
   * Seed for the data model. Plain JSON object; validated against JSONValue
   * at session construction time. Throws InitialDataNotSerializableError if
   * any value is a Date, Map, Set, class instance, function, or symbol.
   * Only used when `data` (the observable store) is NOT provided.
   */
  initialData?: Record<string, JSONValue>;
  /** Optional catalog version string attached to every emitted IntentEvent. */
  catalogVersion?: string;
  /** Observability hooks. All optional; defaults are no-ops. */
  hooks?: Partial<RenderHooks>;
  /**
   * Optional observable staging buffer reference. If omitted, the session
   * creates its own via `createStagingBuffer()`. Passing a shared reference
   * is how NC runs the headless and React backends on the same buffer:
   * both sessions subscribe to the buffer's change notifications, so a
   * write through either backend notifies the other.
   */
  staging?: StagingBuffer;
  /**
   * Optional observable data model reference. Same rationale as `staging`:
   * pass a shared reference to run both backends against the same durable
   * data (typically backed by memoryjs in the NC architecture).
   *
   * Mutually exclusive with `initialData`: if both are provided, the session
   * constructor throws `OptionConflictError` at construction time. If neither
   * is provided, the session creates its own empty observable data model
   * internally via `createObservableDataModel(undefined)`.
   */
  data?: ObservableDataModel;
  /** Optional custom validation functions (forwarded to core). */
  validationFunctions?: Record<string, ValidationFunction>;
}

export interface HeadlessRenderer {
  /** Render the current tree against the current state. Pure function of (tree, state). */
  render(tree: UITree): NormalizedNode;
  /** Fire a catalog action programmatically. Produces an IntentEvent via onIntent. */
  dispatch(actionName: string, params?: Record<string, JSONValue>): void;
  /** Inspect the staging buffer — returns the live observable store reference. */
  getStaging(): StagingBuffer;
  /** Set a staging buffer value; validates as JSONValue and throws if not serializable. */
  setStagingField(fieldId: FieldId, value: JSONValue): void;
  /** Inspect the data model — returns a snapshot of the live observable store. */
  getData(): Readonly<Record<string, JSONValue>>;
  /** Set a path in the data model; validates as JSONValue and throws if not serializable. */
  setData(path: string, value: JSONValue): void;
  /**
   * Release hook references, unsubscribe from any shared stores, and mark the
   * session as destroyed. After destroy(), any further method call on this
   * session throws `SessionDestroyedError`. Idempotent — a second call is a no-op.
   */
  destroy(): void;
}

export function createHeadlessRenderer(
  options: HeadlessRendererOptions,
): HeadlessRenderer;
```

The session is **stateful** but its state is either owned by the session (when `options.staging` / `options.data` are omitted — the session calls `createStagingBuffer()` / `createObservableDataModel()` internally) or held by reference from outside the session (when they are passed in). The NC production architecture always passes shared observable stores — both the React `NCRenderer` and the headless session hold references to the same `StagingBuffer` and `ObservableDataModel` instances, and both subscribe to their change notifications. A session created with its own stores is appropriate for isolated testing and standalone use.

Sample NC-style dual-backend setup. The identifiers prefixed with `nc*`, `react*`, `orchestrator*`, and `transactionLog` are **caller-supplied** by the NC runtime — the headless package provides the renderer, not the catalog, registries, orchestrator, or log implementations:

```typescript
import { createStagingBuffer, createObservableDataModel } from "@json-ui/core";
import { createHeadlessRenderer } from "@json-ui/headless";
import { NCRenderer } from "@json-ui/react";

// Caller-supplied (from NC):
//   ncStarterCatalog            : Catalog — defined in NC's src/catalog/
//   ncHeadlessRegistry          : HeadlessRegistry — NC's pure-function components
//   ncReactRegistry             : ComponentRegistry — NC's React components
//   ncInitialJsonSeed           : Record<string, JSONValue> — seed from memoryjs
//   ncOrchestrator.handleIntent : (event: IntentEvent) => void — NC's intent handler
//   ncTransactionLog.append     : (event: unknown) => void — NC's cross-component log
//   currentTree                 : UITree — LLM-emitted tree, updated by orchestrator

// Note: the dual-backend setup below requires Prerequisite 2 (@json-ui/react
// DataProvider external store mode) and Prerequisite 3 (NC NCRenderer external
// staging/data props). Until both land, only the standalone headless session
// (lines marked STANDALONE) works. The <NCRenderer> block (marked DUAL) is
// aspirational until the prerequisites ship.

// Two shared observable stores, lifted out of any renderer.
const sharedStaging = createStagingBuffer();
const sharedData = createObservableDataModel(ncInitialJsonSeed);

// STANDALONE: Headless session for the LLM Observer. Works today.
const headlessSession = createHeadlessRenderer({
  catalog: ncStarterCatalog,
  registry: ncHeadlessRegistry,
  staging: sharedStaging,
  data: sharedData,
  onIntent: ncOrchestrator.handleIntent,
  hooks: {
    onElementRender: (event) => ncTransactionLog.append(event),
    onActionDispatched: (event) => ncTransactionLog.append(event),
  },
});

// DUAL (requires Prerequisites 2 + 3): React backend bound to the same stores.
// The React renderer internally calls
//   useSyncExternalStore(sharedStaging.subscribe, sharedStaging.snapshot)
// and similarly for sharedData, so mutations from headlessSession.setStagingField
// or headlessSession.setData fire subscriber callbacks and trigger React re-renders.
const userUiRoot = (
  <NCRenderer
    tree={currentTree}
    registry={ncReactRegistry}
    catalog={ncStarterCatalog}
    onIntent={ncOrchestrator.handleIntent}
    stagingStore={sharedStaging}
    dataStore={sharedData}
  />
);
```

The pub-sub mechanism in `StagingBuffer.subscribe` and `ObservableDataModel.subscribe` is the load-bearing piece. When the user types in the browser, React's own change path calls `sharedStaging.set(id, value)` which notifies all subscribers; the headless session does not subscribe to re-render (its `render` is lazy and pull-based), but any hook that calls `session.render()` will see the current state. When the LLM calls `headlessSession.setStagingField(id, value)`, the same `sharedStaging.set(id, value)` path runs, which notifies React's `useSyncExternalStore` subscription and triggers a React re-render. Both backends are symmetric because both go through the same store's `set()` method.

Note that there is still **no atomic coordination between backends**. If the user types a character and the LLM dispatches an intent within the same microtask, the interleaving is determined by Node's event loop. This is addressed in the spec's non-goals — NC's orchestrator is responsible for any higher-level coordination (e.g., rejecting LLM writes while a user-initiated intent is in flight).

`render` is a **pure function of `(tree, state)`** even when state is shared: given the same tree and the same observable store contents, it always returns deeply-equal `NormalizedNode` trees. State transitions happen explicitly through `dispatch`, `setStagingField`, and `setData` — never as a side effect of `render`. This is an important observability property: callers can assume `render` is side-effect-free and use it freely for snapshotting without worrying about hidden state mutations.

## The Component Model

A headless component is a **pure function** that takes an element, a context, and the already-rendered children, and returns a `NormalizedNode`. No hooks, no local state, no lifecycle. All state a component needs flows through `ctx`.

```typescript
export type HeadlessComponent<P = Record<string, unknown>> = (
  element: UIElement<string, P>,
  ctx: HeadlessContext,
  children: NormalizedNode[],
) => NormalizedNode;

export type HeadlessRegistry = Record<string, HeadlessComponent>;
```

An example headless `TextField` component:

```typescript
const TextField: HeadlessComponent<{
  id: string;
  label: string;
  placeholder?: string;
  error?: string;
}> = (element, ctx, _children) => {
  const id = element.props.id;
  const currentValue = ctx.staging.get(id);
  return {
    key: element.key,
    type: "TextField",
    props: {
      id,
      label: element.props.label,
      placeholder: element.props.placeholder,
      value: typeof currentValue === "string" ? currentValue : "",
      error: element.props.error,
    },
    children: [],
    meta: { visible: true },
  };
};
```

The component reads from `ctx.staging` to get the current buffered value. It does not write — writes happen through `setStagingField` on the session API or through user-interaction simulation in tests. This is a deliberate separation: **components are read-only during render; all writes happen through explicit session methods.** This constraint is what makes `render` a pure function of its inputs.

## Context and State Flow

The `HeadlessContext` is a plain object passed into every component function during a render pass. It exposes **read-only views** of the session's stores and evaluation functions — components cannot mutate state during render. All mutations happen between renders through explicit session methods (`setStagingField`, `setData`, `dispatch`).

```typescript
/**
 * Read-only subset of StagingBuffer exposed to components during render.
 * Note: no `set`, no `reconcile`, no `subscribe` — the render pass is a
 * read-only snapshot of the current state. A literal proxy is used so
 * components that try to call `set` get a runtime error, not a silent no-op.
 */
export interface ReadonlyStagingView {
  get(fieldId: FieldId): JSONValue | undefined;
  has(fieldId: FieldId): boolean;
  snapshot(): StagingSnapshot;
}

/**
 * Read-only subset of ObservableDataModel exposed to components during render.
 * Same pattern as ReadonlyStagingView — no write methods, no subscribe.
 */
export interface ReadonlyDataView {
  get(path: string): JSONValue | undefined;
  snapshot(): Readonly<Record<string, JSONValue>>;
}

export interface HeadlessContext {
  /** Read-only view of the staging buffer during render. */
  staging: ReadonlyStagingView;
  /** Read-only view of the data model during render. */
  data: ReadonlyDataView;
  /** Resolve DynamicValue entries in a params object against data + staging. */
  resolveDynamic<T extends Record<string, JSONValue>>(
    params: T,
    sources: { data: ReadonlyDataView; staging: ReadonlyStagingView },
  ): T;
  /** Evaluate a visibility condition against the current read views + auth state. */
  evaluateVisibility(condition: VisibilityCondition | undefined): boolean;
  /** Run validation for an input element's config. */
  runValidation(
    config: ValidationConfig,
    value: JSONValue,
  ): NormalizedValidation;
  /** Helper: construct a resolved NormalizedAction from a catalog action. */
  resolveAction(action: Action): NormalizedAction;
}
```

Every field on `HeadlessContext` that is a function delegates to `@json-ui/core` where possible. `evaluateVisibility` calls core's existing `evaluateVisibility` function (constructing the full `VisibilityContext` internally from the read views). `runValidation` calls core's `runValidation` similarly. `resolveDynamic` calls core's `resolveDynamicValue` recursively, substituting against both the data view and the staging view. This is how we enforce the "`@json-ui/core` stays framework-agnostic" goal — the headless package is thin glue, not a reimplementation.

The `ReadonlyStagingView` and `ReadonlyDataView` are **plain object wrappers** (not JavaScript `Proxy` objects — simpler, cheaper, type-safe) created by `createHeadlessContext(session)` and reused for the entire render pass. Each wrapper is a small object with three closures (`get`, `has` or path-variant, `snapshot`) that capture a reference to the underlying store and forward the call. Construction cost: allocating two small objects at render start. Per-element cost: zero (components get the same `ctx` reference). This is stricter than honor-system discipline because a component that tries `ctx.staging.set(...)` gets a TypeScript error, and at runtime the wrapper has no such method.

**`HeadlessContext` lifecycle.** A new `HeadlessContext` is constructed on each `render()` call, not once per session. This is because the wrappers `ReadonlyStagingView` / `ReadonlyDataView` capture store references at construction time, and render-pass purity requires that a single pass sees a consistent view of the state even if concurrent writes happen between renders. The session holds no long-lived `HeadlessContext` reference.

Outside a render pass, mutations happen through the session API (`session.setStagingField`, `session.setData`, `session.dispatch`), which talks directly to the underlying `StagingBuffer` and `ObservableDataModel` — those are the writable interfaces, and their `subscribe` callbacks fire normally.

## Action Dispatch and IntentEvents

When the session's `dispatch(actionName, params)` is called:

1. The session composes an `IntentEvent` with:
   - `action_name` = the passed action name
   - `action_params` = `preResolveDynamicParams(params, staging.snapshot())` — any `DynamicValue` entries that reference staging field IDs are pre-resolved against the current buffer (NC's Invariant 11 pattern, reused here via core's helpers)
   - `staging_snapshot` = `staging.snapshot()` — the full buffer at flush time
   - `catalog_version` = the session's `catalogVersion` option, if set
   - `timestamp` = `Date.now()`
2. The session fires `hooks.onActionDispatched?.(event)` for observability.
3. The session calls `onIntent(event)` if the consumer provided one.
4. **The buffer is not cleared on dispatch** — same invariant as NC's Rule 4B. Dispatch is a read operation on the buffer, not a consume operation. If the consumer wants to clear the buffer, they do so explicitly via `setStagingField(id, undefined)` on subsequent renders.

Consumers that want to simulate a button click in tests do so by calling `dispatch` directly with the action name. The `NormalizedAction` carried by a rendered button's `actions` field contains the exact `{name, params}` pair to pass — there's a well-defined contract between what's in the normalized tree and what `dispatch` accepts.

Backpressure — "reject duplicate intents while the previous one is still being processed" — is **not** implemented in the headless package, for the same reason it is not implemented in NC's `@json-ui/react`-based renderer: "intent in flight" is a consumer-owned concept, not a renderer-owned concept. The session does not track pending dispatches. Consumers that need backpressure layer it on top.

## Observability: the `RenderHooks` interface

This is the design element that sets the headless package apart from `@json-ui/react` and is the main reason the package earns the "observability" design goal. In the NC architecture, these hooks are not a nice-to-have debugging surface — they are the **primary channel through which the LLM Observer perceives the UI Layer**, and they feed directly into NC's cross-component transaction log.

Every hook receives only **serializable plain data**. No function references, no class instances, no React refs, no symbols, no circular structures. This constraint is what makes the hook stream cross-process-safe: a consumer can subscribe in-process (by passing hook callbacks directly), or out-of-process by writing a thin adapter that serializes each event to JSON and ships it over a socket, a message queue, or a tailed log file.

```typescript
export type RenderPhase =
  | "walk"
  | "visibility"
  | "validation"
  | "component"
  | "serialize"
  | "dispatch";

/**
 * A single render pass identifier — monotonically increasing within a session,
 * starting at 1. Used to correlate per-element events with the render pass
 * they belong to. A session's first `render()` call has `passId === 1`, the
 * second has `passId === 2`, and so on. `passId` is session-scoped: two
 * different sessions can both have `passId === 1` for their first renders.
 */
export type RenderPassId = number;

/**
 * Serializable snapshot of the current session state, passed to before/after hooks.
 * Every field satisfies JSONValue. The session constructor validates `data` at
 * construction time and throws if `initialData` contains non-JSON values.
 */
export interface SessionStateSnapshot {
  staging: StagingSnapshot; // already constrained to JSONValue by the StagingBuffer contract
  data: Record<string, JSONValue>; // durable data, strictly JSON-round-trippable
  catalogVersion?: string;
}

/**
 * Serializable error record — no Error instance, no stack trace objects, just plain data.
 * Constructed by `toSerializableError()` in `errors.ts`, which walks the Error cause chain
 * and captures name/message/stack as strings. JSON-round-trippable by construction.
 */
export interface SerializableError {
  name: string;
  message: string;
  stack?: string; // string form of the stack, if available
  phase: RenderPhase;
  /** Recursive chain of caused-by errors, if any. Each entry is itself serializable. */
  cause?: Omit<SerializableError, "phase">;
}

/**
 * `toSerializableError(error, phase)` — helper exported from `@json-ui/headless`'s
 * `errors.ts` module. Walks the Error cause chain and produces a SerializableError.
 *
 * Handles:
 *   - Native `Error` instances (captures `name`, `message`, `stack?`, `cause?`).
 *   - DOMException-like objects (duck-typed `{name, message}`).
 *   - `Error` duck types (any object with `typeof message === "string"`).
 *   - `AggregateError`: treated as a standard Error; its `errors` array is NOT
 *     captured in v1 (v1.1 may add an `aggregated?: SerializableError[]` field).
 *   - Non-Error throwables (thrown strings, numbers, plain objects, undefined):
 *     coerced to `{ name: "UnknownError", message: String(value) }`.
 *
 * Cause chain walking:
 *   - Recurses through `error.cause` up to a maximum depth of 8. Beyond depth 8,
 *     the `cause` field is set to `{ name: "CauseChainDepthLimitExceeded", message: "..." }`
 *     and the walk stops — this prevents infinite loops from circular chains
 *     (`error.cause = error` or similar) and bounds the payload size.
 *   - If `error.cause` is itself a non-Error value, it is converted recursively
 *     using the same unknown-throwable coercion rule.
 *   - Top-level error has `phase`; nested causes do not (the `Omit<..., "phase">`
 *     in the SerializableError type).
 */
export function toSerializableError(
  error: unknown,
  phase: RenderPhase,
): SerializableError;

export interface RenderHooks {
  /** Called before a render pass begins. */
  onBeforeRender(event: {
    passId: RenderPassId;
    tree: UITree;
    state: SessionStateSnapshot;
    timestamp: number;
  }): void;

  /** Called after a render pass ends. */
  onAfterRender(event: {
    passId: RenderPassId;
    tree: UITree;
    result: NormalizedNode;
    elapsedMs: number;
    timestamp: number;
  }): void;

  /** Called for every element node produced during a render pass. */
  onElementRender(event: {
    passId: RenderPassId;
    elementKey: string;
    elementType: string;
    result: NormalizedNode;
    timestamp: number;
  }): void;

  /** Called when an action is dispatched and an IntentEvent is emitted. */
  onActionDispatched(event: IntentEvent): void;

  /** Called whenever the staging buffer is mutated through the session (setStagingField). */
  onStagingChange(event: {
    fieldId: FieldId;
    newValue: JSONValue; // enforced by StagingBuffer contract
    oldValue: JSONValue | undefined;
    timestamp: number;
  }): void;

  /** Called whenever the data model is mutated through the session (setData). */
  onDataChange(event: {
    path: string;
    newValue: JSONValue;
    oldValue: JSONValue | undefined;
    timestamp: number;
  }): void;

  /** Called on any error thrown during a render phase, post-`toSerializableError` conversion. */
  onError(error: SerializableError): void;
}
```

**Seven hooks, not nine.** Earlier drafts of this spec defined `onVisibilityEvaluated` and `onValidationRun` as per-element events fired during each render pass. The review team pointed out that both are (partially) recoverable from the `NormalizedNode` tree itself — visibility is expressed by presence or absence in the `children` array, validation state is attached to each input element's `validation` field. For Observers that hold BOTH the input `UITree` (via `onBeforeRender.tree`) and the output `NormalizedNode` (via `onAfterRender.result`), visibility decisions are recoverable by diffing the two trees: an element present in the input but absent from the output was pruned by visibility. Both hooks are **deferred to v1.1** and will be added back only when a concrete consumer demonstrates a use case not satisfied by before/after diffing.

_Acknowledged gap: an Observer that sees only a `NormalizedNode` snapshot in isolation — without the source `UITree` that produced it — cannot distinguish "element was filtered out by visibility" from "element was never in the source tree." This ambiguity is real and matters for scenarios where a persisted snapshot is replayed later without its source tree. Observers that need offline visibility reasoning must persist the raw `UITree` alongside the `NormalizedNode`, or subscribe to both `onBeforeRender` and `onAfterRender` and correlate via `passId`. The spec chose not to add `onVisibilityEvaluated` back solely for this case because: (a) the persist-both workaround is cheap, (b) online Observers don't need it, and (c) no current consumer has demanded offline visibility reasoning. Revisited in v1.1 if that changes._

**Every hook's payload is strictly JSON-round-trippable.** Every field satisfies `JSONValue` at the type level. The session constructor validates `options.initialData` (if provided) at session creation time and throws `InitialDataNotSerializableError` if the input contains a `Date`, `Map`, `Set`, class instance, function, or symbol. The `StagingBuffer` and `ObservableDataModel` contracts constrain writes to `JSONValue`, so any value reaching a hook payload has already passed validation. `Error` objects are converted to `SerializableError` via `toSerializableError()` before `onError` is called, capturing stack and cause chain as plain strings. `passId` lets out-of-process consumers correlate per-element events with their render pass; `timestamp` gives intra-session ordering without requiring the log consumer to trust wall clocks.

All fields on `Partial<RenderHooks>` are optional. The session composes the partial hooks against a no-op default so every field is safe to call unconditionally. The `hooks.ts` module exports both the interface, the no-op default, and a helper `composeHooks(...partials): RenderHooks` that merges multiple hook sets when a consumer wants to fan out (e.g., one set for in-process debugging, another for the transaction-log feed).

Use cases this enables:

- **NC Observer feed.** The primary use case. The LLM Observer subscribes to the hook stream — either by installing in-process hook callbacks that push to a shared queue, or by tailing a serialized log file that a thin adapter wrote out. The `NormalizedNode` payloads give the Observer a machine-readable snapshot of what the user is looking at at any moment; the `onActionDispatched` events give it a stream of intents as they happen.
- **Transaction log.** Every event can be JSON-serialized and appended to NC's cross-component transaction log alongside events from the Process Layer and Memory Layer. The log is a replayable record of everything the system did; the Observer can replay it after the fact, index it, or use it as LLM context.
- **Tracing / profiling.** `onBeforeRender` and `onAfterRender` carry elapsed-time measurements. `onElementRender` with `passId` gives per-element timing within a pass. Wire into OpenTelemetry by writing a hook adapter that emits spans.
- **Debugging.** `onError` with `phase` information tells you exactly where in the render pipeline something blew up. `onStagingChange` / `onDataChange` log every state mutation for replay.
- **Test fixtures.** A test installs a hook that accumulates every `onActionDispatched` event and asserts on the sequence, independent of the `onIntent` contract.
- **Devtools.** A future devtools package can install hooks to inspect render history, visualize staging buffer state over time, replay renders from a log file — all without touching the renderer itself.

The no-op default means observability costs approximately zero when not in use. Turning it on is a one-line option: `hooks: { onElementRender: (event) => transactionLog.push(event) }`.

**Serializability is mechanically enforced.** Testable Invariant 11 asserts that every hook event passed through an adapter that does `JSON.parse(JSON.stringify(event))` deep-equals the original. The adapter is installed in the session test suite and runs against a fixed representative sequence: render a tree containing one `TextField` with a typed-in staging value, one `Button` with a `DynamicValue` action param, and one component that throws an `Error` with a `cause` chain. The sequence exercises `onBeforeRender`, `onElementRender`, `onAfterRender`, `onActionDispatched`, `onStagingChange`, and `onError`. Any future hook addition that introduces a non-`JSONValue` field fails this invariant at test time and breaks the build.

### Firing order, timestamps, and error handling

Within a single `render()` call, hooks fire in a deterministic order:

```
onBeforeRender(passId)
  for each visible element in walk order:
    onElementRender(passId, elementKey, elementType, result)
onAfterRender(passId, result, elapsedMs)
```

`onBeforeRender` fires first; for each visible element in depth-first walk order, `onElementRender` fires once; `onAfterRender` fires last. Elements that evaluate `visibility` as false do not fire `onElementRender` (they are pruned before the walk emits them). `onActionDispatched`, `onStagingChange`, and `onDataChange` fire outside render passes — they are triggered by `session.dispatch`, `session.setStagingField`, and `session.setData` respectively, and do not carry a `passId` tied to any specific render.

**Timestamp scope.** Each hook's `timestamp` is captured immediately before the hook fires (`Date.now()` at call time), not shared across a render pass. This means the `onBeforeRender.timestamp` is milliseconds-earlier than the first `onElementRender.timestamp`, which is earlier than `onAfterRender.timestamp`, and the spread across events is the render's real wall-clock duration. Event-log consumers can use per-event timestamps for replay ordering without needing a separate "pass start" clock.

**Hook callback throws.** If a hook callback itself throws an exception, the exception is caught by the session's hook dispatcher and **swallowed silently** — not re-emitted through `onError` and not propagated to the render caller. This prevents two pathologies: (a) a buggy hook crashing an otherwise-healthy render, and (b) infinite recursion if an `onError` hook itself throws. The swallowed exception is written to `console.error` in the default implementation; consumers that want structured handling of hook errors install their own try/catch inside the hook callback.

**`onAfterRender` on render failure.** If the render itself fails (component function throws, tree walker hits an unrecoverable error, validation gate rejects the tree), `onAfterRender` does NOT fire. Instead, `onError` fires with the appropriate phase (`"component"`, `"walk"`, `"validation"`, etc.), and the session's `render()` method rethrows the exception to the caller. The default render-failure behavior is "bubble" per Open Question 4; consumers who set `continueOnComponentError: true` get partial renders where failed elements are replaced by fallback `Unknown` nodes, and in that mode `onAfterRender` DOES fire with the partial result.

## Serializers

A `Serializer<Output>` takes a `NormalizedNode` and produces a target output format:

```typescript
export interface Serializer<Output> {
  serialize(node: NormalizedNode): Output;
}
```

Two concrete serializers ship in v1:

**`JsonSerializer`** — returns the `NormalizedNode` tree as-is (or `JSON.stringify`d via an option flag). Trivial implementation, useful for wire transport, test assertions (`expect(serializer.serialize(node)).toMatchObject({...})`), and storage.

**`HtmlSerializer`** — walks the tree and emits an HTML string. Because component types come from an open registry, the HTML serializer does not bake in component-type-to-HTML-tag mapping. Instead it accepts a per-type emitter function:

```typescript
export interface HtmlSerializerOptions {
  emitters: Record<
    string,
    (node: NormalizedNode, emitChildren: () => string) => string
  >;
  /** Fallback emitter for unknown types. Default: `<div data-type="..."></div>`. */
  fallback?: (node: NormalizedNode, emitChildren: () => string) => string;
  /** Whether to escape text content in props (default true). */
  escapeText?: boolean;
}

export function createHtmlSerializer(
  options: HtmlSerializerOptions,
): Serializer<string>;
```

Consumers provide a map like `{ TextField: (node) => \`<label>${node.props.label}<input value="${node.props.value}" /></label>\` }`. This keeps the HTML serializer **content-agnostic** — it knows how to walk and escape and concatenate, but not what any given component type should look like. Consumers own their visual language.

A future `TermSerializer` would follow the same pattern: an emitter map from component type to an ANSI-formatted string.

## Extensibility Points

The spec commits to the following extension points, each with an explicit named interface. Consumers can plug into any of these without modifying the package:

1. **Component registry** — `HeadlessRegistry` (a `Record<string, HeadlessComponent>`). Consumers add components by putting entries in the options.
2. **Serializers** — `Serializer<Output>` interface. Consumers write new output formats as new serializer implementations.
3. **Render hooks** — `RenderHooks` interface. Consumers observe render lifecycle, state mutations, errors, action dispatch.
4. **Staging buffer** — the `StagingBuffer` type from `@json-ui/core`'s headless re-export. Consumers can plug in their own implementation (for CRDT sync, persistence, etc.) via `options.staging`.
5. **Data model** — the `DataModel` type from core. Consumers can back it with any key-value store.
6. **Validation functions** — forwarded to core's existing `customFunctions` mechanism via `options.validationFunctions`.

Each extension point has its own test file in the v1 test suite. Adding an extension does not require understanding the internals of the renderer — the contract is the interface.

## Relationship to `@json-ui/core` and `@json-ui/react`

**To `@json-ui/core`:** The headless package depends on core for every primitive. It re-exports from core: `createCatalog`, `Catalog`, `UITree`, `UIElement`, `Action`, `DataModel`, `VisibilityCondition`, `ValidationConfig`, `ValidationFunction`, `ComponentDefinition`, `resolveDynamicValue`, `evaluateVisibility`, `runValidation`, `resolveAction`, and the runtime-module exports from Prerequisite 1: `FieldId`, `StagingSnapshot`, `JSONValue`, `StagingBuffer`, `createStagingBuffer`, `ObservableDataModel`, `createObservableDataModel`, `IntentEvent`. It adds `HeadlessComponent`, `HeadlessRegistry`, `HeadlessContext`, `HeadlessRenderer`, `createHeadlessRenderer`, `NormalizedNode`, `NormalizedAction`, `NormalizedValidation`, `RenderHooks`, `RenderPhase`, `RenderPassId`, `SessionStateSnapshot`, `SerializableError`, `toSerializableError`, and the serializer interface and two concrete serializers. The runtime-module additions to core are purely additive — no existing export is renamed or removed. Core's framework-agnostic guarantee is verified by a test that scans `packages/core/src/` for imports of `react`, `react-dom`, `jsdom`, or DOM globals and asserts the set is empty.

**To `@json-ui/react`:** Zero runtime coupling between the headless package and the React package. The two packages are siblings under `packages/` and neither imports from the other. Their shared type vocabulary comes exclusively through `@json-ui/core`. A consumer that wants both installs both.

However, the dual-backend shared-state architecture requires a **companion change to `@json-ui/react`**, scheduled as a separate follow-up plan (see Prerequisite 2 in the Runtime Types section). The change: `DataProvider` grows an optional `store?: ObservableDataModel` prop that, when provided, replaces its current `useState<DataModel>` seed path with `useSyncExternalStore(store.subscribe, store.snapshot)`. When the prop is absent, the current `useState`-based behavior is preserved for backward compatibility. The same pattern applies to whatever buffer-provider the React-side NCRenderer introduces. This follow-up is a prerequisite for NC's dual-backend usage but is not a prerequisite for the headless package itself — the headless package can ship and be tested standalone without it.

**Potential core cleanup (observational):** Building this package may surface dead exports in core. For instance, `ValidationFunctionDefinition` appears to be an unused export (declared in `packages/core/src/validation.ts` but referenced only within tests). Any cleanups discovered during implementation go into a separate "core cleanup" commit; they are not bundled with the headless package's initial landing.

## Testing Strategy

The package ships with a full vitest suite covering every public surface. Test file conventions mirror `@json-ui/react`: one test file per source file, colocated. Approximate coverage plan:

- `walker.test.ts` — tree traversal with and without visibility filtering, child ordering, deep nesting, cycles impossible by construction (UITree is a DAG), missing-component handling.
- `renderer.test.ts` — session lifecycle (create → render → dispatch → inspect → destroy), render purity (same inputs = same outputs), state mutation via session methods, error propagation through `onError` hook.
- `context.test.ts` — visibility evaluation, validation runs, DynamicValue resolution against mixed data + staging sources, `resolveAction` round-trip.
- `hooks.test.ts` — every hook fires at the right phase, default no-ops don't throw, consumer-provided partial hooks merge correctly with defaults, errors in hooks are caught and reported via `onError`.
- `registry.test.ts` — unknown component type behavior, component function type inference.
- `serializers/html.test.ts` — emitter invocation per type, children recursion, text escaping, fallback behavior, unknown-type handling.
- `serializers/json.test.ts` — identity serialization, safe-stringify handling of Maps / Sets / circular refs (error path).
- `helpers/collect-ids.test.ts` — field ID collection for staging reconciliation, duplicate detection (matches NC's Invariant 8).

Integration tests exercise the full render → dispatch → assert cycle using the NC-style use case as the driver: a catalog with TextField, Checkbox, and Button; a headless session; a test that types into the buffer, dispatches `submit_form`, and asserts on the emitted `IntentEvent`.

## Testable Invariants

The spec's correctness can be verified by the following invariants, each mapping to a concrete test in the suite:

1. **Render purity.** Given the same `(tree, data, staging, catalog)`, two back-to-back `render` calls return deeply-equal `NormalizedNode` trees. No hidden state.
2. **Visibility pruning.** An element whose `evaluateVisibility` returns `false` is absent from its parent's `children` array in the rendered output. Not merely flagged invisible — absent.
3. **DynamicValue resolution.** Any `{path: "..."}` entry in a component's props or action params is substituted with the resolved value before the `NormalizedNode` is produced. The normalized output contains no raw `DynamicValue` objects.
4. **Staging read discipline.** Components never receive write handles to the staging buffer during render. `ctx.staging.set` is not callable from inside a render pass (enforced by providing a read-only proxy during render).
5. **Buffer not cleared on dispatch.** After `dispatch`, `session.getStaging().snapshot()` contains every field value that was present before the dispatch.
6. **IntentEvent shape compatibility.** Every `IntentEvent` emitted from a headless session is structurally identical to the `IntentEvent` type NC's React backend produces, so NC consumer code is backend-agnostic at the type level.
7. **Hook firing order.** For a single render pass, hooks fire in the canonical order documented in "The LLM Observer's View" section: `onBeforeRender` → (for each visible element in walk order: `onElementRender`) → `onAfterRender`. `onError` may fire at any phase and does not prevent subsequent hooks from firing on unrelated elements. Enforced by a test that installs a hook accumulator and asserts on the recorded sequence against a known tree. (Note: earlier drafts fired `onVisibilityEvaluated` and `onValidationRun` per element; both were cut from v1 because the information is recoverable from the `NormalizedNode` tree itself.)
8. **No React imports.** The package has zero static imports from `react`, `react-dom`, or anything under `@json-ui/react`. Enforced by a test that reads every `.ts` file under `src/` and asserts the import set.
9. **Serializer independence.** Serializers have no access to the session or context — they take a `NormalizedNode` and return output. Enforced by type: the `Serializer<Output>` interface takes a node and nothing else.
10. **Unknown component type handling.** Rendering a tree that contains a component type with no registry entry emits a specific `UnknownComponentError` (converted to `SerializableError` via `toSerializableError`) through `onError` with the phase `"walk"`, and the corresponding element is rendered as a fallback node with `type = "Unknown"` and the original type stored in `props._originalType`. The render does not crash.

11. **Hook event serializability.** Every event passed to every hook, when routed through a test adapter that does `JSON.parse(JSON.stringify(event))` and deep-compares against the original, round-trips losslessly. The test uses a fixed fixture sequence: render a tree with one `TextField` (id `"email"`, label `"Email"`), one `Button` whose action is `{name: "submit", params: {to: {path: "email"}}}`, and one component registered under type `"Boom"` that throws `new Error("nope", { cause: new Error("inner") })`. The sequence exercises `onBeforeRender`, `onElementRender` for each visible element, `onAfterRender`, `onActionDispatched` (via a subsequent `session.dispatch("submit", {})`), `onStagingChange` (via `session.setStagingField("email", "x@y.z")`), and `onError` with cause chain. Any future hook field that is not JSON-serializable (Date, Map, Set, function, class instance, circular ref, BigInt, symbol) fails the round-trip comparison and breaks the build.

12. **`initialData` validation — exhaustive disqualified set.** `createHeadlessRenderer({ initialData: <disqualified value at any depth> })` throws `InitialDataNotSerializableError` at session construction time. The test passes every value in the disqualified set, each in three positions (top-level property, nested in an object, nested in an array), and asserts each one throws. Disqualified set: `undefined`, `BigInt(0)`, `Symbol()`, `() => {}`, `NaN`, `Infinity`, `-Infinity`, `new Date()`, `new Map()`, `new Set()`, `new WeakMap()`, `new WeakSet()`, `/regex/`, `new Error("x")`, `new Uint8Array(0)`, `new ArrayBuffer(0)`, a circular reference (`const a: any = {}; a.self = a`), and a custom class instance (`new class X {}()`). `createObservableDataModel(initialData)` called directly from `@json-ui/core` runs the same validator with the same disqualified set. This is what mechanically enforces Invariant 11 upstream of the hook stream.

13. **Observable store synchronous notification.** When a headless session's `setStagingField` writes a new value, any subscriber registered via the underlying `StagingBuffer.subscribe` receives a callback synchronously before `setStagingField` returns control. Test: create two headless sessions sharing one `StagingBuffer`, install a counter-incrementing subscriber on the buffer, call `session1.setStagingField("x", 1)`, assert the counter incremented before the statement following `setStagingField` runs (using an atomic sequence check), then call `session2.getStaging().get("x")` and assert it returns `1`. Same test for `ObservableDataModel.set`. Also tests that `snapshot()` returns the same reference twice in a row (identity-stable caching).

14. **`toSerializableError` cause chain walks.** An `Error` constructed with `new Error("outer", { cause: new Error("inner", { cause: "primitive-cause-string" }) })` produces a `SerializableError` whose `cause` is a nested `{name: "Error", message: "inner", cause: {name: "UnknownError", message: "primitive-cause-string"}}` record. Circular cause chains (`a.cause = a`) stop at depth 8 with `cause: {name: "CauseChainDepthLimitExceeded", message: "..."}`. `AggregateError` instances produce a standard SerializableError (the `.errors` array is not captured in v1). Unknown throwables (thrown string, number, plain object, undefined) produce `{name: "UnknownError", message: String(value)}`.

15. **Render-pass purity on shared stores.** A single `render()` call sees a consistent view of its stores even if other writers mutate them concurrently: the `HeadlessContext` captures store snapshots at render-pass start, and all component reads during that pass see the same snapshot. Test: install a subscribe callback on a shared buffer that writes a new value while the render is in progress, call `session.render(tree)` on a multi-element tree, and assert that every element's `NormalizedNode.props` reflects the snapshot at pass start, not the partially-mutated state.

16. **Walker error handling for missing child keys.** If a `UITree` element's `children` array references a key that does not exist in `tree.elements`, the walker emits `onError` with phase `"walk"` and message `"Missing child key: <key>"`, skips the missing child (omits it from the parent's `NormalizedNode.children`), and continues walking the rest of the tree. The render does NOT crash; this is a structural tree error that the Observer can detect and handle by dispatching a tree-regeneration action.

## The LLM Observer's View

The headless renderer exists to give the NC Observer Layer a machine-readable view of the UI. This section documents the expected consumption patterns so the spec doesn't over-constrain the hook interface but also gives implementers a clear target.

**What the Observer needs:**

1. **Snapshot reads.** At any moment, the Observer can call `headlessSession.render(currentTree)` and get back a `NormalizedNode` tree that represents exactly what the user is currently seeing — all visibility resolved, all `DynamicValue`s substituted, all validation state attached. This is the Observer's "look at the screen" primitive.
2. **Event stream reads.** The Observer subscribes to the `RenderHooks` interface to receive a real-time stream of renders, state changes, and action dispatches. Combined with similar streams from the Process Layer and Memory Layer, this forms NC's cross-component transaction log.
3. **Action writes.** The Observer intervenes by calling `headlessSession.dispatch(actionName, params)` — producing an `IntentEvent` through the same contract the user's own clicks would use. The NC orchestrator handles the intent without distinguishing between user-origin and Observer-origin.
4. **State writes.** The Observer can pre-populate or correct staging buffer values via `setStagingField(id, value)`, or mutate durable data via `setData(path, value)`. Both fire the corresponding hooks so the mutation enters the transaction log, and both propagate to the React backend through the shared state references.

**What this spec deliberately does NOT define:**

- **The transaction log itself.** How events are routed, persisted, queried, and replayed is NC architecture, not JSON-UI architecture. This spec's job is to ensure the headless renderer publishes events in a shape the log can consume — serializable, ordered, correlatable via `passId` and `timestamp`.
- **The Observer's prompt engineering.** How the LLM is prompted with current UI state, how it decides to intervene, and how it constructs dispatch calls are all NC concerns.
- **Cross-process transport.** Whether the Observer runs in the same Node process, in a sibling process reading a log file, or on a remote machine reading a message-queue feed — all are possible given the serializability constraint, and none is the business of this spec.

**One concrete property the spec commits to for Observer consumption:** the stream of events from a `render()` call fires in this order within a pass, and this ordering is load-bearing for the Observer's ability to reconstruct the render pass deterministically:

```
onBeforeRender(passId)
  for each visible element in walk order:
    onElementRender(passId, elementKey, elementType, result)
onAfterRender(passId, result, elapsedMs)
```

(Earlier drafts also fired `onVisibilityEvaluated` and `onValidationRun` per element; both were cut from v1 because visibility is expressed by `children`-array presence and validation state is attached to each element's `validation` field. The Observer recovers both from the `NormalizedNode` tree without the extra events.)

`onError` may fire at any phase within a pass and does not prevent subsequent hooks from firing on unrelated elements. `onStagingChange`, `onDataChange`, and `onActionDispatched` fire outside render passes (triggered by `setStagingField`, `setData`, and `dispatch` respectively), so they are not part of the per-pass ordering.

## What This Spec Is Not

- **Not the Approach 3 shared component abstraction.** NC will write two sets of input components for now — one using `@json-ui/react`'s hooks, one using headless's pure-function model. Unifying them via a cross-backend component language is a separate spec when there is a concrete second consumer demanding it.
- **Not a server framework integration spec.** Express handlers, Next.js adapters, Cloudflare Workers adapters, and so on are consumer concerns. The package provides the primitives; consumers compose them.
- **Not a streaming or partial-render spec.** Every `render` call produces a complete `NormalizedNode` in one pass. Streaming is deferred until a concrete consumer demands it.
- **Not a CSS or theming spec.** The HTML serializer emits whatever markup the per-type emitter functions choose. Consumers own their visual language.
- **Not a hydration spec.** HTML output is read-only. A consumer that wants client-side interactivity after receiving headless-rendered HTML can either switch to `@json-ui/react` or run their own JS runtime on top of the `NormalizedNode` tree sent alongside the HTML.

## Open Questions

1. **~~Should `ctx.staging` be a literal read-only proxy during render, or is the honor system enough?~~ (resolved).** Literal proxy. See the "Context and State Flow" section — `ReadonlyStagingView` and `ReadonlyDataView` are the types exposed during render, and they have no `set`/`reconcile`/`subscribe` methods. A component trying to mutate state during render gets a TypeScript error and, at runtime, calls a method that doesn't exist. This is stricter than honor-system discipline and cannot be accidentally broken by a future refactor.

2. **~~How is the `h()` helper's TypeScript inference designed?~~ (resolved: cut).** The first draft proposed an `h("TextField", { id, label }, [])` helper for building `NormalizedNode`s in component bodies. The review team pointed out the spec's own `TextField` example returns an object literal `{ key, type, props, children, meta }` without using `h()`, which is shorter than the helper call would be and carries no less type information. The helper was scope creep — imitating JSX ergonomics in a context where those ergonomics do not apply. Cut from v1. Component authors write object literals directly. If a pattern for default-filling `children: []` and `meta: { visible: true }` emerges, it can be added as a thin `defaults()` function in a follow-up.

3. **~~Does `destroy()` do anything in v1?~~ (resolved).** Yes, minimally. `destroy()` unsubscribes the session from any shared `StagingBuffer` or `ObservableDataModel` stores it was subscribing to (if any — in v1, the headless session does not subscribe to stores for itself, but future caching logic might), and nulls out the internal hook composition so any late-fired callbacks become no-ops instead of referencing freed state. After `destroy()`, calling `render()`, `dispatch()`, or any other session method throws `SessionDestroyedError`. `destroy()` is idempotent — calling it a second time is a no-op. The earlier JSDoc said "no-op in v1" which was wrong; the method has real work even at v1 scope.

4. **~~Error recovery during render.~~ (resolved: option (c) with default = bubble).** If a component function throws, the renderer's behavior depends on the `continueOnComponentError` option. **Default (`false`):** `onError` fires with phase `"component"` and the thrown error wrapped via `toSerializableError`, the session's `render()` call rethrows the exception to the caller, and `onAfterRender` does NOT fire. **`continueOnComponentError: true`:** `onError` fires as above, but the offending element is replaced with a fallback node (`type: "Unknown"`, `props._originalType: <original type>`, `props._error: <SerializableError.message>`), the render continues with subsequent elements, and `onAfterRender` fires with the partial result. This mirrors Invariant 10's unknown-component-type handling but for runtime errors rather than missing registry entries. Consumers that prefer tolerance (e.g., an LLM Observer that wants to see the rest of the tree even if one component blew up) explicitly opt in.

5. **~~Where do `FieldId`, `StagingBuffer`, and `IntentEvent` live?~~ (resolved).** The first draft of this spec said "promote them from NC into `@json-ui/core`." The review team pointed out that these types don't exist anywhere yet — NC's ephemeral-UI-state spec describes a raw `Map<FieldId, unknown>` for the staging buffer, no TypeScript source has been written, and the headless renderer needs a richer interface (subscribe/notify, snapshot, reconcile) than a bare Map can provide. There was nothing to "promote." **Resolved:** the runtime types are authored fresh in a new `packages/core/src/runtime.ts` module. The concrete interface definitions are in the "Runtime Types and the Observable Store Pattern" section above, not deferred to a separate spec. NC's ephemeral-UI-state spec will need a follow-up amendment to use the observable `StagingBuffer` interface instead of a raw `Map<FieldId, unknown>` via `useRef`; that amendment is listed as Prerequisite 3.

6. **Is the cross-component transaction log in scope for this spec?** No. The spec defines the hook interface that _publishes_ events suitable for a transaction log, and enforces that every hook payload is serializable so an out-of-process consumer can subscribe. What it does not define is the log itself: routing, persistence, replay, querying, ordering across the UI/Process/Memory layers, how the Observer subscribes, how backpressure is handled. That is NC architecture and deserves its own spec. The headless renderer's commitment is narrower and mechanical: "every event is serializable, every event carries a `passId` and `timestamp`, the firing order within a render pass is deterministic." If the transaction log spec later needs additional fields for cross-layer correlation, those are added then — adding optional fields to the `RenderHooks` payload interfaces is structurally non-breaking in TypeScript, so there is no pre-allocation benefit and no reason to litter v1 events with fields no consumer uses.

7. **Default hook behavior: no-op vs. log-to-stderr?** This spec commits to **no-op default**. Zero-cost matters when observability is not in use, and consumers who want stderr logging install a one-line adapter (`hooks: { onElementRender: (e) => console.error(JSON.stringify(e)) }`). Resolved.

8. **Cross-backend IntentEvent deduplication.** If the user clicks a Button in the browser while the LLM Observer concurrently dispatches the same action via the headless session, the NC orchestrator receives two near-identical IntentEvents. The NC ephemeral-UI-state spec's in-flight flag lives in React's `NCRenderer` state and does not coordinate across backends. **This spec is explicit that cross-backend deduplication is not the renderer's job** — it is NC orchestrator-level work. The renderer guarantees each backend's local ordering is correct; the orchestrator decides whether two near-simultaneous intents are the same intent. A follow-up NC spec will define the deduplication contract (likely via a shared pending-intent queue or a debounce window on `action_name + staging_snapshot` equality). The headless package does not ship any deduplication in v1.

9. **Component API forward-compatibility with Approach 3.** Approach 3 (shared component abstraction across React and headless) is deferred, but v1 components should be authored in a way that does not paint into a corner. Guideline: **a headless component function that takes `(element, ctx, children)` and returns a `NormalizedNode` is trivially reshapeable into an Approach-3 component** as long as it does not depend on mutable closures or side-effects outside the function body. Pure functions compose; stateful functions do not. The `toRegistered` adapter pattern already used by NC's React input components is the analogous forward-compatibility hook on the React side. If Approach 3 materializes, the migration is "drop the React adapter, keep the pure function; wire a new `toReact` adapter in its place." No deeper preparation is required, but authors should resist the temptation to add closure-held state inside a headless component.

## Non-Goals

- No internal state-sharing coordination. Multiple sessions CAN share state (by passing the same `staging` / `data` references into each), but the package does not offer a coordination layer — no locks, no transaction boundaries, no event bus built into the session. Concurrent mutations are the caller's responsibility. NC handles this by routing all mutations through the orchestrator.
- No time-travel debugging. Render history is an observability-hook concern, not a renderer concern.
- No parallel rendering. Renders are synchronous. A consumer that wants concurrency wraps `render` in whatever orchestration layer they prefer.
- No plugin lifecycle beyond the `RenderHooks` interface. Hooks are the extension surface; anything else is a separate discussion.
- No built-in component library. The package ships zero pre-authored components. Consumers bring their own.
- No cross-component transaction log. The package publishes events through `RenderHooks`; NC's transaction log is a separate spec that consumes the hook stream alongside similar streams from the Process and Memory layers.

## Prior Art

- **`@json-ui/react` (this repo).** The existing React backend that this package is a sibling to. Establishes the catalog-driven rendering pattern; headless reuses the catalog but replaces the runtime.
- **Vercel Labs `json-render` (upstream).** The original constrained-catalog approach.
- **Google A2UI.** The framework-agnostic-renderer philosophy and the "same tree, different clients" idea; this spec's `NormalizedNode` is directly inspired by A2UI's declarative node format.
- **React's own reconciler.** The pure-function-of-`(props, state)` constraint is lifted from React's design intent, applied here without React's runtime.
- **Preact's VNode.** Another reference for a minimal structural tree type that serializes cleanly.
- **Ink (React-for-terminal).** Proof that a component authoring model can target non-DOM outputs; this spec diverges by making the function model explicit rather than piggybacking on React's reconciler.
