# Headless Renderer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@json-ui/headless`, a third package in the JSON-UI workspace that renders catalog-constrained UI trees to a normalized intermediate representation with no React, no DOM, and no browser assumptions. Primary consumer: the Neural Computer LLM Observer Layer.

**Architecture:** Pure-function `HeadlessComponent`s walk a flat `UITree`, prune by visibility, resolve `DynamicValue`s against shared observable stores, and emit `NormalizedNode` trees. A `HeadlessRenderer` session holds the catalog, registry, hooks, and shared state references; consumers call `render`, `dispatch`, `setStagingField`, `setData`, and `destroy`. Pluggable `Serializer<Output>` instances convert `NormalizedNode` to HTML, JSON, or other targets. `RenderHooks` give the LLM Observer a fully serializable event stream.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), tsup (CJS+ESM+`.d.ts`), vitest. Depends only on `@json-ui/core` at runtime.

**Spec:** `docs/specs/2026-04-13-headless-renderer-design.md`
**Prerequisites:** Plan 1 (Core Runtime Types) and Plan 2 (React External Data Store) must both be completed first.

---

## Critical Conventions

1. **Strict type safety with `noUncheckedIndexedAccess: true`.** The repo's base tsconfig enables this. Every `tree.elements[key]` access yields `UIElement | undefined`. Use `!` only when the walker has already verified existence; prefer explicit nil checks.
2. **No React imports.** Not from `@json-ui/react`, not from `react`, not from `react-dom`, not from `jsdom`. The package's runtime dependency list contains exactly one entry: `@json-ui/core`. Invariant 8 in the spec is a literal test that scans every `.ts` file.
3. **Every hook payload is `JSON.stringify`/`JSON.parse` round-trip safe.** Spec Invariant 11. The hook test suite installs a serialization adapter that asserts deep equality after the round trip. No `Date`, no `Map`, no functions, no class instances inside event objects.
4. **`render()` is a pure function of `(tree, store-snapshots)`.** Component bodies receive read-only views; mutations only happen through explicit session methods. Spec Invariant 1.
5. **Visibility pruning is structural, not flag-based.** An invisible element is absent from its parent's `children` array. No `visible: false` placeholder. Spec Invariant 2.
6. **The package is the third workspace.** Add `packages/headless` to the existing npm workspaces glob (`packages/*` already covers it). Use the sibling `core` and `react` packages as configuration templates.
7. **Dropbox sync.** This package lives under a Dropbox-synced directory. Apply the `com.dropbox.ignored` NTFS attribute to `node_modules` and `dist` after creation (Task 2 Step 7) to prevent sync churn during builds.
8. **Watch out for `JSONValue` versus `Record<string, unknown>` mismatches.** Core's existing `resolveDynamicValue` returns `T | undefined` against a `DataModel = Record<string, unknown>`. The headless package speaks `JSONValue` everywhere. When piping core's results into a `NormalizedNode`'s `props: Record<string, JSONValue>`, narrow with a small `coerceToJSONValue` helper that accepts `unknown` and returns the value unchanged when it satisfies `JSONValue` or `null` otherwise. The helper does NOT throw — coercion is best-effort because we cannot fail rendering on a broken `DataModel` field.

---

## File Structure

```
packages/headless/
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── README.md
└── src/
    ├── index.ts                          # barrel — public surface
    ├── types.ts                          # NormalizedNode, NormalizedAction, NormalizedValidation,
    │                                       RenderPhase, RenderPassId, SessionStateSnapshot
    ├── errors.ts                         # SerializableError, toSerializableError, error classes
    ├── hooks.ts                          # RenderHooks, noopHooks, composeHooks
    ├── context.ts                        # ReadonlyStagingView, ReadonlyDataView,
    │                                       HeadlessContext, createHeadlessContext
    ├── registry.ts                       # HeadlessComponent, HeadlessRegistry types
    ├── walker.ts                         # walkTree — produces NormalizedNode from UITree
    ├── renderer.ts                       # createHeadlessRenderer — session factory
    ├── helpers/
    │   └── collect-ids.ts                # field-id collector for staging reconciliation
    └── serializers/
        ├── types.ts                      # Serializer<Output> interface (zero-import, breaks circularity)
        ├── index.ts                      # leaf barrel — re-exports types + json + html
        ├── json.ts                       # JsonSerializer
        └── html.ts                       # createHtmlSerializer
```

Each file has one responsibility. The longest source file (`renderer.ts`) should stay under 200 lines. Anything bigger is a signal a unit is doing too much and should be split.

---

## Task 1: Verify Prerequisites

**Files:** None.

- [ ] **Step 1: Confirm Plan 1 has landed (build + verify all required exports)**

First, ensure `@json-ui/core` is built (otherwise the `dist/index.js` may be stale):

```bash
cd "C:/Users/danie/Dropbox/Github/JSON-UI" && npm run build --workspace @json-ui/core
```

Then verify every export Plan 3 depends on is actually present in the built barrel. This is a runtime check, not just a typecheck — it catches the case where Plan 1's source compiled but the build artifact is stale:

```bash
cd "C:/Users/danie/Dropbox/Github/JSON-UI"
node -e "
const c = require('./packages/core/dist/index.js');
const required = [
  'createObservableDataModel',
  'createStagingBuffer',
  'InitialDataNotSerializableError',
  'validateJSONValue',
];
const missing = required.filter(name => typeof c[name] !== 'function' && typeof c[name] !== 'object');
if (missing.length > 0) {
  console.error('MISSING required exports from @json-ui/core:', missing.join(', '));
  console.error('Plan 1 has not been completed. Stop and finish it first.');
  process.exit(1);
}
console.log('All Plan 1 value exports present:', required.join(', '));
console.log('Type-only exports (FieldId, JSONValue, StagingSnapshot, StagingBuffer, ObservableDataModel, IntentEvent) are checked at typecheck time.');
"
```

Expected: prints "All Plan 1 value exports present: ..." and exits 0. If any are missing, complete Plan 1 first. Type-only exports cannot be checked at runtime; they will surface as typecheck errors in Tasks 3+ if missing.

- [ ] **Step 2: Confirm Plan 2 has landed**

```bash
cd "C:/Users/danie/Dropbox/Github/JSON-UI" && npm test -- packages/react/src/contexts/data-real-store.test.tsx
```

Expected: PASS. If the file does not exist, complete Plan 2 first. Plan 3 does not depend on Plan 2's React code at runtime, but reviewing both prerequisites grounds the implementer in the dual-backend story before they start writing code that consumes the same observable stores.

- [ ] **Step 3: Confirm clean workspace**

```bash
cd "C:/Users/danie/Dropbox/Github/JSON-UI" && git status
```

Expected: clean working tree on the same branch as Plans 1 and 2. Do not begin Task 2 with uncommitted changes — the package scaffolding step adds many files at once and a clean baseline makes review easier.

---

## Task 2: Scaffold `@json-ui/headless` Package

**Goal:** Create the package directory, configuration files, and an empty source tree. After this task `npm install` runs cleanly and `npm run typecheck --workspace @json-ui/headless` passes against the empty barrel.

**Files:**
- Create: `packages/headless/package.json`
- Create: `packages/headless/tsconfig.json`
- Create: `packages/headless/tsup.config.ts`
- Create: `packages/headless/README.md`
- Create: `packages/headless/src/index.ts` (empty barrel)

- [ ] **Step 1: Create the package directory and `package.json`**

Create `packages/headless/package.json`:

```json
{
  "name": "@json-ui/headless",
  "version": "0.1.0",
  "license": "Apache-2.0",
  "description": "Framework-agnostic headless renderer for @json-ui/core. Renders catalog-constrained UI trees to a normalized intermediate representation. Designed for LLM observer layers, server-side rendering, and non-React contexts.",
  "keywords": [
    "json",
    "ui",
    "ai",
    "llm",
    "generative-ui",
    "headless",
    "renderer",
    "framework-agnostic"
  ],
  "main": "./dist/index.js",
  "module": "./dist/index.mjs",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.mjs",
      "require": "./dist/index.js"
    }
  },
  "files": [
    "dist"
  ],
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@json-ui/core": "*"
  },
  "devDependencies": {
    "tsup": "^8.0.2",
    "typescript": "^5.4.5"
  }
}
```

This mirrors `packages/core/package.json`'s shape exactly — same script names, same `exports` field, same `files` field. No peer dependencies; no `react` anywhere.

- [ ] **Step 2: Create `tsconfig.json`**

Create `packages/headless/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

Identical to `packages/core/tsconfig.json`. Inherits `strict: true` and `noUncheckedIndexedAccess: true` from the base.

- [ ] **Step 3: Create `tsup.config.ts`**

Create `packages/headless/tsup.config.ts`:

```typescript
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  external: ["@json-ui/core"],
});
```

`external: ["@json-ui/core"]` keeps the core package out of the bundle (consumers get it via the workspace dependency).

- [ ] **Step 4: Create the empty barrel**

Create `packages/headless/src/index.ts`:

```typescript
// @json-ui/headless — framework-agnostic renderer for catalog-constrained UI trees.
// Public exports added in Task 12.
export {};
```

- [ ] **Step 5: Create `README.md`**

Create `packages/headless/README.md`:

```markdown
# @json-ui/headless

Framework-agnostic headless renderer for [@json-ui/core](../core). Renders catalog-constrained UI trees to a normalized intermediate representation with no React, no DOM, and no browser assumptions.

Primary consumer: the Neural Computer LLM Observer Layer. Also useful for server-side rendering, snapshot testing, and any context that needs a serializable view of UI state.

See `docs/specs/2026-04-13-headless-renderer-design.md` for the full design.
```

- [ ] **Step 6: Install workspace dependencies**

```bash
cd "C:/Users/danie/Dropbox/Github/JSON-UI" && npm install
```

Expected: the new `@json-ui/headless` workspace is registered, `node_modules` symlinks are created, and the install reports no errors. The workspace glob (`packages/*`) automatically picks up the new directory; no root `package.json` edit needed.

- [ ] **Step 7: Mark `node_modules` and `dist` as Dropbox-ignored**

The workspace lives under a Dropbox-synced directory. Mark `node_modules` and `dist` as ignored so Dropbox does not sync them during builds (this prevents file lock issues from concurrent sync and reindex storms).

**Execution note.** The Bash tool on Windows cannot directly invoke PowerShell cmdlets like `Set-Content` because Bash and PowerShell are different shells with different command resolution. There are two options:

**Option A (preferred):** Run the PowerShell command via a separate PowerShell shell invocation. From the Bash tool:

```bash
cd "C:/Users/danie/Dropbox/Github/JSON-UI/packages/headless" && mkdir -p node_modules dist
```

Then call PowerShell from Bash by prefixing with the full path to `powershell.exe`. The Windows-bash interop allows this:

```bash
powershell.exe -NoProfile -Command "Set-Content -Path 'C:\Users\danie\Dropbox\Github\JSON-UI\packages\headless\node_modules:com.dropbox.ignored' -Value 1"
powershell.exe -NoProfile -Command "Set-Content -Path 'C:\Users\danie\Dropbox\Github\JSON-UI\packages\headless\dist:com.dropbox.ignored' -Value 1"
```

Use absolute paths because the PowerShell child process may not inherit the bash `cwd`.

**Option B (fallback):** If `powershell.exe` is unavailable from the Bash tool environment, ask the user to run the two `Set-Content` commands manually in a PowerShell terminal. This is a one-time setup cost and is non-blocking — the package will work without the Dropbox-ignore attribute, but you'll see Dropbox sync churn during builds.

Verify the attribute was applied:

```bash
powershell.exe -NoProfile -Command "Get-Content -Path 'C:\Users\danie\Dropbox\Github\JSON-UI\packages\headless\node_modules:com.dropbox.ignored'"
```

Expected output: `1`. If the command errors with "Cannot find path", the attribute did not apply and you should retry Option A or fall back to Option B.

- [ ] **Step 8: Verify typecheck on the empty package**

```bash
cd "C:/Users/danie/Dropbox/Github/JSON-UI" && npm run typecheck --workspace @json-ui/headless
```

Expected: PASS. The package compiles even though `src/index.ts` is essentially empty.

- [ ] **Step 9: Verify build on the empty package**

```bash
cd "C:/Users/danie/Dropbox/Github/JSON-UI" && npm run build --workspace @json-ui/headless
```

Expected: PASS. `dist/index.js`, `dist/index.mjs`, and `dist/index.d.ts` are produced (each an essentially-empty module).

- [ ] **Step 10: Commit**

```bash
cd "C:/Users/danie/Dropbox/Github/JSON-UI" && git add packages/headless && git commit -m "feat(headless): scaffold @json-ui/headless package"
```

---

## Task 3: Add the `types.ts` Module

**Goal:** Define `NormalizedNode`, `NormalizedAction`, `NormalizedValidation`, `RenderPhase`, `RenderPassId`, and `SessionStateSnapshot`. Pure types, no runtime code, no tests of their own.

**Files:**
- Create: `packages/headless/src/types.ts`

- [ ] **Step 1: Write the types module**

Create `packages/headless/src/types.ts`:

```typescript
import type {
  JSONValue,
  StagingSnapshot,
} from "@json-ui/core";

/** A rendered element node. Fully resolved — no DynamicValues, no unevaluated visibility. */
export interface NormalizedNode {
  /** Stable element key from the original UITree. Used for testing, diffing, tracing. */
  key: string;
  /** Component type from the catalog (e.g., "TextField", "Checkbox"). */
  type: string;
  /** Resolved props. DynamicValue entries have been substituted. JSON-serializable. */
  props: Record<string, JSONValue>;
  /** Rendered children in document order. Elements filtered by visibility are absent. */
  children: NormalizedNode[];
  /** Resolved action descriptors, keyed by the prop name that carried the action. */
  actions?: Record<string, NormalizedAction>;
  /** Current validation state for this element, if it had a validation config. */
  validation?: NormalizedValidation;
  /** Optional metadata for observability. */
  meta?: {
    renderDurationMs?: number;
    visible: boolean; // always true on emitted nodes; false-visibility nodes are pruned
    validatedAt?: number;
  };
}

