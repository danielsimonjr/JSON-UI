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

### Planned

- Design spec: `docs/specs/2026-04-13-core-runtime-types-design.md`. Adds a new `packages/core/src/runtime.ts` module that exports `FieldId`, `JSONValue`, `StagingSnapshot`, the observable `StagingBuffer` interface (with `subscribe`/`get`/`set`/`delete`/`has`/`snapshot`/`reconcile`), `createStagingBuffer`, the `ObservableDataModel` interface, `createObservableDataModel`, `IntentEvent`, and `InitialDataNotSerializableError`. Purely additive to `@json-ui/core`'s existing public surface.
- Design spec: `docs/specs/2026-04-13-react-external-data-store-design.md`. Teaches `@json-ui/react`'s `DataProvider` an optional `store?: ObservableDataModel` prop bound via React 18+'s `useSyncExternalStore`. Implementation uses a split-component dispatcher (`DataProvider` → `InternalDataProvider` | `ExternalDataProvider`) so React's rules of hooks are satisfied. Backward compatible by default — every existing test in `data.test.tsx` continues to pass without modification.
- Design spec: `docs/specs/2026-04-13-headless-renderer-design.md`. New `@json-ui/headless` package: a framework-agnostic renderer that walks a `UITree` with pure-function `HeadlessComponent`s, prunes by visibility, resolves `DynamicValue` against shared observable stores, and emits a `NormalizedNode` tree plus a fully JSON-serializable `RenderHooks` event stream for the LLM Observer Layer. Pluggable `Serializer<Output>` interface ships with `JsonSerializer`, `JsonStringSerializer`, and `createHtmlSerializer`. Designed to share `StagingBuffer` and `ObservableDataModel` references with the React renderer for true dual-backend operation.
- Implementation plan: `docs/plans/2026-04-13-core-runtime-types-plan.md` (Plan 1, prerequisite, 7 tasks).
- Implementation plan: `docs/plans/2026-04-13-react-external-data-store-plan.md` (Plan 2, 6 tasks, depends on Plan 1).
- Implementation plan: `docs/plans/2026-04-13-headless-renderer-plan.md` (Plan 3, 12 tasks, depends on Plan 1 and Plan 2).
- All three plans were reviewed by a six-agent team (Opus + Sonnet × 3 plans) armed with the RLM skill, then run through a sequential HonestClaude verification pass. Seven critical bugs and approximately fifteen important issues were caught and fixed before execution began. Notable fixes: `ObservableDataModel.snapshot()` now uses `structuredClone` to avoid aliasing the live mutable root (which would have broken React's `useSyncExternalStore` tearing protection); the disqualified-value validation matrix was expanded from 19 cases to 44 (all 22 disqualified values × 2 nested positions); `HeadlessContext.resolveDynamic` now consults staging in addition to data; the serializers' `Serializer` interface was extracted to `serializers/types.ts` to break a circular import with `serializers/index.ts`; explicit tests were added for render purity (Invariant 1) and render-pass consistency (Invariant 15); two mid-file ES module `import` bugs were corrected.

### Project meta

- Added `CLAUDE.md` documenting JSON-UI-specific conventions: workspace layout, TypeScript strictness gotchas (`noUncheckedIndexedAccess: true`), backward-compatibility constraints on `DataContextValue.set` and `onDataChange(path, value)`, leading-slash path convention, the `structuredClone` snapshot pattern, the post-order walker contract, the `serializers/types.ts` extraction, the specs+plans workflow under `docs/`, the Dropbox-sync gotcha for `node_modules`/`dist`, and the six-agent review pattern.
- Added this `CHANGELOG.md`, formatted per Keep a Changelog 1.1.0.

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
