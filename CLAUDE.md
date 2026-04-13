# JSON-UI — Project Instructions for Claude

Project-level guidance for any agent working on this repo. Global conventions live in `~/.claude/CLAUDE.md`; this file documents what is specific to JSON-UI.

## What this is

JSON-UI is a constrained-catalog UI library forked from `vercel-labs/json-render`. An LLM emits a JSON tree that must match a Zod-typed component catalog; the host app renders the validated tree. The fork was retitled and identity-rewritten for the Neural Computer (NC) project, where it serves as the UI Layer in a three-layer architecture (UI / Process / Memory) plus a cross-cutting LLM Observer.

Upstream lineage: `vercel-labs/json-render` → `danielsimonjr/JSON-UI`. We are not tracking upstream merges; the fork is a hard divergence.

## Workspace layout

npm workspaces monorepo. Three packages under `packages/`:

| Package | Purpose | Status |
|---|---|---|
| `@json-ui/core` | Framework-agnostic Zod catalog, types, visibility, validation, actions. The only runtime dependency is `zod`. | Live |
| `@json-ui/react` | React 19 renderer with `DataProvider`, `ActionProvider`, `ValidationProvider`, `VisibilityProvider`. Peer dep on React 19. | Live |
| `@json-ui/headless` | Framework-agnostic renderer that produces a `NormalizedNode` tree for the LLM Observer Layer. | Planned (see `docs/plans/2026-04-13-headless-renderer-plan.md`) |

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

### Headless renderer (Plan 3, in flight)

- `render(tree)` is a **pure function of `(tree, store-snapshots)`**. Components receive `ReadonlyStagingView` / `ReadonlyDataView` — no write methods, enforced at the type level.
- `HeadlessContext.resolveDynamic` consults BOTH staging AND data. For `{path: "<id>"}`: if the path has no `/` and staging has the key, prefer staging; otherwise fall back to data. This is non-obvious and was a bug in the first draft.
- `RenderHooks` payloads must be JSON-`stringify`/`parse` round-trip safe. No `Date`, `Map`, function, class instance, or `BigInt` in any hook event. The `integration.test.ts` round-trip test enforces this.
- The walker emits `onElementRender` in **post-order**: children fire before their parent. The renderer test asserts `["a", "b", "root"]` for a parent with two children.
- `serializers/Serializer` interface lives in its OWN file (`serializers/types.ts`) — putting it in `serializers/index.ts` creates a circular import with `json.ts`/`html.ts`.

## Specs and plans

Design + planning workflow uses two folders:

- `docs/specs/YYYY-MM-DD-<topic>-design.md` — the design spec, written via the brainstorming skill, reviewed by an Opus + Sonnet team, finalized before any implementation work.
- `docs/plans/YYYY-MM-DD-<topic>-plan.md` — the bite-sized implementation plan, written via the writing-plans skill, reviewed by an Opus + Sonnet team armed with the RLM skill, then run through HonestClaude before commit.

Current plans (April 2026):
1. `2026-04-13-core-runtime-types-plan.md` — Plan 1 (prerequisite). Adds `packages/core/src/runtime.ts`.
2. `2026-04-13-react-external-data-store-plan.md` — Plan 2. Refactors `DataProvider` with split-component dispatcher.
3. `2026-04-13-headless-renderer-plan.md` — Plan 3 (main deliverable). Builds `@json-ui/headless` from scratch.

Each plan is independently executable but Plan 1 must land before Plan 2 or Plan 3.

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