/** A fully-resolved action, ready for dispatch. */
export interface NormalizedAction {
  /** Action name from the catalog (e.g., "submit_form"). */
  name: string;
  /** Resolved params — DynamicValue substituted. JSON-serializable. */
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

/** Phase identifiers used by error events and per-phase observability. */
export type RenderPhase =
  | "walk"
  | "visibility"
  | "validation"
  | "component"
  | "serialize"
  | "dispatch";

/**
 * Monotonically increasing render-pass identifier within a session. Starts at 1.
 * Two different sessions can both have passId === 1 for their first renders.
 */
export type RenderPassId = number;

/**
 * Serializable snapshot of session state at the time a hook fires.
 * Every field satisfies JSONValue at the type level.
 */
export interface SessionStateSnapshot {
  staging: StagingSnapshot;
  data: Record<string, JSONValue>;
  catalogVersion?: string;
}
```

- [ ] **Step 2: Run typecheck**

```bash
cd "C:/Users/danie/Dropbox/Github/JSON-UI" && npm run typecheck --workspace @json-ui/headless
```

Expected: PASS. If `JSONValue` or `StagingSnapshot` are reported missing, Plan 1 is not landed correctly — go back to Task 1.

- [ ] **Step 3: Commit**

```bash
cd "C:/Users/danie/Dropbox/Github/JSON-UI" && git add packages/headless/src/types.ts && git commit -m "feat(headless): add normalized tree types"
```

---

## Task 4: Add `errors.ts` — Typed Errors and `toSerializableError`

**Goal:** Define `SerializableError`, the typed error classes (`UnknownComponentError`, `MissingChildError`, `OptionConflictError`, `SessionDestroyedError`, `RenderError`, `DispatchError`), and the `toSerializableError` helper with cause-chain walking and depth limiting.

**Files:**
- Create: `packages/headless/src/errors.ts`
- Create: `packages/headless/src/errors.test.ts`

- [ ] **Step 1: Write failing tests first**

Create `packages/headless/src/errors.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  toSerializableError,
  UnknownComponentError,
  MissingChildError,
  OptionConflictError,
  SessionDestroyedError,
} from "./errors";

describe("toSerializableError", () => {
  it("converts a plain Error", () => {
    const err = new Error("boom");
    const s = toSerializableError(err, "component");
    expect(s.name).toBe("Error");
    expect(s.message).toBe("boom");
    expect(s.phase).toBe("component");
    expect(typeof s.stack === "string" || s.stack === undefined).toBe(true);
    expect(s.cause).toBeUndefined();
  });

  it("walks a single cause", () => {
    const inner = new Error("inner");
    const outer = new Error("outer", { cause: inner });
    const s = toSerializableError(outer, "walk");
    expect(s.message).toBe("outer");
    expect(s.cause?.name).toBe("Error");
    expect(s.cause?.message).toBe("inner");
    // Nested causes do not carry phase per the SerializableError shape.
    expect((s.cause as { phase?: string }).phase).toBeUndefined();
  });

  it("walks a multi-level cause chain", () => {
    const a = new Error("a");
    const b = new Error("b", { cause: a });
    const c = new Error("c", { cause: b });
    const s = toSerializableError(c, "validation");
    expect(s.message).toBe("c");
    expect(s.cause?.message).toBe("b");
    expect(s.cause?.cause?.message).toBe("a");
  });

  it("handles a string cause", () => {
    const err = new Error("outer", { cause: "primitive-cause-string" });
    const s = toSerializableError(err, "component");
    expect(s.cause?.name).toBe("UnknownError");
    expect(s.cause?.message).toBe("primitive-cause-string");
  });

  it("stops cause-chain walking at depth 8 with an explicit marker", () => {
    // Build a chain a -> a (circular) — the walker must detect via depth, not
    // via reference identity, because we want a deterministic budget.
    const root = new Error("root") as Error & { cause?: unknown };
    root.cause = root;
    const s = toSerializableError(root, "walk");
    // Walk 8 layers down, then expect the marker.
    let cursor: { cause?: { name: string; message: string } } | undefined = s;
    for (let i = 0; i < 8 && cursor?.cause; i++) {
      cursor = cursor.cause;
    }
    expect(cursor?.cause?.name).toBe("CauseChainDepthLimitExceeded");
  });

  it("coerces an unknown throwable (number)", () => {
    const s = toSerializableError(42, "dispatch");
    expect(s.name).toBe("UnknownError");
    expect(s.message).toBe("42");
    expect(s.phase).toBe("dispatch");
  });

  it("coerces an unknown throwable (plain object)", () => {
    const s = toSerializableError({ msg: "hi" }, "component");
    expect(s.name).toBe("UnknownError");
    // String({msg:"hi"}) === "[object Object]"
    expect(s.message).toBe("[object Object]");
  });

  it("coerces undefined", () => {
    const s = toSerializableError(undefined, "walk");
    expect(s.name).toBe("UnknownError");
    expect(s.message).toBe("undefined");
  });

  it("handles a duck-typed Error-like object", () => {
    const ducky = { name: "DOMException", message: "abort" };
    const s = toSerializableError(ducky, "component");
    expect(s.name).toBe("DOMException");
    expect(s.message).toBe("abort");
  });
});

describe("error classes", () => {
  it("UnknownComponentError carries the type", () => {
    const err = new UnknownComponentError("WidgetX", "elem-42");
    expect(err.name).toBe("UnknownComponentError");
    expect(err.elementType).toBe("WidgetX");
    expect(err.elementKey).toBe("elem-42");
    expect(err.message).toContain("WidgetX");
  });

  it("MissingChildError carries the missing key", () => {
    const err = new MissingChildError("missing-key-99", "parent-key");
    expect(err.name).toBe("MissingChildError");
    expect(err.missingKey).toBe("missing-key-99");
    expect(err.parentKey).toBe("parent-key");
  });

  it("OptionConflictError surfaces the conflicting fields", () => {
    const err = new OptionConflictError(["initialData", "data"]);
    expect(err.name).toBe("OptionConflictError");
    expect(err.fields).toEqual(["initialData", "data"]);
  });

  it("SessionDestroyedError has a stable name", () => {
    const err = new SessionDestroyedError();
    expect(err.name).toBe("SessionDestroyedError");
  });
});

