# Changelog

All notable changes to JSON-UI are documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/).

This is a single-changelog monorepo: every package under `packages/` shares this file. Per-package version bumps are noted in the relevant entry.

JSON-UI does not yet follow [Semantic Versioning](https://semver.org/). All releases are pre-1.0 (`0.x.y`); breaking changes may land in any minor bump until a 1.0.0 release. Once 1.0.0 ships, the project will switch to strict SemVer.

Change-type categories used below follow the Keep a Changelog spec:

- **Added** — new features.
- **Changed** — changes to existing functionality.
- **Deprecated** — features marked for removal in a future release.
- **Removed** — features removed in this release.
- **Fixed** — bug fixes.
- **Security** — vulnerability fixes.

In addition, this project uses two non-standard sections that fit how the work is organized:

- **Planned** — design specs and implementation plans landed in `docs/`. These are commitments to future work, not behavior changes themselves; they appear under `[Unreleased]` until the corresponding code lands, at which point they move into the appropriate standard section of the release that ships them.
- **Project meta** — repository housekeeping (CLAUDE.md, CHANGELOG.md, README touch-ups) that does not change package behavior.

---

## [Unreleased]

### Added

- **`@json-ui/core` runtime types module (`packages/core/src/runtime.ts`)** — new framework-agnostic observable store primitives implementing Plan 1 (`docs/plans/2026-04-13-core-runtime-types-plan.md`). Purely additive to core's public surface.
  - **Types:** `FieldId` (nominal string alias), `JSONValue` (recursive JSON-round-trippable union), `StagingSnapshot` (`Record<FieldId, JSONValue>`), `IntentEvent` (cross-backend catalog-action payload with `action_name`, `action_params`, `staging_snapshot`, `catalog_version?`, `timestamp`).
  - **Error class:** `InitialDataNotSerializableError` with `path` and `actualType` fields, thrown by `createObservableDataModel` on construction-time validation failures.
  - **Validator:** `validateJSONValue(value, path)` — structural-recursion validator with WeakSet cycle detection. Rejects 22 disqualified values in three positions each (top-level, nested in object, nested in array): `undefined`, `BigInt`, `Symbol`, function, `NaN`, `±Infinity`, `Date`, `RegExp`, `Error`, `Map`, `Set`, `WeakMap`, `WeakSet`, `Promise`, `ArrayBuffer`, `SharedArrayBuffer`, all typed arrays (`Uint8Array`, `Int32Array`, `Float64Array`, etc.), `URL`, circular references, and any object whose prototype is neither `Object.prototype` nor `null`. Accepts `Object.create(null)` with JSONValue properties.
  - **`StagingBuffer` interface + `createStagingBuffer()` factory** — observable in-memory store for in-progress user input with identity-stable cached snapshot (`Object.fromEntries`), synchronous subscriber notification, `reconcile(liveIds)` for garbage collection of orphaned fields, and `Map<symbol, () => void>` listener storage so identical callbacks registered twice produce two independent subscriptions.
  - **`ObservableDataModel` interface + `createObservableDataModel(initialData?)` factory** — path-based observable store for durable application data. Identity-stable snapshot cached via `structuredClone` (required to avoid aliasing the live mutable root — a bare `cachedSnapshot = root` alias would silently break React's `useSyncExternalStore` tearing protection). Validates `initialData` at construction via `validateJSONValue` and throws `InitialDataNotSerializableError` on the first non-serializable leaf. Path helpers (`getAtPath`/`setAtPath`/`deleteAtPath`) support the `/`-separated convention with leading-slash tolerance. `set()` and `delete()` conditionally fire subscribers based on whether the helper actually wrote or removed a value, preventing spurious React re-renders on no-op calls (empty paths, missing paths).
  - **Barrel exports** — all runtime types and factories are re-exported from `@json-ui/core`'s public `index.ts`. The existing 28 pre-existing value exports remain unchanged; the addition is purely additive.
  - **Test coverage** — 156 new tests across 4 test files (316 tests total across 12 test files, up from 160 baseline):
    - `runtime.test.ts`: StagingBuffer and ObservableDataModel behavior including identity-stable snapshots, synchronous notification, idempotent subscribe/unsubscribe, self-unsubscribe-during-notify (both stores), listener error isolation (both stores), reconcile semantics, empty-path edge cases, delete-of-absent-path behavior.
    - `runtime-validation.test.ts`: exhaustive disqualified-value matrix (22 × 3 positions = 66 core cases), cycle detection, `Object.create(null)` acceptance + negative case, dedicated `URL` top-level rejection, and the **Invariant 13 regression guard** that reads `runtime.ts` content and asserts no imports from `react`, `react-dom`, `jsdom`, or `@json-ui/react`.
    - `runtime-barrel.test.ts`: permanent regression guard asserting every pre-existing core export remains defined (**Invariant 14**) plus a structural check on the `IntentEvent` shape (**Invariant 15**).

### Fixed

- **`ObservableDataModel.get("")` was returning the live mutable `root`** (found by the Opus+Sonnet implementation review). Callers mutating the returned reference could bypass `invalidateAndNotify()`, leaving the cached snapshot stale and breaking React's `useSyncExternalStore` tearing protection (the `Object.is(prev, next)` check would return `true` after content mutation because both references were the same object). Fixed by returning `undefined` for the empty path — callers that want the whole state must use `snapshot()`.
- **`ObservableDataModel.set("")` was firing spurious subscriber notifications on no-op writes** (found by the same review). `setAtPath` returned early when `parts.length === 0` but the enclosing `set()` still called `invalidateAndNotify()` unconditionally, triggering React re-renders for writes that never happened. Fixed by making `setAtPath` return a boolean indicating whether it wrote, mirroring the existing `deleteAtPath` pattern; the enclosing `set()` now guards the notify on that boolean.
- **`Set<() => void>` listener deduplication** (found during Task 4 implementation, not by the plan review). The plan's listener storage used `Set<() => void>`, which dedupes identical function references. Registering the same callback twice would collapse into one subscription, failing the spec's "two independent subscriptions" invariant. Fixed by switching to `Map<symbol, () => void>` where each `subscribe()` call mints a unique `Symbol` key. Applied consistently across both `StagingBuffer` and `ObservableDataModel`.
- **`URL` values produced generic error messages** instead of a clean `"URL"` actualType. `validateJSONValue` had no dedicated `instanceof URL` branch, so `URL` values fell through to the "non-plain object" catchall and surfaced as `"URL (non-plain object)"`. Added a dedicated branch for consistency with `Date`/`RegExp`/`Error`/`Map`/`Set`.

### Project meta

- Every implementation decision in Plan 1 was taken through the six-agent review pattern (Opus + Sonnet × 3 plans during planning, Opus + Sonnet × 1 implementation after landing). Twenty-plus issues were caught across both review cycles. The pattern is now documented as a skill-level memory for reuse on Plans 2 and 3.
- `@types/node` added to the workspace root `devDependencies` so the Invariant 13 regression test can import from `node:fs/promises` and `node:path` under strict TypeScript. Vitest already runs in Node; this just exposes the types to `tsc --noEmit`.
- Added `CLAUDE.md` at the repo root documenting JSON-UI-specific conventions: workspace layout, TypeScript strictness gotchas (`noUncheckedIndexedAccess: true`), backward-compatibility constraints on `DataContextValue.set` and `onDataChange(path, value)`, leading-slash path convention, the `structuredClone` snapshot pattern, the post-order walker contract, the `serializers/types.ts` extraction, the specs+plans workflow under `docs/`, the Dropbox-sync gotcha for `node_modules`/`dist`, and the six-agent review pattern.
- Added this `CHANGELOG.md`, formatted per Keep a Changelog 1.1.0.

### Planned

- Implementation of `@json-ui/react`'s optional `store?: ObservableDataModel` prop on `DataProvider`, bound via React 18+'s `useSyncExternalStore`. Uses a split-component dispatcher (`DataProvider` → `InternalDataProvider` | `ExternalDataProvider`) so React's rules of hooks are satisfied. Backward compatible by default — every existing test in `data.test.tsx` continues to pass without modification. See `docs/plans/2026-04-13-react-external-data-store-plan.md` (6 tasks).
- Implementation of `@json-ui/headless`, a new framework-agnostic renderer package that walks a `UITree` with pure-function `HeadlessComponent`s, prunes by visibility, resolves `DynamicValue` against shared observable stores (consuming Plan 1's `StagingBuffer` and `ObservableDataModel`), and emits a `NormalizedNode` tree plus a fully JSON-serializable `RenderHooks` event stream for the LLM Observer Layer. Pluggable `Serializer<Output>` interface ships with `JsonSerializer`, `JsonStringSerializer`, and `createHtmlSerializer`. Designed to share state references with the React renderer for true dual-backend operation. See `docs/plans/2026-04-13-headless-renderer-plan.md` (12 tasks).

---

## [0.1.0] - 2026-04-12

Initial fork. Identity rewritten from `vercel-labs/json-render` for the Neural Computer project. The fork is a hard divergence — upstream merges are not tracked.

### Added

- **`@json-ui/core`** (0.1.0) — framework-agnostic Zod-typed catalog and runtime primitives:
  - `createCatalog({components, actions?, functions?})` with `generateCatalogPrompt(catalog)` for LLM prompt generation.
  - Component schema typing via Zod, with structural-recursion validation through `validateElement` and `validateTree`.
  - `UIElement` and `UITree` types — flat element map keyed by stable element keys, with parent/child relations expressed as key arrays.
  - `DynamicValue<T>` (`T | {path: string}`) and `resolveDynamicValue(value, dataModel)` for path-based runtime resolution against a `DataModel`.
  - `getByPath` / `setByPath` helpers using slash-separated path syntax with leading-slash tolerance.
  - `VisibilityCondition` union (boolean, path-ref, auth check, logic expression) plus `evaluateVisibility(condition, ctx)` and `evaluateLogicExpression(expr, ctx)`. Supports `and`/`or`/`not`/`eq`/`neq`/`gt`/`gte`/`lt`/`lte`.
  - `Action` / `ResolvedAction` types plus `resolveAction(action, dataModel)`, `executeAction(...)`, and `interpolateString(template, dataModel)` for `${path}` substitution.
  - `ValidationConfig` / `ValidationCheck` types, `runValidation(config, ctx)`, and `builtInValidationFunctions` (covering `required`, `email`, length checks, numeric ranges, regex, custom).
  - Helper builders `visibility`, `action`, and `check` for ergonomic catalog authoring.
  - Zod schemas for runtime validation: `ActionSchema`, `VisibilityConditionSchema`, `LogicExpressionSchema`, `ValidationCheckSchema`, `ValidationConfigSchema`, `DynamicValueSchema` and friends.
- **`@json-ui/react`** (0.1.0) — React 19 renderer:
  - `Renderer` component plus `JSONUIProvider` and `createRendererFromCatalog` for catalog-driven rendering.
  - `DataProvider` + `useData` / `useDataValue` / `useDataBinding` hooks for catalog-driven data binding through a React context. The `DataContextValue` exposes `data`, `authState`, `get(path)`, `set(path, value)`, and `update(updates)`. Mutations fire an optional `onDataChange(path, value)` callback.
  - `ActionProvider` + `useActions` / `useAction` hooks for action dispatch, including a built-in `ConfirmDialog` component for actions that declare a `confirm` config.
  - `ValidationProvider` + `useValidation` / `useFieldValidation` hooks for per-field validation state.
  - `VisibilityProvider` + `useVisibility` / `useIsVisible` hooks for evaluating element visibility against the current data and auth state.
  - `useUIStream` hook with `flatToTree` helper for streaming UI tree construction from LLM token deltas.
- **Build infrastructure**:
  - npm workspaces monorepo (`packages/*`).
  - `tsconfig.base.json` with `strict: true`, `noUncheckedIndexedAccess: true`, `target: ES2022`, `module: ESNext`, `moduleResolution: Bundler`.
  - `tsup` build config for every package: ESM + CJS + `.d.ts`, sourcemaps, clean output.
  - `vitest` + `jsdom` test setup with `globals: true`. Config at `vitest.config.ts` includes `packages/**/*.test.ts` and `packages/**/*.test.tsx`.
  - Apache-2.0 license.

### Changed

- Rewrote project identity from upstream `vercel-labs/json-render`: name, README, package names (`@json-ui/core`, `@json-ui/react`), keywords, and description. The upstream's `apps/web/app/(main)/docs` documentation site was stripped from the fork because JSON-UI does not ship a docs site at this stage.

### Fixed

- Resolved `noUncheckedIndexedAccess: true` typecheck failures introduced by the strictness flag during the identity rewrite. Bulk-applied non-null assertions (`!`) where prior logic had already verified existence:
  - `packages/react/src/hooks.test.ts` — 10 sites accessing `tree.elements["X"]`.
  - `packages/core/src/validation.test.ts` — 63 sites calling `builtInValidationFunctions.<name>(...)`.
  - `packages/core/src/catalog.test.ts` — one API-shape mismatch where the test passed a `{validate, description}` object to `CatalogConfig.functions` (which is typed as bare functions).

---

[Unreleased]: https://github.com/danielsimonjr/JSON-UI/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/danielsimonjr/JSON-UI/releases/tag/v0.1.0
