# Changelog

All notable changes to JSON-UI are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project does not yet follow [Semantic Versioning](https://semver.org/) (versions are pre-1.0).

## [Unreleased]

### Planning

- **Three design specs and three implementation plans** for the next major piece of work, covering observable runtime types, React external-store mode, and a new framework-agnostic headless renderer. Saved under `docs/specs/` and `docs/plans/`.
  - `docs/specs/2026-04-13-core-runtime-types-design.md` — adds `FieldId`, `JSONValue`, `StagingSnapshot`, `StagingBuffer` (observable, with subscribe/notify/snapshot/reconcile), `ObservableDataModel`, `IntentEvent`, and `InitialDataNotSerializableError` as a new `runtime.ts` module in `@json-ui/core`. Purely additive.
  - `docs/specs/2026-04-13-react-external-data-store-design.md` — teaches `@json-ui/react`'s `DataProvider` an optional `store?: ObservableDataModel` prop bound via `useSyncExternalStore`. Backward compatible by default through a split-component dispatcher pattern.
  - `docs/specs/2026-04-13-headless-renderer-design.md` — new `@json-ui/headless` package. Walks a `UITree` with pure-function `HeadlessComponent`s, prunes by visibility, resolves `DynamicValue` against shared observable stores, emits `NormalizedNode` trees and a fully serializable `RenderHooks` event stream for the LLM Observer Layer. Includes a pluggable `Serializer<Output>` interface with JSON and HTML serializers.
  - All three plans were reviewed by an Opus + Sonnet agent team armed with the RLM skill, then run through HonestClaude verification before commit. Seven critical bugs and ~15 important issues were caught and fixed before execution started — including an `ObservableDataModel.snapshot()` aliasing bug, a circular import in the serializers, and a missing staging consultation in `HeadlessContext.resolveDynamic`.

### Project meta

- Added `CLAUDE.md` documenting JSON-UI-specific conventions, workspace layout, the dual-backend shared-state architecture, the specs+plans workflow, and the review pattern that caught the planning bugs.
- Added this `CHANGELOG.md`.

## [0.1.0] — initial fork

- Lightweight fork of `vercel-labs/json-render`. Identity rewritten for the Neural Computer project. Two packages live: `@json-ui/core` and `@json-ui/react`. Strict TypeScript with `noUncheckedIndexedAccess: true`. vitest + jsdom test setup. tsup build for ESM + CJS + `.d.ts`.