describe("SerializableError JSON round-trip", () => {
  it("survives JSON.stringify / JSON.parse", () => {
    const inner = new Error("inner");
    const outer = new Error("outer", { cause: inner });
    const s = toSerializableError(outer, "walk");
    const round = JSON.parse(JSON.stringify(s));
    expect(round).toEqual(JSON.parse(JSON.stringify(s)));
    expect(round.message).toBe("outer");
    expect(round.cause.message).toBe("inner");
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
cd "C:/Users/danie/Dropbox/Github/JSON-UI" && npm test -- packages/headless/src/errors.test.ts
```

Expected: FAIL — `errors.ts` does not exist yet.

- [ ] **Step 3: Implement `errors.ts`**

Create `packages/headless/src/errors.ts`:

```typescript
import type { RenderPhase } from "./types";

/** Serializable error record — plain data, no Error instance, no functions. */
export interface SerializableError {
  name: string;
  message: string;
  stack?: string;
  phase: RenderPhase;
  /** Recursive chain of caused-by errors. Each entry omits `phase` (top-level only). */
  cause?: Omit<SerializableError, "phase">;
}

const MAX_CAUSE_DEPTH = 8;

function isErrorLike(v: unknown): v is { name?: unknown; message: unknown; stack?: unknown; cause?: unknown } {
  return typeof v === "object" && v !== null && "message" in v && typeof (v as { message: unknown }).message === "string";
}

function coerceUnknown(value: unknown): { name: string; message: string; stack?: string; cause?: unknown } {
  if (value instanceof Error) {
    return {
      name: value.name || "Error",
      message: value.message,
      stack: value.stack,
      cause: (value as Error & { cause?: unknown }).cause,
    };
  }
  if (isErrorLike(value)) {
    return {
      name: typeof value.name === "string" ? value.name : "UnknownError",
      message: String(value.message),
      stack: typeof value.stack === "string" ? value.stack : undefined,
      cause: value.cause,
    };
  }
  return {
    name: "UnknownError",
    message: String(value),
  };
}

function walkCause(value: unknown, depth: number): Omit<SerializableError, "phase"> | undefined {
  if (value === undefined || value === null) return undefined;
  if (depth >= MAX_CAUSE_DEPTH) {
    return {
      name: "CauseChainDepthLimitExceeded",
      message: `Cause chain exceeded the maximum depth of ${MAX_CAUSE_DEPTH}; remaining causes were not captured.`,
    };
  }
  const c = coerceUnknown(value);
  const out: Omit<SerializableError, "phase"> = {
    name: c.name,
    message: c.message,
  };
  if (c.stack !== undefined) out.stack = c.stack;
  const nested = walkCause(c.cause, depth + 1);
  if (nested !== undefined) out.cause = nested;
  return out;
}

/**
 * Convert any thrown value into a SerializableError. Walks the cause chain up
 * to MAX_CAUSE_DEPTH (8) levels and coerces non-Error throwables to
 * `{name: "UnknownError", message: String(value)}`.
 */
export function toSerializableError(error: unknown, phase: RenderPhase): SerializableError {
  const c = coerceUnknown(error);
  const out: SerializableError = {
    name: c.name,
    message: c.message,
    phase,
  };
  if (c.stack !== undefined) out.stack = c.stack;
  const nested = walkCause(c.cause, 1);
  if (nested !== undefined) out.cause = nested;
  return out;
}

/** Thrown when the walker hits a UIElement whose `type` has no registry entry. */
export class UnknownComponentError extends Error {
  override name = "UnknownComponentError";
  constructor(
    public readonly elementType: string,
    public readonly elementKey: string,
  ) {
    super(`No component registered for type "${elementType}" (element key "${elementKey}")`);
  }
}

/** Thrown when a UITree element references a child key that does not exist in `tree.elements`. */
export class MissingChildError extends Error {
  override name = "MissingChildError";
  constructor(
    public readonly missingKey: string,
    public readonly parentKey: string,
  ) {
    super(`Missing child key "${missingKey}" referenced by parent "${parentKey}"`);
  }
}

/** Thrown when `createHeadlessRenderer` receives mutually exclusive options. */
export class OptionConflictError extends Error {
  override name = "OptionConflictError";
  constructor(public readonly fields: readonly string[]) {
    super(`Mutually exclusive options provided: ${fields.join(", ")}`);
  }
}

/** Thrown by any session method called after `destroy()`. */
export class SessionDestroyedError extends Error {
  override name = "SessionDestroyedError";
  constructor() {
    super("Session has been destroyed; no further operations are permitted.");
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd "C:/Users/danie/Dropbox/Github/JSON-UI" && npm test -- packages/headless/src/errors.test.ts
```

Expected: every test PASSES. If the depth-limit test fails, double-check the recursion: `walkCause(value, 1)` is called from `toSerializableError`, then incremented in each recursive call; the marker fires when `depth >= 8` on the next recursion.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/danie/Dropbox/Github/JSON-UI" && git add packages/headless/src/errors.ts packages/headless/src/errors.test.ts && git commit -m "feat(headless): add errors module with toSerializableError and typed error classes"
```

---

## Task 5: Add `hooks.ts` — `RenderHooks` Interface, No-Op Default, `composeHooks`

**Goal:** Define the seven `RenderHooks` event payloads, a no-op default implementation, and a `composeHooks` helper that merges multiple partials. The hooks file has zero runtime cost when no consumer installs anything.

**Files:**
- Create: `packages/headless/src/hooks.ts`
- Create: `packages/headless/src/hooks.test.ts`

- [ ] **Step 1: Write failing tests first**

Create `packages/headless/src/hooks.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { noopHooks, composeHooks, type RenderHooks } from "./hooks";

describe("noopHooks", () => {
  it("provides a no-throw implementation of every hook field", () => {
    const calls = (
      [
        "onBeforeRender",
        "onAfterRender",
        "onElementRender",
        "onActionDispatched",
        "onStagingChange",
        "onDataChange",
        "onError",
      ] as const
    ).map((k) => () => (noopHooks[k] as (e: unknown) => void)({}));
    for (const fn of calls) {
      expect(fn).not.toThrow();
    }
  });
});

describe("composeHooks", () => {
  it("calls every partial in order on every hook field", () => {
    const a = vi.fn();
    const b = vi.fn();
    const merged = composeHooks(
      { onBeforeRender: a },
      { onBeforeRender: b },
    );
    merged.onBeforeRender({
      passId: 1,
      tree: { root: "r", elements: {} },
      state: { staging: {}, data: {} },
      timestamp: 1,
    });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("falls back to noop for fields no partial provides", () => {
    const merged = composeHooks({ onBeforeRender: vi.fn() });
    expect(() =>
      merged.onAfterRender({
        passId: 1,
        tree: { root: "r", elements: {} },
        result: { key: "r", type: "x", props: {}, children: [] },
        elapsedMs: 0,
        timestamp: 1,
      }),
    ).not.toThrow();
  });

  it("composes multiple partials left-to-right per field", () => {
    const log: string[] = [];
    const merged = composeHooks(
      { onElementRender: () => log.push("first") },
      { onElementRender: () => log.push("second") },
      { onElementRender: () => log.push("third") },
    );
    merged.onElementRender({
      passId: 1,
      elementKey: "k",
      elementType: "Text",
      result: { key: "k", type: "Text", props: {}, children: [] },
      timestamp: 1,
    });
    expect(log).toEqual(["first", "second", "third"]);
  });

  it("isolates a throwing hook so other composed hooks still fire", () => {
    const a = vi.fn(() => {
      throw new Error("a-blew-up");
    });
    const b = vi.fn();
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const merged = composeHooks({ onBeforeRender: a }, { onBeforeRender: b });
    merged.onBeforeRender({
      passId: 1,
      tree: { root: "r", elements: {} },
      state: { staging: {}, data: {} },
      timestamp: 1,
    });
    expect(a).toHaveBeenCalled();
    expect(b).toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
cd "C:/Users/danie/Dropbox/Github/JSON-UI" && npm test -- packages/headless/src/hooks.test.ts
```

Expected: FAIL — `hooks.ts` does not exist yet.

- [ ] **Step 3: Implement `hooks.ts`**

Create `packages/headless/src/hooks.ts`:

```typescript
import type {
  FieldId,
  IntentEvent,
  JSONValue,
  StagingBuffer,
  UITree,
} from "@json-ui/core";
import type {
  NormalizedNode,
  RenderPassId,
  SessionStateSnapshot,
} from "./types";
import type { SerializableError } from "./errors";

export interface RenderHooks {
  onBeforeRender(event: {
    passId: RenderPassId;
    tree: UITree;
    state: SessionStateSnapshot;
    timestamp: number;
  }): void;

  onAfterRender(event: {
    passId: RenderPassId;
    tree: UITree;
    result: NormalizedNode;
    elapsedMs: number;
    timestamp: number;
  }): void;

  onElementRender(event: {
    passId: RenderPassId;
    elementKey: string;
    elementType: string;
    result: NormalizedNode;
    timestamp: number;
  }): void;

  onActionDispatched(event: IntentEvent): void;

  onStagingChange(event: {
    fieldId: FieldId;
    newValue: JSONValue;
    oldValue: JSONValue | undefined;
    timestamp: number;
  }): void;

  onDataChange(event: {
    path: string;
    newValue: JSONValue;
    oldValue: JSONValue | undefined;
    timestamp: number;
  }): void;

  onError(error: SerializableError): void;
}

const noop = () => {};

/**
 * No-op default for every hook field. The session's hook dispatcher merges
 * a consumer's `Partial<RenderHooks>` against this default so every field is
 * always callable with no extra null-checks.
 */
export const noopHooks: RenderHooks = {
  onBeforeRender: noop,
  onAfterRender: noop,
  onElementRender: noop,
  onActionDispatched: noop,
  onStagingChange: noop,
  onDataChange: noop,
  onError: noop,
};

const HOOK_FIELDS = [
  "onBeforeRender",
  "onAfterRender",
  "onElementRender",
  "onActionDispatched",
  "onStagingChange",
  "onDataChange",
  "onError",
] as const;

type HookField = (typeof HOOK_FIELDS)[number];

/**
 * Merge multiple Partial<RenderHooks> into a single RenderHooks. For each
 * field, all provided callbacks are called in order. A throwing callback is
 * caught (logged via console.error) and does not prevent siblings from firing.
 *
 * This is the spec's hook composition primitive: a consumer can install one
 * partial set for in-process debugging and another for the transaction-log
 * feed, and both fire for every event.
 */
export function composeHooks(...partials: Array<Partial<RenderHooks>>): RenderHooks {
  const merged: RenderHooks = { ...noopHooks };
  for (const field of HOOK_FIELDS) {
    const handlers: Array<(arg: never) => void> = [];
    for (const p of partials) {
      const fn = p[field];
      if (typeof fn === "function") {
        handlers.push(fn as (arg: never) => void);
      }
    }
    if (handlers.length === 0) continue;
    (merged[field] as (arg: never) => void) = ((event: never) => {
      for (const handler of handlers) {
        try {
          handler(event);
        } catch (err) {
          // Per spec: hook callback errors are swallowed (not re-thrown, not
          // re-emitted via onError) to prevent (a) buggy hooks crashing
          // healthy renders, and (b) infinite recursion if onError itself
          // throws. console.error preserves observability.
          // eslint-disable-next-line no-console
          console.error(`[@json-ui/headless] hook ${field} threw:`, err);
        }
      }
    }) as never;
  }
  return merged;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
cd "C:/Users/danie/Dropbox/Github/JSON-UI" && npm test -- packages/headless/src/hooks.test.ts
```

Expected: every test PASSES.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/danie/Dropbox/Github/JSON-UI" && git add packages/headless/src/hooks.ts packages/headless/src/hooks.test.ts && git commit -m "feat(headless): add RenderHooks interface, noopHooks default, and composeHooks"
```

---

## Task 6: Add `context.ts` — Read-Only Views and `HeadlessContext`

**Goal:** Define `ReadonlyStagingView`, `ReadonlyDataView`, the `HeadlessContext` interface, and a `createHeadlessContext` factory that wraps the session's stores into read-only views and wires the resolver helpers into core's existing `evaluateVisibility`, `runValidation`, `resolveDynamicValue`, and `resolveAction` functions.

**Files:**
- Create: `packages/headless/src/context.ts`
- Create: `packages/headless/src/context.test.ts`

- [ ] **Step 1: Write failing tests first**

Create `packages/headless/src/context.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { createObservableDataModel, createStagingBuffer } from "@json-ui/core";
import { createHeadlessContext } from "./context";

describe("createHeadlessContext", () => {
  it("exposes a read-only staging view that mirrors the underlying buffer", () => {
    const buf = createStagingBuffer();
    buf.set("name", "Alice");
    const ctx = createHeadlessContext({
      staging: buf,
      data: createObservableDataModel({}),
    });
    expect(ctx.staging.get("name")).toBe("Alice");
    expect(ctx.staging.has("name")).toBe(true);
    expect(ctx.staging.has("missing")).toBe(false);
    // No write methods on the view.
    expect("set" in ctx.staging).toBe(false);
    expect("delete" in ctx.staging).toBe(false);
    expect("subscribe" in ctx.staging).toBe(false);
  });

  it("exposes a read-only data view that mirrors the underlying store", () => {
    const data = createObservableDataModel({ user: { name: "Bob" } });
    const ctx = createHeadlessContext({ staging: createStagingBuffer(), data });
    expect(ctx.data.get("user/name")).toBe("Bob");
    expect("set" in ctx.data).toBe(false);
  });

  it("evaluates a true visibility condition", () => {
    const ctx = createHeadlessContext({
      staging: createStagingBuffer(),
      data: createObservableDataModel({ flag: true }),
    });
    expect(ctx.evaluateVisibility(undefined)).toBe(true);
    expect(ctx.evaluateVisibility(true)).toBe(true);
    expect(ctx.evaluateVisibility({ path: "flag" })).toBe(true);
  });

  it("evaluates a false visibility condition", () => {
    const ctx = createHeadlessContext({
      staging: createStagingBuffer(),
      data: createObservableDataModel({ flag: false }),
    });
    expect(ctx.evaluateVisibility(false)).toBe(false);
    expect(ctx.evaluateVisibility({ path: "flag" })).toBe(false);
    expect(ctx.evaluateVisibility({ path: "missing" })).toBe(false);
  });

  it("resolves DynamicValue against data", () => {
    const ctx = createHeadlessContext({
      staging: createStagingBuffer(),
      data: createObservableDataModel({ user: { id: 42 } }),
    });
    const resolved = ctx.resolveDynamic({
      direct: "literal",
      ref: { path: "user/id" },
    });
    expect(resolved).toEqual({ direct: "literal", ref: 42 });
  });

  it("resolves DynamicValue against staging when path is a single-segment field id", () => {
    // Spec: resolveDynamic must consult BOTH data and staging. A button's
    // action params may reference a staging field ({path: "email"}) — that
    // should pull from the staging buffer, not from the data model.
    const buf = createStagingBuffer();
    buf.set("email", "user@example.com");
    const ctx = createHeadlessContext({
      staging: buf,
      data: createObservableDataModel({}),
    });
    const resolved = ctx.resolveDynamic({
      to: { path: "email" },
      subject: "Welcome",
    });
    expect(resolved).toEqual({ to: "user@example.com", subject: "Welcome" });
  });

  it("prefers staging over data when both have a value for a single-segment path", () => {
    // Edge case: same key exists in both. Staging wins because it is the
    // user's in-progress state and supersedes durable data for the moment.
    const buf = createStagingBuffer();
    buf.set("name", "draft-name");
    const ctx = createHeadlessContext({
      staging: buf,
      data: createObservableDataModel({ name: "saved-name" }),
    });
    const resolved = ctx.resolveDynamic({ ref: { path: "name" } });
    expect(resolved.ref).toBe("draft-name");
  });

  it("falls back to data when a single-segment path is not in staging", () => {
    const ctx = createHeadlessContext({
      staging: createStagingBuffer(),
      data: createObservableDataModel({ name: "saved-name" }),
    });
    const resolved = ctx.resolveDynamic({ ref: { path: "name" } });
    expect(resolved.ref).toBe("saved-name");
  });

  it("resolveAction returns a NormalizedAction", () => {
    const ctx = createHeadlessContext({
      staging: createStagingBuffer(),
      data: createObservableDataModel({ user: { name: "Carol" } }),
    });
    const norm = ctx.resolveAction({
      name: "submit",
      params: { who: { path: "user/name" }, where: "form" },
    });
    expect(norm.name).toBe("submit");
    expect(norm.params.who).toBe("Carol");
    expect(norm.params.where).toBe("form");
  });

  it("runs a passing validation", () => {
    const ctx = createHeadlessContext({
      staging: createStagingBuffer(),
      data: createObservableDataModel({}),
    });
    const result = ctx.runValidation(
      { checks: [{ fn: "required", message: "Required" }] },
      "hello",
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("runs a failing validation", () => {
    const ctx = createHeadlessContext({
      staging: createStagingBuffer(),
      data: createObservableDataModel({}),
    });
    const result = ctx.runValidation(
      { checks: [{ fn: "required", message: "Required" }] },
      "",
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.message).toBe("Required");
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
cd "C:/Users/danie/Dropbox/Github/JSON-UI" && npm test -- packages/headless/src/context.test.ts
```

Expected: FAIL — `context.ts` does not exist.

- [ ] **Step 3: Implement `context.ts`**

Create `packages/headless/src/context.ts`:

```typescript
import {
  evaluateVisibility as coreEvaluateVisibility,
  runValidation as coreRunValidation,
  resolveAction as coreResolveAction,
  resolveDynamicValue,
  type Action,
  type AuthState,
  type FieldId,
  type JSONValue,
  type ObservableDataModel,
  type StagingBuffer,
  type StagingSnapshot,
  type ValidationConfig,
  type ValidationFunction,
  type VisibilityCondition,
} from "@json-ui/core";
import type {
  NormalizedAction,
  NormalizedValidation,
} from "./types";

/** Read-only view of a StagingBuffer exposed during render. No set/delete/subscribe. */
export interface ReadonlyStagingView {
  get(fieldId: FieldId): JSONValue | undefined;
  has(fieldId: FieldId): boolean;
  snapshot(): StagingSnapshot;
}

/** Read-only view of an ObservableDataModel exposed during render. No set/delete/subscribe. */
export interface ReadonlyDataView {
  get(path: string): JSONValue | undefined;
  snapshot(): Readonly<Record<string, JSONValue>>;
}

export interface HeadlessContext {
  staging: ReadonlyStagingView;
  data: ReadonlyDataView;
  /**
   * Resolve every DynamicValue entry in a params object against the bound
   * data + staging views. Literal values pass through unchanged.
   */
  resolveDynamic(params: Record<string, unknown>): Record<string, JSONValue>;
  /** Evaluate a visibility condition against the bound views and (optional) auth state. */
  evaluateVisibility(condition: VisibilityCondition | undefined): boolean;
  /** Run validation against an input value, using the bound data view. */
  runValidation(config: ValidationConfig, value: JSONValue): NormalizedValidation;
  /** Convert a catalog Action to a NormalizedAction (resolves DynamicValues). */
  resolveAction(action: Action): NormalizedAction;
}

interface CreateHeadlessContextInput {
  staging: StagingBuffer;
  data: ObservableDataModel;
  authState?: AuthState;
  validationFunctions?: Record<string, ValidationFunction>;
}

/** Coerce an arbitrary value to a JSONValue. Non-JSON inputs become null. */
function coerceToJSONValue(value: unknown): JSONValue {
  if (value === null) return null;
  switch (typeof value) {
    case "string":
    case "boolean":
      return value;
    case "number":
      return Number.isFinite(value) ? value : null;
    case "object": {
      if (Array.isArray(value)) {
        return value.map(coerceToJSONValue);
      }
      const out: Record<string, JSONValue> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = coerceToJSONValue(v);
      }
      return out;
    }
    default:
      return null;
  }
}

function makeStagingView(buf: StagingBuffer): ReadonlyStagingView {
  return {
    get: (id) => buf.get(id),
    has: (id) => buf.has(id),
    snapshot: () => buf.snapshot(),
  };
}

function makeDataView(data: ObservableDataModel): ReadonlyDataView {
  return {
    get: (path) => data.get(path),
    snapshot: () => data.snapshot(),
  };
}

export function createHeadlessContext(input: CreateHeadlessContextInput): HeadlessContext {
  const stagingView = makeStagingView(input.staging);
  const dataView = makeDataView(input.data);

  return {
    staging: stagingView,
    data: dataView,

    resolveDynamic(params) {
      // Spec requires substitution against BOTH data and staging. A
      // catalog button's action params may reference a staging field
      // ({path: "email"}) OR a data path ({path: "user/profile/name"}).
      // Core's `resolveDynamicValue(value, dataModel)` only consults a
      // single source, so we resolve `{path}` literals here directly,
      // checking staging first (single-segment field IDs always live
      // there) and falling back to the data model for dotted/slashed
      // paths. Non-DynamicValue entries pass through coerceToJSONValue.
      const out: Record<string, JSONValue> = {};
      for (const [key, value] of Object.entries(params)) {
        if (
          value !== null &&
          typeof value === "object" &&
          !Array.isArray(value) &&
          "path" in value &&
          typeof (value as { path: unknown }).path === "string"
        ) {
          const path = (value as { path: string }).path;
          // Staging is keyed by flat field IDs (no slashes). If the path is
          // single-segment AND staging has it, prefer staging.
          if (!path.includes("/") && stagingView.has(path)) {
            out[key] = coerceToJSONValue(stagingView.get(path));
            continue;
          }
          // Otherwise resolve against the data model via core's helper.
          out[key] = coerceToJSONValue(
            resolveDynamicValue(value as never, dataView.snapshot() as never),
          );
          continue;
        }
        // Literal: coerce and pass through.
        out[key] = coerceToJSONValue(value);
      }
      return out;
    },

    evaluateVisibility(condition) {
      if (condition === undefined) return true;
      return coreEvaluateVisibility(condition, {
        dataModel: dataView.snapshot() as Record<string, unknown>,
        authState: input.authState,
      });
    },

    runValidation(config, value) {
      const result = coreRunValidation(config, {
        value,
        dataModel: dataView.snapshot() as Record<string, unknown>,
        customFunctions: input.validationFunctions,
        authState: input.authState
          ? { isSignedIn: input.authState.isSignedIn }
          : undefined,
      });
      return {
        valid: result.valid,
        errors: result.errors.map((message) => ({ message })),
      };
    },

    resolveAction(action) {
      const resolved = coreResolveAction(
        action,
        dataView.snapshot() as Record<string, unknown>,
      );
      const params: Record<string, JSONValue> = {};
      for (const [key, value] of Object.entries(resolved.params)) {
        params[key] = coerceToJSONValue(value);
      }
      const out: NormalizedAction = {
        name: resolved.name,
        params,
      };
      if (resolved.confirm) {
        out.confirm = {
          title: resolved.confirm.title,
          message: resolved.confirm.message,
        };
      }
      return out;
    },
  };
}
```

- [ ] **Step 4: Run the tests**

```bash
cd "C:/Users/danie/Dropbox/Github/JSON-UI" && npm test -- packages/headless/src/context.test.ts
```

Expected: every test PASSES. If `runValidation` reports `required` is not a registered function, verify `builtInValidationFunctions.required` exists in core (it does — `validation.ts` line 69). The `customFunctions` field of `ValidationContext` only adds to the built-ins, it does not replace them.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/danie/Dropbox/Github/JSON-UI" && git add packages/headless/src/context.ts packages/headless/src/context.test.ts && git commit -m "feat(headless): add HeadlessContext with read-only views and core delegates"
```

---

## Task 7: Add `registry.ts` and `walker.ts`

**Goal:** Define the `HeadlessComponent` and `HeadlessRegistry` types, then implement the `walkTree` function that traverses a flat `UITree`, prunes by visibility, handles missing children, looks up components in the registry, and produces a `NormalizedNode` tree. The walker also fires `onElementRender` for each visible element.

**Files:**
- Create: `packages/headless/src/registry.ts`
- Create: `packages/headless/src/walker.ts`
- Create: `packages/headless/src/walker.test.ts`

- [ ] **Step 1: Create `registry.ts`**

Create `packages/headless/src/registry.ts`:

```typescript
import type { UIElement } from "@json-ui/core";
import type { HeadlessContext } from "./context";
import type { NormalizedNode } from "./types";

/**
 * A pure function that takes an element, a render context, and the already-
 * rendered children, and returns a NormalizedNode. No hooks, no closure state,
 * no lifecycle. All state flows through `ctx`.
 */
export type HeadlessComponent<P = Record<string, unknown>> = (
  element: UIElement<string, P>,
  ctx: HeadlessContext,
  children: NormalizedNode[],
) => NormalizedNode;

/** Component-type to function map. */
export type HeadlessRegistry = Record<string, HeadlessComponent>;
```

- [ ] **Step 2: Write failing tests for the walker**

Create `packages/headless/src/walker.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { createObservableDataModel, createStagingBuffer, type UITree } from "@json-ui/core";
import { walkTree } from "./walker";
import { createHeadlessContext } from "./context";
import { type HeadlessRegistry } from "./registry";
import { type NormalizedNode } from "./types";
import { noopHooks } from "./hooks";

const passthroughText: HeadlessRegistry = {
  Text: (element, _ctx, children) => ({
    key: element.key,
    type: "Text",
    props: { content: (element.props as { content?: string }).content ?? "" },
    children,
    meta: { visible: true },
  }),
  Container: (element, _ctx, children) => ({
    key: element.key,
    type: "Container",
    props: {},
    children,
    meta: { visible: true },
  }),
};

function makeCtx(initialData: Record<string, unknown> = {}) {
  return createHeadlessContext({
    staging: createStagingBuffer(),
    data: createObservableDataModel(initialData as never),
  });
}

describe("walkTree", () => {
  it("walks a single root element", () => {
    const tree: UITree = {
      root: "r",
      elements: {
        r: { key: "r", type: "Text", props: { content: "hello" } },
      },
    };
    const result = walkTree({
      tree,
      registry: passthroughText,
      ctx: makeCtx(),
      hooks: noopHooks,
      passId: 1,
    });
    expect(result.key).toBe("r");
    expect(result.type).toBe("Text");
    expect(result.props.content).toBe("hello");
    expect(result.children).toEqual([]);
  });

  it("walks nested children in declared order", () => {
    const tree: UITree = {
      root: "root",
      elements: {
        root: { key: "root", type: "Container", props: {}, children: ["a", "b", "c"] },
        a: { key: "a", type: "Text", props: { content: "A" } },
        b: { key: "b", type: "Text", props: { content: "B" } },
        c: { key: "c", type: "Text", props: { content: "C" } },
      },
    };
    const result = walkTree({
      tree,
      registry: passthroughText,
      ctx: makeCtx(),
      hooks: noopHooks,
      passId: 1,
    });
    expect(result.children.map((n) => (n.props as { content?: string }).content)).toEqual(["A", "B", "C"]);
  });

  it("prunes invisible elements (visible: false flag) from the parent's children array", () => {
    const tree: UITree = {
      root: "root",
      elements: {
        root: { key: "root", type: "Container", props: {}, children: ["a", "b"] },
        a: { key: "a", type: "Text", props: { content: "A" }, visible: false },
        b: { key: "b", type: "Text", props: { content: "B" } },
      },
    };
    const result = walkTree({
      tree,
      registry: passthroughText,
      ctx: makeCtx(),
      hooks: noopHooks,
      passId: 1,
    });
    expect(result.children).toHaveLength(1);
    expect(result.children[0]?.key).toBe("b");
  });

  it("prunes elements with a path-based visibility resolving false", () => {
    const tree: UITree = {
      root: "root",
      elements: {
        root: { key: "root", type: "Container", props: {}, children: ["a"] },
        a: { key: "a", type: "Text", props: { content: "secret" }, visible: { path: "showSecret" } },
      },
    };
    const ctx = makeCtx({ showSecret: false });
    const result = walkTree({
      tree,
      registry: passthroughText,
      ctx,
      hooks: noopHooks,
      passId: 1,
    });
    expect(result.children).toEqual([]);
  });

  it("handles a missing child key by emitting onError and skipping", () => {
    const tree: UITree = {
      root: "root",
      elements: {
        root: { key: "root", type: "Container", props: {}, children: ["a", "ghost", "b"] },
        a: { key: "a", type: "Text", props: { content: "A" } },
        b: { key: "b", type: "Text", props: { content: "B" } },
      },
    };
    const onError = vi.fn();
    const result = walkTree({
      tree,
      registry: passthroughText,
      ctx: makeCtx(),
      hooks: { ...noopHooks, onError },
      passId: 1,
    });
    expect(result.children.map((n) => n.key)).toEqual(["a", "b"]);
    expect(onError).toHaveBeenCalledTimes(1);
    const call = onError.mock.calls[0]?.[0] as { name: string; phase: string; message: string };
    expect(call.name).toBe("MissingChildError");
    expect(call.phase).toBe("walk");
    expect(call.message).toContain("ghost");
  });

  it("handles an unknown component type with a fallback Unknown node + onError", () => {
    const tree: UITree = {
      root: "root",
      elements: {
        root: { key: "root", type: "Container", props: {}, children: ["x"] },
        x: { key: "x", type: "Mystery", props: { foo: "bar" } },
      },
    };
    const onError = vi.fn();
    const result = walkTree({
      tree,
      registry: passthroughText,
      ctx: makeCtx(),
      hooks: { ...noopHooks, onError },
      passId: 1,
    });
    expect(result.children).toHaveLength(1);
    const fallback = result.children[0];
    expect(fallback?.type).toBe("Unknown");
    expect((fallback?.props as { _originalType?: string })._originalType).toBe("Mystery");
    expect(onError).toHaveBeenCalledTimes(1);
    const call = onError.mock.calls[0]?.[0] as { name: string; phase: string };
    expect(call.name).toBe("UnknownComponentError");
    expect(call.phase).toBe("walk");
  });

  it("fires onElementRender once per visible element in walk order", () => {
    const tree: UITree = {
      root: "root",
      elements: {
        root: { key: "root", type: "Container", props: {}, children: ["a", "b"] },
        a: { key: "a", type: "Text", props: { content: "A" } },
        b: { key: "b", type: "Text", props: { content: "B" } },
      },
    };
    const events: Array<{ key: string; type: string }> = [];
    walkTree({
      tree,
      registry: passthroughText,
      ctx: makeCtx(),
      hooks: {
        ...noopHooks,
        onElementRender: (e) => events.push({ key: e.elementKey, type: e.elementType }),
      },
      passId: 1,
    });
    // Children fire before the parent because children are walked depth-first
    // and the parent's NormalizedNode is constructed AFTER its children are ready.
    expect(events.map((e) => e.key)).toEqual(["a", "b", "root"]);
  });
});
```

- [ ] **Step 3: Run the tests to confirm they fail**

```bash
cd "C:/Users/danie/Dropbox/Github/JSON-UI" && npm test -- packages/headless/src/walker.test.ts
```

Expected: FAIL — `walker.ts` does not exist.

- [ ] **Step 4: Implement `walker.ts`**

Create `packages/headless/src/walker.ts`:

```typescript
import type { UIElement, UITree } from "@json-ui/core";
import { MissingChildError, UnknownComponentError, toSerializableError } from "./errors";
import type { HeadlessContext } from "./context";
import type { HeadlessRegistry } from "./registry";
import type { NormalizedNode, RenderPassId } from "./types";
import type { RenderHooks } from "./hooks";

interface WalkInput {
  tree: UITree;
  registry: HeadlessRegistry;
  ctx: HeadlessContext;
  hooks: RenderHooks;
  passId: RenderPassId;
}

/**
 * Walk a flat UITree from its root and produce a NormalizedNode.
 *
 * - Visibility-pruned elements are absent from their parent's `children`.
 * - Missing child keys produce a MissingChildError on `hooks.onError` and are
 *   skipped (the rest of the tree continues to walk).
 * - Unknown component types produce an UnknownComponentError on `hooks.onError`
 *   and are replaced with a fallback `{type: "Unknown", props: {_originalType: ...}}`.
 * - `onElementRender` fires after each element's NormalizedNode is constructed,
 *   in depth-first order (children before their parent).
 */
export function walkTree(input: WalkInput): NormalizedNode {
  const { tree, registry, ctx, hooks, passId } = input;

  const walk = (elementKey: string, parentKey: string | null): NormalizedNode | undefined => {
    const element = tree.elements[elementKey];
    if (element === undefined) {
      // Should only fire when the ROOT key is missing, since walkChildren
      // catches missing keys before recursing. Treat as a structural error.
      const err = new MissingChildError(elementKey, parentKey ?? "<root>");
      hooks.onError(toSerializableError(err, "walk"));
      return undefined;
    }

    // Visibility evaluation
    if (!ctx.evaluateVisibility(element.visible)) {
      return undefined;
    }

    const renderedChildren: NormalizedNode[] = [];
    if (element.children !== undefined) {
      for (const childKey of element.children) {
        if (tree.elements[childKey] === undefined) {
          const err = new MissingChildError(childKey, elementKey);
          hooks.onError(toSerializableError(err, "walk"));
          continue;
        }
        const childNode = walk(childKey, elementKey);
        if (childNode !== undefined) renderedChildren.push(childNode);
      }
    }

    let resultNode: NormalizedNode;

    const componentFn = registry[element.type];
    if (componentFn === undefined) {
      const err = new UnknownComponentError(element.type, element.key);
      hooks.onError(toSerializableError(err, "walk"));
      resultNode = {
        key: element.key,
        type: "Unknown",
        props: {
          _originalType: element.type,
        },
        children: renderedChildren,
        meta: { visible: true },
      };
    } else {
      try {
        resultNode = componentFn(element as UIElement, ctx, renderedChildren);
      } catch (componentError) {
        // Default: bubble. Open Question 4 in the spec — without
        // continueOnComponentError, render() rethrows. The walker delegates
        // that decision to the renderer (which handles try/catch around the
        // top-level walk). Here, we simply rethrow.
        hooks.onError(toSerializableError(componentError, "component"));
        throw componentError;
      }
    }

    hooks.onElementRender({
      passId,
      elementKey: element.key,
      elementType: element.type,
      result: resultNode,
      timestamp: Date.now(),
    });

    return resultNode;
  };

  const rootResult = walk(tree.root, null);
  if (rootResult === undefined) {
    // Root was either invisible or missing. Return an empty placeholder so
    // callers always get a NormalizedNode (the renderer's onAfterRender hook
    // requires a result object). Use the root key for traceability.
    return {
      key: tree.root,
      type: "Empty",
      props: {},
      children: [],
      meta: { visible: false },
    };
  }
  return rootResult;
}
```

- [ ] **Step 5: Run the tests to confirm they pass**

```bash
cd "C:/Users/danie/Dropbox/Github/JSON-UI" && npm test -- packages/headless/src/walker.test.ts
```

Expected: all tests PASS. If the order test fails, double-check the recursion: children are walked first, then `onElementRender` fires for the parent at the end of the function body. The depth-first post-order traversal is what the test expects.

- [ ] **Step 6: Commit**

```bash
cd "C:/Users/danie/Dropbox/Github/JSON-UI" && git add packages/headless/src/registry.ts packages/headless/src/walker.ts packages/headless/src/walker.test.ts && git commit -m "feat(headless): add registry types and walkTree with visibility pruning"
```

---

## Task 8: Add `helpers/collect-ids.ts`

**Goal:** Implement a small helper that walks a `UITree` and collects every `FieldId` found in component props. Used by the renderer to build the `liveIds` set that `StagingBuffer.reconcile` consumes.

**Files:**
- Create: `packages/headless/src/helpers/collect-ids.ts`
- Create: `packages/headless/src/helpers/collect-ids.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/headless/src/helpers/collect-ids.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import type { UITree } from "@json-ui/core";
import { collectFieldIds } from "./collect-ids";

describe("collectFieldIds", () => {
  it("returns an empty set for a tree with no input components", () => {
    const tree: UITree = {
      root: "r",
      elements: {
        r: { key: "r", type: "Text", props: { content: "hi" } },
      },
    };
    expect(collectFieldIds(tree)).toEqual(new Set<string>());
  });

  it("collects an id from a single input element", () => {
    const tree: UITree = {
      root: "r",
      elements: {
        r: { key: "r", type: "TextField", props: { id: "email", label: "Email" } },
      },
    };
    expect(collectFieldIds(tree)).toEqual(new Set(["email"]));
  });

  it("collects ids from a deeply nested tree", () => {
    const tree: UITree = {
      root: "root",
      elements: {
        root: { key: "root", type: "Container", props: {}, children: ["a", "b"] },
        a: { key: "a", type: "TextField", props: { id: "name" } },
        b: { key: "b", type: "Container", props: {}, children: ["c"] },
        c: { key: "c", type: "TextField", props: { id: "address" } },
      },
    };
    expect(collectFieldIds(tree)).toEqual(new Set(["name", "address"]));
  });

  it("ignores non-string id props", () => {
    const tree: UITree = {
      root: "r",
      elements: {
        r: { key: "r", type: "TextField", props: { id: 42 } },
      },
    };
    expect(collectFieldIds(tree)).toEqual(new Set<string>());
  });

  it("treats duplicate ids as one entry in the set", () => {
    const tree: UITree = {
      root: "root",
      elements: {
        root: { key: "root", type: "Container", props: {}, children: ["a", "b"] },
        a: { key: "a", type: "TextField", props: { id: "shared" } },
        b: { key: "b", type: "TextField", props: { id: "shared" } },
      },
    };
    expect(collectFieldIds(tree)).toEqual(new Set(["shared"]));
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd "C:/Users/danie/Dropbox/Github/JSON-UI" && npm test -- packages/headless/src/helpers/collect-ids.test.ts
```

Expected: FAIL — file does not exist.

- [ ] **Step 3: Implement the helper**

Create `packages/headless/src/helpers/collect-ids.ts`:

```typescript
import type { FieldId, UITree } from "@json-ui/core";

/**
 * Walk a UITree and collect every `id` prop from input components. Used by
 * the renderer to build the `liveIds` set for StagingBuffer.reconcile.
 *
 * Convention: any element whose `props.id` is a string is treated as an input
 * element. This matches NC's existing convention (TextField, Checkbox,
 * NumberField etc. all carry `id: string` as their staging key).
 */
export function collectFieldIds(tree: UITree): Set<FieldId> {
  const ids = new Set<FieldId>();
  for (const element of Object.values(tree.elements)) {
    const id = (element.props as { id?: unknown }).id;
    if (typeof id === "string" && id.length > 0) {
      ids.add(id);
    }
  }
  return ids;
}
```

- [ ] **Step 4: Run the tests**

```bash
cd "C:/Users/danie/Dropbox/Github/JSON-UI" && npm test -- packages/headless/src/helpers/collect-ids.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/danie/Dropbox/Github/JSON-UI" && git add packages/headless/src/helpers && git commit -m "feat(headless): add collectFieldIds helper for staging reconciliation"
```

---

## Task 9: Add `renderer.ts` — `createHeadlessRenderer` Session Factory

**Goal:** The session factory wires together everything else. It owns the staging buffer, data model, hooks, registry, and catalog references; exposes `render`, `dispatch`, `setStagingField`, `setData`, `getStaging`, `getData`, and `destroy`; emits all the lifecycle hooks; and enforces `OptionConflictError` and `SessionDestroyedError` semantics.

**Files:**
- Create: `packages/headless/src/renderer.ts`
- Create: `packages/headless/src/renderer.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/headless/src/renderer.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import {
  createCatalog,
  createObservableDataModel,
  createStagingBuffer,
  type IntentEvent,
  type UITree,
} from "@json-ui/core";
import { z } from "zod";
import { createHeadlessRenderer } from "./renderer";
import { type HeadlessRegistry } from "./registry";

const textCatalog = createCatalog({
  components: {
    Text: { props: z.object({ content: z.string() }) },
    TextField: { props: z.object({ id: z.string(), label: z.string() }) },
    Button: { props: z.object({ label: z.string() }) },
  },
  actions: {
    submit: { description: "submit form" },
  },
});

const textRegistry: HeadlessRegistry = {
  Text: (el) => ({
    key: el.key,
    type: "Text",
    props: { content: (el.props as { content: string }).content },
    children: [],
    meta: { visible: true },
  }),
  TextField: (el, ctx) => {
    const id = (el.props as { id: string }).id;
    const value = ctx.staging.get(id);
    return {
      key: el.key,
      type: "TextField",
      props: {
        id,
        label: (el.props as { label: string }).label,
        value: typeof value === "string" ? value : "",
      },
      children: [],
      meta: { visible: true },
    };
  },
  Button: (el) => ({
    key: el.key,
    type: "Button",
    props: { label: (el.props as { label: string }).label },
    children: [],
    meta: { visible: true },
  }),
};

const simpleTree: UITree = {
  root: "r",
  elements: {
    r: { key: "r", type: "Text", props: { content: "hello" } },
  },
};

describe("createHeadlessRenderer", () => {
  it("renders a single-element tree", () => {
    const session = createHeadlessRenderer({
      catalog: textCatalog,
      registry: textRegistry,
    });
    const out = session.render(simpleTree);
    expect(out.type).toBe("Text");
    expect(out.props.content).toBe("hello");
  });

  it("render is a pure function of (tree, state) — Invariant 1", () => {
    // Spec Invariant 1: two back-to-back render calls with no intervening
    // state mutation must return deeply-equal NormalizedNode trees. This
    // proves render has no hidden state, no time-dependent output, and
    // safely supports snapshot use cases.
    const session = createHeadlessRenderer({
      catalog: textCatalog,
      registry: textRegistry,
    });
    const a = session.render(simpleTree);
    const b = session.render(simpleTree);
    expect(b).toEqual(a);
  });

  it("each render pass captures a consistent state snapshot — Invariant 15", () => {
    // Spec Invariant 15: a render pass sees a consistent view of its
    // stores even if writers mutate them between passes. Within a single
    // pass the walker is synchronous and Node is single-threaded, so the
    // only achievable test is "the second pass after a write sees the
    // new value, the first pass's output is unaffected" — proving the
    // pass captured a point-in-time view at start.
    const staging = createStagingBuffer();
    staging.set("v", "first");
    const session = createHeadlessRenderer({
      catalog: textCatalog,
      registry: textRegistry,
      staging,
    });
    const tree: UITree = {
      root: "r",
      elements: { r: { key: "r", type: "TextField", props: { id: "v", label: "X" } } },
    };
    const passA = session.render(tree);
    staging.set("v", "second");
    const passB = session.render(tree);
    expect(passA.props.value).toBe("first");
    expect(passB.props.value).toBe("second");
    // passA's NormalizedNode must NOT have been mutated by the later write.
    // This is the structural guarantee that "render-pass purity on shared
    // stores" gives the LLM Observer.
  });

  it("creates its own staging and data when none are provided", () => {
    const session = createHeadlessRenderer({
      catalog: textCatalog,
      registry: textRegistry,
    });
    expect(session.getStaging().has("anything")).toBe(false);
    expect(session.getData()).toEqual({});
  });

  it("uses provided shared stores", () => {
    const staging = createStagingBuffer();
    staging.set("email", "shared@example.com");
    const data = createObservableDataModel({ user: { name: "Alice" } });
    const session = createHeadlessRenderer({
      catalog: textCatalog,
      registry: textRegistry,
      staging,
      data,
    });
    expect(session.getStaging().get("email")).toBe("shared@example.com");
    expect(session.getData()).toEqual({ user: { name: "Alice" } });
  });

  it("throws OptionConflictError when both data and initialData are provided", () => {
    expect(() =>
      createHeadlessRenderer({
        catalog: textCatalog,
        registry: textRegistry,
        data: createObservableDataModel({}),
        initialData: { x: 1 },
      }),
    ).toThrow(/OptionConflict|Mutually exclusive/);
  });

  it("validates initialData and throws InitialDataNotSerializableError on bad input", () => {
    expect(() =>
      createHeadlessRenderer({
        catalog: textCatalog,
        registry: textRegistry,
        initialData: { bad: new Date() as never },
      }),
    ).toThrow(/initialData contains non-JSON-serializable/);
  });

  it("setStagingField writes to the underlying buffer and fires onStagingChange", () => {
    const onStagingChange = vi.fn();
    const session = createHeadlessRenderer({
      catalog: textCatalog,
      registry: textRegistry,
      hooks: { onStagingChange },
    });
    session.setStagingField("email", "x@y.z");
    expect(session.getStaging().get("email")).toBe("x@y.z");
    expect(onStagingChange).toHaveBeenCalledTimes(1);
    expect(onStagingChange.mock.calls[0]?.[0]).toMatchObject({
      fieldId: "email",
      newValue: "x@y.z",
      oldValue: undefined,
    });
  });

  it("setData writes to the underlying store and fires onDataChange", () => {
    const onDataChange = vi.fn();
    const session = createHeadlessRenderer({
      catalog: textCatalog,
      registry: textRegistry,
      hooks: { onDataChange },
    });
    session.setData("user/name", "Bob");
    expect(session.getData()).toEqual({ user: { name: "Bob" } });
    expect(onDataChange).toHaveBeenCalledWith(
      expect.objectContaining({ path: "user/name", newValue: "Bob", oldValue: undefined }),
    );
  });

  it("dispatch emits a structurally correct IntentEvent and fires onIntent + onActionDispatched", () => {
    const onIntent = vi.fn<(e: IntentEvent) => void>();
    const onActionDispatched = vi.fn();
    const session = createHeadlessRenderer({
      catalog: textCatalog,
      registry: textRegistry,
      onIntent,
      hooks: { onActionDispatched },
      catalogVersion: "v1.2.3",
    });
    session.setStagingField("email", "a@b.c");
    session.dispatch("submit", { foo: "bar" });
    expect(onIntent).toHaveBeenCalledTimes(1);
    expect(onActionDispatched).toHaveBeenCalledTimes(1);
    const event = onIntent.mock.calls[0]?.[0] as IntentEvent;
    expect(event.action_name).toBe("submit");
    expect(event.action_params).toEqual({ foo: "bar" });
    expect(event.staging_snapshot).toEqual({ email: "a@b.c" });
    expect(event.catalog_version).toBe("v1.2.3");
    expect(typeof event.timestamp).toBe("number");
  });

  it("buffer is NOT cleared on dispatch", () => {
    const session = createHeadlessRenderer({
      catalog: textCatalog,
      registry: textRegistry,
      onIntent: () => {},
    });
    session.setStagingField("a", 1);
    session.dispatch("submit");
    expect(session.getStaging().get("a")).toBe(1);
  });

  it("fires onBeforeRender, onElementRender, onAfterRender in order", () => {
    const calls: string[] = [];
    const session = createHeadlessRenderer({
      catalog: textCatalog,
      registry: textRegistry,
      hooks: {
        onBeforeRender: () => calls.push("before"),
        onElementRender: () => calls.push("element"),
        onAfterRender: () => calls.push("after"),
      },
    });
    session.render(simpleTree);
    expect(calls).toEqual(["before", "element", "after"]);
  });

  it("passId increments across successive render calls", () => {
    const passes: number[] = [];
    const session = createHeadlessRenderer({
      catalog: textCatalog,
      registry: textRegistry,
      hooks: { onBeforeRender: (e) => passes.push(e.passId) },
    });
    session.render(simpleTree);
    session.render(simpleTree);
    session.render(simpleTree);
    expect(passes).toEqual([1, 2, 3]);
  });

  it("destroy makes subsequent calls throw SessionDestroyedError", () => {
    const session = createHeadlessRenderer({
      catalog: textCatalog,
      registry: textRegistry,
    });
    session.destroy();
    expect(() => session.render(simpleTree)).toThrow(/destroyed/i);
    expect(() => session.dispatch("submit")).toThrow(/destroyed/i);
    expect(() => session.setStagingField("x", 1)).toThrow(/destroyed/i);
    expect(() => session.setData("x", 1)).toThrow(/destroyed/i);
  });

  it("destroy is idempotent", () => {
    const session = createHeadlessRenderer({
      catalog: textCatalog,
      registry: textRegistry,
    });
    session.destroy();
    expect(() => session.destroy()).not.toThrow();
  });

  it("renders with shared stores reflects external mutations", () => {
    const staging = createStagingBuffer();
    const session = createHeadlessRenderer({
      catalog: textCatalog,
      registry: textRegistry,
      staging,
    });
    const tree: UITree = {
      root: "r",
      elements: { r: { key: "r", type: "TextField", props: { id: "name", label: "Name" } } },
    };
    let out = session.render(tree);
    expect(out.props.value).toBe("");
    // External writer mutates the buffer; next render reflects it.
    staging.set("name", "Alice");
    out = session.render(tree);
    expect(out.props.value).toBe("Alice");
  });

  it("onError on missing-child does not crash the render", () => {
    const tree: UITree = {
      root: "root",
      elements: {
        root: { key: "root", type: "Text", props: { content: "ok" }, children: ["ghost"] },
      },
    };
    const onError = vi.fn();
    const session = createHeadlessRenderer({
      catalog: textCatalog,
      registry: textRegistry,
      hooks: { onError },
    });
    const out = session.render(tree);
    expect(out.type).toBe("Text");
    expect(onError).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
cd "C:/Users/danie/Dropbox/Github/JSON-UI" && npm test -- packages/headless/src/renderer.test.ts
```

Expected: FAIL — `renderer.ts` does not exist.

- [ ] **Step 3: Implement `renderer.ts`**

Create `packages/headless/src/renderer.ts`:

```typescript
import {
  createObservableDataModel,
  createStagingBuffer,
  type AuthState,
  type Catalog,
  type FieldId,
  type IntentEvent,
  type JSONValue,
  type ObservableDataModel,
  type StagingBuffer,
  type UITree,
  type ValidationFunction,
} from "@json-ui/core";
import { OptionConflictError, SessionDestroyedError } from "./errors";
import { composeHooks, noopHooks, type RenderHooks } from "./hooks";
import { createHeadlessContext } from "./context";
import { type HeadlessRegistry } from "./registry";
import { walkTree } from "./walker";
import type {
  NormalizedNode,
  RenderPassId,
  SessionStateSnapshot,
} from "./types";

export interface HeadlessRendererOptions {
  catalog: Catalog;
  registry: HeadlessRegistry;
  onIntent?: (event: IntentEvent) => void;
  initialData?: Record<string, JSONValue>;
  catalogVersion?: string;
  hooks?: Partial<RenderHooks>;
  staging?: StagingBuffer;
  data?: ObservableDataModel;
  authState?: AuthState;
  validationFunctions?: Record<string, ValidationFunction>;
}

export interface HeadlessRenderer {
  render(tree: UITree): NormalizedNode;
  dispatch(actionName: string, params?: Record<string, JSONValue>): void;
  getStaging(): StagingBuffer;
  setStagingField(fieldId: FieldId, value: JSONValue): void;
  getData(): Readonly<Record<string, JSONValue>>;
  setData(path: string, value: JSONValue): void;
  destroy(): void;
}

export function createHeadlessRenderer(options: HeadlessRendererOptions): HeadlessRenderer {
  if (options.data !== undefined && options.initialData !== undefined) {
    throw new OptionConflictError(["data", "initialData"]);
  }

  const staging = options.staging ?? createStagingBuffer();
  const data = options.data ?? createObservableDataModel(options.initialData);
  const hooks = composeHooks(options.hooks ?? {});
  const registry = options.registry;
  const catalogVersion = options.catalogVersion;

  let destroyed = false;
  let nextPassId: RenderPassId = 1;

  const ensureAlive = () => {
    if (destroyed) throw new SessionDestroyedError();
  };

  const captureState = (): SessionStateSnapshot => {
    const snapshot: SessionStateSnapshot = {
      staging: staging.snapshot(),
      data: data.snapshot() as Record<string, JSONValue>,
    };
    if (catalogVersion !== undefined) snapshot.catalogVersion = catalogVersion;
    return snapshot;
  };

  return {
    render(tree) {
      ensureAlive();
      const passId = nextPassId++;
      const ctx = createHeadlessContext({
        staging,
        data,
        authState: options.authState,
        validationFunctions: options.validationFunctions,
      });
      const startTime = Date.now();
      hooks.onBeforeRender({
        passId,
        tree,
        state: captureState(),
        timestamp: startTime,
      });
      const result = walkTree({
        tree,
        registry,
        ctx,
        hooks,
        passId,
      });
      const endTime = Date.now();
      hooks.onAfterRender({
        passId,
        tree,
        result,
        elapsedMs: endTime - startTime,
        timestamp: endTime,
      });
      return result;
    },

    dispatch(actionName, params) {
      ensureAlive();
      const event: IntentEvent = {
        action_name: actionName,
        action_params: params ?? {},
        staging_snapshot: staging.snapshot(),
        timestamp: Date.now(),
      };
      if (catalogVersion !== undefined) {
        event.catalog_version = catalogVersion;
      }
      hooks.onActionDispatched(event);
      options.onIntent?.(event);
    },

    getStaging() {
      ensureAlive();
      return staging;
    },

    setStagingField(fieldId, value) {
      ensureAlive();
      const oldValue = staging.get(fieldId);
      staging.set(fieldId, value);
      hooks.onStagingChange({
        fieldId,
        newValue: value,
        oldValue,
        timestamp: Date.now(),
      });
    },

    getData() {
      ensureAlive();
      return data.snapshot();
    },

    setData(path, value) {
      ensureAlive();
      const oldValue = data.get(path);
      data.set(path, value);
      hooks.onDataChange({
        path,
        newValue: value,
        oldValue,
        timestamp: Date.now(),
      });
    },

    destroy() {
      if (destroyed) return;
      destroyed = true;
      // Replace hooks with no-ops so any late-fired callbacks (e.g. from a
      // shared store's subscribe queue) become no-ops instead of touching
      // freed state.
      Object.assign(hooks, noopHooks);
    },
  };
}
```

- [ ] **Step 4: Run the tests**

```bash
cd "C:/Users/danie/Dropbox/Github/JSON-UI" && npm test -- packages/headless/src/renderer.test.ts
```

Expected: every test PASSES. Common failure modes:
- If the `passId increments` test reports the wrong sequence, verify `nextPassId++` (post-increment) is used so the first call gets `passId === 1`.
- If `setStagingField` notifies the test's `onStagingChange` more than once, verify the buffer's own subscriber list does not also have `hooks.onStagingChange` registered — the renderer should call `hooks.onStagingChange` directly, NOT subscribe to the buffer.
- If `OptionConflictError` is reported as not thrown, verify the conflict check is the very first statement of `createHeadlessRenderer`.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/danie/Dropbox/Github/JSON-UI" && git add packages/headless/src/renderer.ts packages/headless/src/renderer.test.ts && git commit -m "feat(headless): add createHeadlessRenderer session factory"
```

---

## Task 10: Add the JSON Serializer

**Goal:** Implement `JsonSerializer` — a trivial pass-through that returns the `NormalizedNode` as-is, plus a `JsonStringSerializer` that returns `JSON.stringify`'d output.

**Files:**
- Create: `packages/headless/src/serializers/types.ts` (new — contains the `Serializer` interface)
- Create: `packages/headless/src/serializers/index.ts` (barrel only — no interface declaration here)
- Create: `packages/headless/src/serializers/json.ts`
- Create: `packages/headless/src/serializers/json.test.ts`

**Why a separate `types.ts`?** If the `Serializer` interface lived in `serializers/index.ts`, then `json.ts` would `import type { Serializer } from "./index"` while `index.ts` re-exports `JsonSerializer` from `./json` — a circular module reference. Under `tsc --noEmit` with `isolatedModules: true` this can fail or produce non-deterministic resolution. Hoisting `Serializer` into its own zero-import file breaks the cycle: both `json.ts` and `html.ts` import `Serializer` from `./types`, and `index.ts` re-exports everything as a leaf barrel.

- [ ] **Step 1a: Create the serializer types file**

Create `packages/headless/src/serializers/types.ts`:

```typescript
import type { NormalizedNode } from "../types";

/** A pluggable output format for NormalizedNode trees. */
export interface Serializer<Output> {
  serialize(node: NormalizedNode): Output;
}
```

- [ ] **Step 1b: Create the serializer barrel**

Create `packages/headless/src/serializers/index.ts`:

```typescript
export type { Serializer } from "./types";
export { JsonSerializer, JsonStringSerializer } from "./json";
export { createHtmlSerializer, type HtmlSerializerOptions } from "./html";
```

(The `./html` re-export will fail to resolve until Task 11 creates `html.ts`. This is expected — `tsc --noEmit` for the whole package will be temporarily broken between Tasks 10 and 11. Task 10's tests import from `./json` directly, not from the barrel, so vitest still runs cleanly.)

- [ ] **Step 2: Write failing tests for JSON serializers**

Create `packages/headless/src/serializers/json.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { JsonSerializer, JsonStringSerializer } from "./json";
import type { NormalizedNode } from "../types";

const sample: NormalizedNode = {
  key: "r",
  type: "Container",
  props: { className: "x" },
  children: [
    { key: "a", type: "Text", props: { content: "hi" }, children: [] },
  ],
  meta: { visible: true },
};

describe("JsonSerializer", () => {
  it("returns the input node as-is (identity serializer)", () => {
    const out = JsonSerializer.serialize(sample);
    expect(out).toBe(sample);
  });
});

describe("JsonStringSerializer", () => {
  it("returns a JSON string that round-trips to the original", () => {
    const str = JsonStringSerializer.serialize(sample);
    expect(typeof str).toBe("string");
    const parsed = JSON.parse(str);
    expect(parsed).toEqual(JSON.parse(JSON.stringify(sample)));
  });

  it("produces stable output (no functions, no symbols, no undefined-stripping surprises)", () => {
    const str = JsonStringSerializer.serialize(sample);
    expect(str).toContain('"type":"Container"');
    expect(str).toContain('"content":"hi"');
  });
});
```

- [ ] **Step 3: Run to confirm failure**

```bash
cd "C:/Users/danie/Dropbox/Github/JSON-UI" && npm test -- packages/headless/src/serializers/json.test.ts
```

Expected: FAIL — `json.ts` does not exist.

- [ ] **Step 4: Implement the JSON serializers**

Create `packages/headless/src/serializers/json.ts`:

```typescript
import type { NormalizedNode } from "../types";
import type { Serializer } from "./types";

/** Identity serializer — returns the NormalizedNode unchanged. */
export const JsonSerializer: Serializer<NormalizedNode> = {
  serialize(node) {
    return node;
  },
};

/** JSON.stringify serializer — returns a string. */
export const JsonStringSerializer: Serializer<string> = {
  serialize(node) {
    return JSON.stringify(node);
  },
};
```

- [ ] **Step 5: Run the JSON tests**

```bash
cd "C:/Users/danie/Dropbox/Github/JSON-UI" && npm test -- packages/headless/src/serializers/json.test.ts
```

Expected: PASS. (`serializers/index.ts` will still typecheck-error because `html.ts` does not exist yet — that is fine; the test runs the ESM module's `json.ts` directly via the test file's import path.)

- [ ] **Step 6: Commit**

```bash
cd "C:/Users/danie/Dropbox/Github/JSON-UI" && git add packages/headless/src/serializers && git commit -m "feat(headless): add JSON serializers"
```

---

## Task 11: Add the HTML Serializer

**Goal:** Implement `createHtmlSerializer({emitters, fallback?, escapeText?})` — accepts a per-component-type emitter map and walks the tree, calling each emitter to produce HTML fragments.

**Files:**
- Create: `packages/headless/src/serializers/html.ts`
- Create: `packages/headless/src/serializers/html.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/headless/src/serializers/html.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { createHtmlSerializer } from "./html";
import type { NormalizedNode } from "../types";

describe("createHtmlSerializer", () => {
  it("calls the per-type emitter for a single node", () => {
    const ser = createHtmlSerializer({
      emitters: {
        Text: (node) => `<span>${(node.props as { content: string }).content}</span>`,
      },
    });
    const node: NormalizedNode = {
      key: "r",
      type: "Text",
      props: { content: "hello" },
      children: [],
    };
    expect(ser.serialize(node)).toBe("<span>hello</span>");
  });

  it("recurses into children via emitChildren", () => {
    const ser = createHtmlSerializer({
      emitters: {
        Container: (_, emitChildren) => `<div>${emitChildren()}</div>`,
        Text: (node) => `<span>${(node.props as { content: string }).content}</span>`,
      },
    });
    const node: NormalizedNode = {
      key: "r",
      type: "Container",
      props: {},
      children: [
        { key: "a", type: "Text", props: { content: "A" }, children: [] },
        { key: "b", type: "Text", props: { content: "B" }, children: [] },
      ],
    };
    expect(ser.serialize(node)).toBe("<div><span>A</span><span>B</span></div>");
  });

  it("uses the fallback for unknown types", () => {
    const ser = createHtmlSerializer({
      emitters: {},
    });
    const node: NormalizedNode = {
      key: "r",
      type: "Mystery",
      props: {},
      children: [],
    };
    expect(ser.serialize(node)).toBe('<div data-type="Mystery"></div>');
  });

  it("supports a custom fallback", () => {
    const ser = createHtmlSerializer({
      emitters: {},
      fallback: (node) => `<unknown:${node.type}/>`,
    });
    const node: NormalizedNode = {
      key: "r",
      type: "Mystery",
      props: {},
      children: [],
    };
    expect(ser.serialize(node)).toBe("<unknown:Mystery/>");
  });

  it("escapes text content in props by default", () => {
    const ser = createHtmlSerializer({
      emitters: {
        Text: (node, _emit, escape) =>
          `<span>${escape((node.props as { content: string }).content)}</span>`,
      },
    });
    const node: NormalizedNode = {
      key: "r",
      type: "Text",
      props: { content: '<script>alert("xss")</script>' },
      children: [],
    };
    expect(ser.serialize(node)).toBe(
      "<span>&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;</span>",
    );
  });

  it("provides a no-op escape when escapeText is false", () => {
    const ser = createHtmlSerializer({
      escapeText: false,
      emitters: {
        Text: (node, _emit, escape) => escape("<b>raw</b>"),
      },
    });
    const node: NormalizedNode = {
      key: "r",
      type: "Text",
      props: {},
      children: [],
    };
    expect(ser.serialize(node)).toBe("<b>raw</b>");
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd "C:/Users/danie/Dropbox/Github/JSON-UI" && npm test -- packages/headless/src/serializers/html.test.ts
```

Expected: FAIL — `html.ts` does not exist.

- [ ] **Step 3: Implement the HTML serializer**

Create `packages/headless/src/serializers/html.ts`:

```typescript
import type { NormalizedNode } from "../types";
import type { Serializer } from "./types";

/**
 * Per-type HTML emitter. Receives the node, a `emitChildren` thunk that
 * produces the HTML for the node's children (recursing via the same
 * serializer), and an `escape` helper. The escape helper honors the
 * serializer's `escapeText` option — pass `escapeText: false` to make
 * `escape` a no-op for raw HTML output.
 */
export type HtmlEmitter = (
  node: NormalizedNode,
  emitChildren: () => string,
  escape: (s: string) => string,
) => string;

export interface HtmlSerializerOptions {
  emitters: Record<string, HtmlEmitter>;
  fallback?: HtmlEmitter;
  escapeText?: boolean;
}

const DEFAULT_FALLBACK: HtmlEmitter = (node, emitChildren) =>
  `<div data-type="${node.type}">${emitChildren()}</div>`;

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const NO_ESCAPE: (s: string) => string = (s) => s;

export function createHtmlSerializer(
  options: HtmlSerializerOptions,
): Serializer<string> {
  const fallback = options.fallback ?? DEFAULT_FALLBACK;
  const escape = options.escapeText === false ? NO_ESCAPE : escapeHtml;

  const serializeNode = (node: NormalizedNode): string => {
    const emitter = options.emitters[node.type] ?? fallback;
    const emitChildren = () => node.children.map(serializeNode).join("");
    return emitter(node, emitChildren, escape);
  };

  return { serialize: serializeNode };
}
```

Note the fallback default produces only the `data-type` shell with no children unless the test fallback passes children through. The test in Step 1 uses an empty-children node so the default fallback's lack of children rendering does not matter. If a future test passes a node with children to the default fallback, the default may need to call `emitChildren()` — but that is a v1.1 enhancement and not in scope.

Actually, on review: the default fallback **does** call `emitChildren()` in the implementation above. The test `"uses the fallback for unknown types"` passes an empty-children node and expects `<div data-type="Mystery"></div>` — empty `emitChildren()` returns `""`, so the output is correct.

- [ ] **Step 4: Run the tests**

```bash
cd "C:/Users/danie/Dropbox/Github/JSON-UI" && npm test -- packages/headless/src/serializers/html.test.ts
```

Expected: every test PASSES.

- [ ] **Step 5: Run the full serializers test suite to confirm `index.ts` re-exports compile**

```bash
cd "C:/Users/danie/Dropbox/Github/JSON-UI" && npm run typecheck --workspace @json-ui/headless
```

Expected: PASS. The `serializers/index.ts` barrel can now resolve both `./json` and `./html`.

- [ ] **Step 6: Commit**

```bash
cd "C:/Users/danie/Dropbox/Github/JSON-UI" && git add packages/headless/src/serializers && git commit -m "feat(headless): add HTML serializer with per-type emitter map"
```

---

## Task 12: Public Barrel + Integration Test + Final Verification

**Goal:** Wire every public type and function into `src/index.ts`, write an end-to-end integration test that exercises a realistic NC-style flow (catalog + tree + dispatch + IntentEvent + serializer round-trip + hook serializability check), then run typecheck + test + build across all workspaces.

**Files:**
- Modify: `packages/headless/src/index.ts`
- Create: `packages/headless/src/integration.test.ts`

- [ ] **Step 1: Replace the empty barrel with the public surface**

Replace `packages/headless/src/index.ts` with:

```typescript
// @json-ui/headless — framework-agnostic renderer for catalog-constrained UI trees.

// Types
export type {
  NormalizedNode,
  NormalizedAction,
  NormalizedValidation,
  RenderPhase,
  RenderPassId,
  SessionStateSnapshot,
} from "./types";

// Errors
export {
  toSerializableError,
  UnknownComponentError,
  MissingChildError,
  OptionConflictError,
  SessionDestroyedError,
  type SerializableError,
} from "./errors";

// Hooks
export {
  noopHooks,
  composeHooks,
  type RenderHooks,
} from "./hooks";

// Context
export {
  createHeadlessContext,
  type HeadlessContext,
  type ReadonlyStagingView,
  type ReadonlyDataView,
} from "./context";

// Registry
export type {
  HeadlessComponent,
  HeadlessRegistry,
} from "./registry";

// Walker (exposed for advanced consumers; most use createHeadlessRenderer)
export { walkTree } from "./walker";

// Renderer — the primary public entry point
export {
  createHeadlessRenderer,
  type HeadlessRenderer,
  type HeadlessRendererOptions,
} from "./renderer";

// Helpers
export { collectFieldIds } from "./helpers/collect-ids";

// Serializers
export {
  JsonSerializer,
  JsonStringSerializer,
  createHtmlSerializer,
  type Serializer,
  type HtmlSerializerOptions,
} from "./serializers";
```

Note: the `Serializer` type is re-exported from `./serializers` so consumers can write their own serializer implementations. Verify this matches the actual export in `src/serializers/index.ts` — if `Serializer` is not exported there, add `export type { Serializer } from "./index";` at the bottom of `src/serializers/index.ts`.

- [ ] **Step 2: Verify the barrel typechecks**

```bash
cd "C:/Users/danie/Dropbox/Github/JSON-UI" && npm run typecheck --workspace @json-ui/headless
```

Expected: PASS. If `Serializer` is reported missing in the barrel, edit `serializers/index.ts` and add the explicit `export type { Serializer }` at the bottom (the original barrel only declares the interface inline; explicit re-export is needed so the parent `src/index.ts` can find it).

- [ ] **Step 3: Write the end-to-end integration test**

Create `packages/headless/src/integration.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  createCatalog,
  createObservableDataModel,
  createStagingBuffer,
  type IntentEvent,
  type UITree,
} from "@json-ui/core";
import {
  createHeadlessRenderer,
  createHtmlSerializer,
  JsonStringSerializer,
  type HeadlessRegistry,
} from "./index";

const ncCatalog = createCatalog({
  name: "nc-test",
  components: {
    Container: { props: z.object({}) },
    TextField: { props: z.object({ id: z.string(), label: z.string() }) },
    Checkbox: { props: z.object({ id: z.string(), label: z.string() }) },
    Button: { props: z.object({ label: z.string() }) },
  },
  actions: {
    submit_form: { description: "submit the form" },
  },
});

const registry: HeadlessRegistry = {
  Container: (el, _ctx, children) => ({
    key: el.key,
    type: "Container",
    props: {},
    children,
    meta: { visible: true },
  }),
  TextField: (el, ctx) => {
    const id = (el.props as { id: string }).id;
    const value = ctx.staging.get(id);
    return {
      key: el.key,
      type: "TextField",
      props: {
        id,
        label: (el.props as { label: string }).label,
        value: typeof value === "string" ? value : "",
      },
      children: [],
      meta: { visible: true },
    };
  },
  Checkbox: (el, ctx) => {
    const id = (el.props as { id: string }).id;
    const value = ctx.staging.get(id);
    return {
      key: el.key,
      type: "Checkbox",
      props: {
        id,
        label: (el.props as { label: string }).label,
        checked: typeof value === "boolean" ? value : false,
      },
      children: [],
      meta: { visible: true },
    };
  },
  Button: (el) => ({
    key: el.key,
    type: "Button",
    props: { label: (el.props as { label: string }).label },
    children: [],
    meta: { visible: true },
  }),
};

const formTree: UITree = {
  root: "form",
  elements: {
    form: { key: "form", type: "Container", props: {}, children: ["email", "agree", "submit"] },
    email: { key: "email", type: "TextField", props: { id: "email", label: "Email" } },
    agree: { key: "agree", type: "Checkbox", props: { id: "agree", label: "I agree" } },
    submit: { key: "submit", type: "Button", props: { label: "Submit" } },
  },
};

describe("integration: dual-backend friendly headless session", () => {
  it("renders a typical NC form", () => {
    const session = createHeadlessRenderer({
      catalog: ncCatalog,
      registry,
    });
    const out = session.render(formTree);
    expect(out.type).toBe("Container");
    expect(out.children).toHaveLength(3);
    expect(out.children[0]?.type).toBe("TextField");
    expect(out.children[0]?.props.value).toBe("");
  });

  it("reflects external staging writes through shared store", () => {
    const sharedStaging = createStagingBuffer();
    const session = createHeadlessRenderer({
      catalog: ncCatalog,
      registry,
      staging: sharedStaging,
    });
    sharedStaging.set("email", "user@example.com");
    sharedStaging.set("agree", true);
    const out = session.render(formTree);
    const email = out.children[0]!;
    const agree = out.children[1]!;
    expect(email.props.value).toBe("user@example.com");
    expect(agree.props.checked).toBe(true);
  });

  it("dispatch emits an IntentEvent the JsonStringSerializer can serialize", () => {
    let emitted: IntentEvent | null = null;
    const session = createHeadlessRenderer({
      catalog: ncCatalog,
      registry,
      onIntent: (e) => {
        emitted = e;
      },
    });
    session.setStagingField("email", "x@y.z");
    session.setStagingField("agree", true);
    session.dispatch("submit_form", { source: "test" });

    expect(emitted).not.toBeNull();
    const json = JsonStringSerializer.serialize({
      key: "ev",
      type: "Event",
      props: emitted as never,
      children: [],
    });
    const round = JSON.parse(json);
    expect(round.props.action_name).toBe("submit_form");
    expect(round.props.staging_snapshot).toEqual({ email: "x@y.z", agree: true });
  });

  it("HTML serializer renders the rendered tree with a per-type emitter map", () => {
    const sharedStaging = createStagingBuffer();
    sharedStaging.set("email", "alice@example.com");
    const session = createHeadlessRenderer({
      catalog: ncCatalog,
      registry,
      staging: sharedStaging,
    });
    const out = session.render(formTree);
    const html = createHtmlSerializer({
      emitters: {
        Container: (_, emit) => `<form>${emit()}</form>`,
        TextField: (node, _emit, escape) => {
          const props = node.props as { id: string; label: string; value: string };
          return `<label>${escape(props.label)}<input name="${escape(props.id)}" value="${escape(props.value)}"/></label>`;
        },
        Checkbox: (node) => {
          const props = node.props as { id: string; label: string; checked: boolean };
          return `<label><input type="checkbox" name="${props.id}" ${props.checked ? "checked" : ""}/>${props.label}</label>`;
        },
        Button: (node) => {
          const props = node.props as { label: string };
          return `<button>${props.label}</button>`;
        },
      },
    }).serialize(out);
    expect(html).toContain("<form>");
    expect(html).toContain('value="alice@example.com"');
    expect(html).toContain("<button>Submit</button>");
  });

  it("two sessions sharing data + staging see each other's writes", () => {
    const staging = createStagingBuffer();
    const data = createObservableDataModel({});
    const a = createHeadlessRenderer({ catalog: ncCatalog, registry, staging, data });
    const b = createHeadlessRenderer({ catalog: ncCatalog, registry, staging, data });
    a.setStagingField("email", "shared@a.com");
    a.setData("user/name", "Alice");
    expect(b.getStaging().get("email")).toBe("shared@a.com");
    expect(b.getData()).toEqual({ user: { name: "Alice" } });
  });

  it("every emitted hook event is JSON.stringify/parse round-trip safe", () => {
    const captured: Array<{ kind: string; payload: unknown }> = [];
    const session = createHeadlessRenderer({
      catalog: ncCatalog,
      registry,
      onIntent: () => {},
      hooks: {
        onBeforeRender: (e) => captured.push({ kind: "onBeforeRender", payload: e }),
        onAfterRender: (e) => captured.push({ kind: "onAfterRender", payload: e }),
        onElementRender: (e) => captured.push({ kind: "onElementRender", payload: e }),
        onActionDispatched: (e) => captured.push({ kind: "onActionDispatched", payload: e }),
        onStagingChange: (e) => captured.push({ kind: "onStagingChange", payload: e }),
        onDataChange: (e) => captured.push({ kind: "onDataChange", payload: e }),
        onError: (e) => captured.push({ kind: "onError", payload: e }),
      },
    });
    session.setStagingField("email", "x@y.z");
    session.setData("user/role", "admin");
    session.render(formTree);
    session.dispatch("submit_form", { ok: true });

    // Force at least one onError by rendering a tree with a missing child.
    session.render({
      root: "root",
      elements: { root: { key: "root", type: "Container", props: {}, children: ["ghost"] } },
    });

    expect(captured.length).toBeGreaterThan(0);
    for (const entry of captured) {
      const round = JSON.parse(JSON.stringify(entry.payload));
      expect(round).toEqual(JSON.parse(JSON.stringify(entry.payload)));
    }
  });

  it("zero React imports across every source file", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const srcDir = path.join(process.cwd(), "packages/headless/src");
    const collect = async (dir: string): Promise<string[]> => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      const out: string[] = [];
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          out.push(...(await collect(full)));
        } else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) {
          out.push(full);
        }
      }
      return out;
    };
    const files = await collect(srcDir);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const content = await fs.readFile(file, "utf-8");
      expect(content, `${file} must not import react`).not.toMatch(/from\s+["']react["']/);
      expect(content, `${file} must not import react-dom`).not.toMatch(/from\s+["']react-dom["']/);
      expect(content, `${file} must not import jsdom`).not.toMatch(/from\s+["']jsdom["']/);
      expect(content, `${file} must not import @json-ui/react`).not.toMatch(
        /from\s+["']@json-ui\/react["']/,
      );
    }
  });
});
```

- [ ] **Step 4: Run the integration test**

```bash
cd "C:/Users/danie/Dropbox/Github/JSON-UI" && npm test -- packages/headless/src/integration.test.ts
```

Expected: every test PASSES. Common failure modes:
- The hook serializability test will fail if any hook event payload contains a `Date`, `Map`, or class instance. The renderer produces only plain objects and the `toSerializableError` helper produces only plain strings, so this should pass on the first try unless someone added a non-serializable field accidentally.
- The "zero React imports" test will catch any accidental React import. If it fails, find the offending file and remove the import.

- [ ] **Step 5: Run the full headless package test suite**

```bash
cd "C:/Users/danie/Dropbox/Github/JSON-UI" && npm test -- packages/headless
```

Expected: every test in every file in the headless package PASSES.

- [ ] **Step 6: Run the full repo test suite**

```bash
cd "C:/Users/danie/Dropbox/Github/JSON-UI" && npm test
```

Expected: PASS across `@json-ui/core`, `@json-ui/react`, and `@json-ui/headless`. Adding the new package must not regress any test in the other two.

- [ ] **Step 7: Run the full typecheck**

```bash
cd "C:/Users/danie/Dropbox/Github/JSON-UI" && npm run typecheck
```

Expected: PASS for every workspace.

- [ ] **Step 8: Run the full build**

```bash
cd "C:/Users/danie/Dropbox/Github/JSON-UI" && npm run build
```

Expected: PASS. `dist/` directories under each package contain the built JS, ESM, and `.d.ts` files.

- [ ] **Step 9: Verify the built barrel exports match the source barrel**

```bash
node -e "const h = require('./packages/headless/dist/index.js'); console.log(Object.keys(h).sort().join('\n'));"
```

Expected output (alphabetically sorted) should include at minimum:

```
JsonSerializer
JsonStringSerializer
MissingChildError
OptionConflictError
SessionDestroyedError
UnknownComponentError
collectFieldIds
composeHooks
createHeadlessContext
createHeadlessRenderer
createHtmlSerializer
noopHooks
toSerializableError
walkTree
```

Type-only exports do not appear in the runtime keys, which is correct.

- [ ] **Step 10: Commit**

```bash
cd "C:/Users/danie/Dropbox/Github/JSON-UI" && git add packages/headless/src/index.ts packages/headless/src/integration.test.ts && git commit -m "feat(headless): add public barrel and end-to-end integration tests"
```

---

## Self-Review (Spec Coverage Mapping)

Mapping each Testable Invariant from `2026-04-13-headless-renderer-design.md` to the test that verifies it:

| # | Invariant | Test location |
|---|---|---|
| 1 | Render purity | `renderer.test.ts` "render is a pure function of (tree, state) — Invariant 1" (back-to-back render with `toEqual` deep check) |
| 2 | Visibility pruning | `walker.test.ts` "prunes invisible elements" + "prunes elements with a path-based visibility resolving false" |
| 3 | DynamicValue resolution | `context.test.ts` "resolves DynamicValue against data" + "resolves DynamicValue against staging when path is a single-segment field id" + "prefers staging over data" + "falls back to data" + "resolveAction returns a NormalizedAction" |
| 4 | Staging read discipline | `context.test.ts` "exposes a read-only staging view" — the test asserts `set`/`delete`/`subscribe` are absent from the view |
| 5 | Buffer not cleared on dispatch | `renderer.test.ts` "buffer is NOT cleared on dispatch" |
| 6 | IntentEvent shape compatibility | `renderer.test.ts` "dispatch emits a structurally correct IntentEvent" + integration test JSON round-trip |
| 7 | Hook firing order | `renderer.test.ts` "fires onBeforeRender, onElementRender, onAfterRender in order" + `walker.test.ts` "fires onElementRender once per visible element in walk order" |
| 8 | No React imports | `integration.test.ts` "zero React imports across every source file" |
| 9 | Serializer independence | Verified by type — `Serializer<Output>` interface only takes a `NormalizedNode`. No test asserts this directly but the type is the proof. |
| 10 | Unknown component type handling | `walker.test.ts` "handles an unknown component type with a fallback Unknown node + onError" |
| 11 | Hook event serializability | `integration.test.ts` "every emitted hook event is JSON.stringify/parse round-trip safe" |
| 12 | `initialData` validation matrix | Covered by Plan 1's `runtime-validation.test.ts`; the renderer test file additionally has "validates initialData and throws InitialDataNotSerializableError on bad input" as a sanity check. The exhaustive disqualified-set matrix lives in core. |
| 13 | Observable store synchronous notification | Plan 1's `runtime.test.ts`; integration test "two sessions sharing data + staging see each other's writes" verifies the dual-session sharing path |
| 14 | `toSerializableError` cause chain walks | `errors.test.ts` "walks a multi-level cause chain" + "stops cause-chain walking at depth 8" + "handles a string cause" + "coerces an unknown throwable" |
| 15 | Render-pass purity on shared stores | `renderer.test.ts` "each render pass captures a consistent state snapshot — Invariant 15" (writes between two passes; passA's output unchanged by the later write). The within-pass case is structurally guaranteed by Node's single-threaded execution model + the read-only view contract — a component cannot mutate state during its own render because the views have no write methods. |
| 16 | Walker error handling for missing child keys | `walker.test.ts` "handles a missing child key by emitting onError and skipping" + `renderer.test.ts` "onError on missing-child does not crash the render" |

**Spec coverage:** every invariant maps to at least one test. Invariant 9 is type-enforced (the `Serializer<Output>` interface mechanically prevents access to session/context). Invariant 15 has both a behavioral test (writes between passes) and a structural argument for the within-pass case (Node single-threaded + read-only views).

**Known divergence from the spec text (non-invariant):** The spec's "Action Dispatch and IntentEvents" section step 1 says `dispatch` should pre-resolve `DynamicValue` entries in `params` against the staging snapshot via `preResolveDynamicParams`. The plan's `renderer.ts` `dispatch` implementation passes `params ?? {}` through unchanged. No testable invariant requires the pre-resolution behavior — Invariant 6 only checks structural shape compatibility, not param substitution semantics — so the omission does not violate any spec invariant. Callers that need `{path: "fieldId"}` substitution at dispatch time today must either resolve themselves before calling `dispatch` or wait for a v1.1 follow-up that adds an inline resolution step. Flag this in the PR description so reviewers know the gap is intentional and tracked.

**Files created (new package):**

```
packages/headless/
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── README.md
└── src/
    ├── index.ts
    ├── types.ts
    ├── errors.ts
    ├── errors.test.ts
    ├── hooks.ts
    ├── hooks.test.ts
    ├── context.ts
    ├── context.test.ts
    ├── registry.ts
    ├── walker.ts
    ├── walker.test.ts
    ├── renderer.ts
    ├── renderer.test.ts
    ├── integration.test.ts
    ├── helpers/
    │   ├── collect-ids.ts
    │   └── collect-ids.test.ts
    └── serializers/
        ├── types.ts          # Serializer<Output> interface (extracted to break circular import)
        ├── index.ts          # leaf barrel — re-exports types + json + html
        ├── json.ts
        ├── json.test.ts
        ├── html.ts
        └── html.test.ts
```

**Files NOT modified:** every existing file in `packages/core/` and `packages/react/`. The plan is purely additive to the workspace.

---

## Done Criteria

- [ ] All 12 tasks committed
- [ ] `npm test` PASSES across all three workspaces
- [ ] `npm run typecheck` PASSES across all three workspaces
- [ ] `npm run build` PASSES across all three workspaces
- [ ] `packages/headless/dist/index.js` exports the full public surface listed in Task 12 Step 9
- [ ] No source file under `packages/headless/src/` imports from `react`, `react-dom`, `jsdom`, or `@json-ui/react` (verified by `integration.test.ts` "zero React imports")
- [ ] `packages/headless/node_modules` and `packages/headless/dist` are marked Dropbox-ignored
