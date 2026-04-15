# JSON-UI — Project Instructions for Claude

Project-level guidance for any agent working on this repo. Global conventions live in `~/.claude/CLAUDE.md`; this file documents what is specific to JSON-UI.

## What this is

JSON-UI is a constrained-catalog UI library forked from `vercel-labs/json-render`. An LLM emits a JSON tree that must match a Zod-typed component catalog; the host app renders the validated tree. The fork was retitled and identity-rewritten for the Neural Computer (NC) project, where it serves as the UI Layer in a three-layer architecture (UI / Process / Memory) plus a cross-cutting LLM Observer.

Upstream lineage: `vercel-labs/json-render` → `danielsimonjr/JSON-UI`. We are not tracking upstream merges; the fork is a hard divergence.

## Workspace layout

npm workspaces monorepo. Three packages under `packages/`:

| Package             | Purpose                                                                                                                                             | Status |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `@json-ui/core`     | Framework-agnostic Zod catalog, types, visibility, validation, actions, observable store primitives (`StagingBuffer`, `ObservableDataModel`).       | Live   |
| `@json-ui/react`    | React 19 renderer with `DataProvider`, `ActionProvider`, `ValidationProvider`, `VisibilityProvider`. External-store mode via `useSyncExternalStore`. | Live   |
| `@json-ui/headless` | Framework-agnostic renderer that produces a `NormalizedNode` tree for the LLM Observer Layer. Dual-backend friendly.                                | Live   |

Top-level scripts (run from the repo root):

- `npm test` — vitest run across all packages (jsdom env, globals enabled)
- `npm run typecheck` — `tsc --noEmit` across all workspaces
- `npm run build` — `tsup` build for every package
- `npm run format` — prettier on `**/*.{ts,tsx,json,md}`

## Critical conventions

These are the conventions that have already caused bugs and must be respected:

### TypeScript

- **Strict mode + `noUncheckedIndexedAccess: true`** are enabled in `tsconfig.base.json`. Every `array[index]` and `record[key]` access yields `T | undefined`. Use `!` only when prior logic has already verified existence; otherwise add an explicit nil check. The two existing test files that needed bulk `!` insertion after the strictness flag was enabled are `packages/react/src/hooks.test.ts` (10 sites) and `packages/core/src/validation.test.ts` (63 sites).
- All packages extend `tsconfig.base.json`. Do not add per-package `strict: false` overrides.

### Existing public API — backward compatibility

The current `@json-ui/react` `DataProvider` ships these names. Any refactor must preserve them exactly:

- `DataContextValue.set` (NOT `setData`). The 2-arg `onDataChange(path, value)` (NOT 3-arg `(path, newValue, prevValue)`).
- Path strings use a leading slash by convention: `set("/user/name", "Alice")`. The internal `getByPath`/`setByPath` strip leading slashes via `.filter(p => p.length > 0)`, so both `/user/name` and `user/name` work, but the leading-slash form is what the existing tests assert.
- `DataModel = Record<string, unknown>` survives in core for backward compatibility. New code uses the tighter `Record<string, JSONValue>` from `runtime.ts` (planned in Plan 1).

### Observable stores (Plan 1, in flight)

When implementing `StagingBuffer` and `ObservableDataModel`:

- `snapshot()` MUST be identity-stable across calls with no intervening mutation, AND must return a NEW reference after any mutation. The cheapest correct implementation is `cachedSnapshot = structuredClone(root)` invalidated on `set`/`delete`/`reconcile`. A bare `cachedSnapshot = root` aliases the live mutable object and silently breaks React's `useSyncExternalStore` tearing protection — this bug was caught in the planning review.
- Subscribers fire **synchronously** before `set`/`delete`/`reconcile` returns. Listener errors are swallowed via `console.error` per spec.
- `validateJSONValue` rejects 22 disqualified values: `undefined`, `BigInt`, `Symbol`, function, `NaN`, `±Infinity`, `Date`, `RegExp`, `Error`, `Map`, `Set`, `WeakMap`, `WeakSet`, `Promise`, `ArrayBuffer`, `SharedArrayBuffer`, all typed arrays, `URL`, circular references, and any object whose prototype is neither `Object.prototype` nor `null`. Tests cover each in three positions (top-level, nested in object, nested in array).

### Headless renderer (Plan 3, live)

- `render(tree)` is a **pure function of `(tree, store-snapshots)`**. Components receive `ReadonlyStagingView` / `ReadonlyDataView` — no write methods, enforced at the type level.
- **Views bind to a FROZEN pass-start snapshot**, not to the live store. `makeStagingView` / `makeDataView` in `packages/headless/src/context.ts` call `buf.snapshot()` / `data.snapshot()` at construction time and close over the result. Because the renderer builds a fresh context per `render()` pass, any mid-render mutation through the live store (e.g., a hook callback writing via the session's public methods) cannot leak into later elements of the same pass. This is what makes Invariant 15 (render-pass purity) structural rather than a convention. The first draft delegated live and failed Invariant 15 — caught in the Opus implementation review.
- **Both `resolveDynamic` AND `resolveAction` consult BOTH staging AND data** with the same rule: for `{path: "<id>"}`, if the path has no `/` and staging has the key, prefer staging; otherwise walk the data snapshot via `getByPath`. The first Plan 3 draft only applied the rule to `resolveDynamic` — `resolveAction` delegated to core and silently dropped staging-only field IDs. Caught in review. Any future resolver must use the same rule.
- `RenderHooks` payloads must be JSON-`stringify`/`parse` round-trip safe. No `Date`, `Map`, function, class instance, or `BigInt` in any hook event. The `integration.test.ts` round-trip test enforces this — but **compare the round-trip against the ORIGINAL payload**, never against another round-trip (`x.toEqual(x)` with extra steps passes vacuously). Always add a negative-control test that proves the assertion fires. Both mistakes landed in Plan 3's first draft.
- The walker emits `onElementRender` in **post-order**: children fire before their parent. The renderer test asserts `["a", "b", "root"]` for a parent with two children.
- Every emitted `NormalizedNode` has `meta.visible === true`. Pruned nodes are ABSENT from output, not flagged. The `type: "Empty"` root placeholder is the distinct signal for callers that want to detect a fully invisible tree.
- `destroy()` uses a **flag-based** guard: the `destroyed` flag plus `ensureAlive()` on every public method prevents hook dispatch post-destroy. Do NOT mutate the composed hooks object — that was correctness-by-accident in the first draft.
- `serializers/Serializer` interface lives in its OWN file (`serializers/types.ts`) — putting it in `serializers/index.ts` creates a circular import with `json.ts`/`html.ts`.

## Specs and plans

Design + planning workflow uses two folders:

- `docs/specs/YYYY-MM-DD-<topic>-design.md` — the design spec, written via the brainstorming skill, reviewed by an Opus + Sonnet team, finalized before any implementation work.
- `docs/plans/YYYY-MM-DD-<topic>-plan.md` — the bite-sized implementation plan, written via the writing-plans skill, reviewed by an Opus + Sonnet team armed with the RLM skill, then run through HonestClaude before commit.

Shipped plans (April 2026) — all live on `main`:

1. `2026-04-13-core-runtime-types-plan.md` — Plan 1 (prerequisite). Added `packages/core/src/runtime.ts`.
2. `2026-04-13-react-external-data-store-plan.md` — Plan 2. Refactored `DataProvider` with split-component dispatcher.
3. `2026-04-13-headless-renderer-plan.md` — Plan 3. Built `@json-ui/headless` from scratch.

No plans queued. Future rounds will be brainstormed separately.

## Dropbox sync gotcha

The repo lives under `~/Dropbox/Github/JSON-UI/`. Mark `node_modules`, `dist`, and any other build artifact directories as Dropbox-ignored to avoid sync churn during builds:

```bash
powershell.exe -NoProfile -Command "Set-Content -Path 'C:\Users\danie\Dropbox\Github\JSON-UI\packages\<pkg>\node_modules:com.dropbox.ignored' -Value 1"
```

The Bash tool cannot invoke PowerShell cmdlets directly — call `powershell.exe -NoProfile -Command "..."` from Bash, or have the user run the cmdlet in a PowerShell terminal as a one-time setup.

## Git remote

- `origin` = `https://github.com/danielsimonjr/JSON-UI.git`
- Default branch: `main`
- We push directly to `main` for now (no PR workflow; small-team direct-to-main).

## Workflow guard

If the GitHub gh CLI token lacks the `workflow` OAuth scope, pushes that include `.github/workflows/` files will be rejected. Refresh with `gh auth refresh -h github.com -s workflow` interactively — the user must run this themselves.

## Review pattern that has worked

For non-trivial planning work: dispatch six Task subagents in parallel — Opus + Sonnet × 3 plans — with the RLM skill available and explicit review prompts (Opus gets architectural/spec-coverage focus, Sonnet gets tactical/code-correctness focus). Aggregate findings, fix critical bugs and important issues, then run a sequential HonestClaude pass to verify file paths/type signatures/bash commands against the actual codebase. Only then commit and push.

This pattern caught seven critical bugs in the April 2026 planning round that would have stalled execution at the first failing test.
