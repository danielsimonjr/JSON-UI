import { getByPath } from "./types";
import { resolveAction } from "./actions";
import type { Action, ResolvedAction } from "./actions";
import type { DataModel } from "./types";
import type { StagingSnapshot, FieldId } from "./runtime";

/**
 * A staging-first `{path}` resolver shared by `@json-ui/headless` and the
 * NC runtime's React path.
 *
 * The rule: if the path is single-segment (no `/`) AND the staging snapshot
 * has a value for that key, return the staging value. Otherwise, walk the
 * data model via `getByPath`. Returns `undefined` for a miss; callers
 * decide how to coerce.
 *
 * Why it lives here:
 *
 * - `@json-ui/core`'s `resolveDynamicValue` only consults one source.
 * - `@json-ui/headless` previously implemented this rule inline in
 *   `context.ts`, but a React-only NC runtime that wants the same
 *   semantics would either have to import from headless or duplicate the
 *   logic. Extracting to core eliminates the duplication.
 * - NC's spec (Invariant 11) requires the pre-resolution to happen on the
 *   React path before calling `resolveAction`, because JSON-UI's own
 *   `resolveAction` only knows about `DataProvider`.
 *
 * This helper does NOT validate that the returned value is a `JSONValue`.
 * Callers that need that guarantee (e.g., the headless renderer's
 * `NormalizedAction` builder) should coerce the result.
 */
export function resolveStagingOrDataPath(
  path: string,
  staging: StagingSnapshot | ReadonlyMap<FieldId, unknown> | undefined,
  data: DataModel | undefined,
): unknown {
  // Staging is keyed by flat field IDs (no slashes). A single-segment path
  // that exists in staging wins; everything else falls through to data.
  if (!path.includes("/") && staging !== undefined) {
    if (staging instanceof Map) {
      if (staging.has(path)) return staging.get(path);
    } else if (Object.prototype.hasOwnProperty.call(staging, path)) {
      return (staging as StagingSnapshot)[path];
    }
  }
  if (data === undefined) return undefined;
  return getByPath(data, path);
}

/**
 * Recognize a `DynamicValue` literal of shape `{path: string}`. Used by
 * param walkers that need to decide between "resolve via the staging+data
 * rule" and "pass through untouched."
 */
export function isDynamicPathLiteral(
  value: unknown,
): value is { path: string } {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "path" in (value as Record<string, unknown>) &&
    typeof (value as { path: unknown }).path === "string"
  );
}

/**
 * Pre-resolve every `DynamicValue` entry in a params record against the
 * staging-first-then-data rule. Values that aren't `{path}` literals pass
 * through unchanged. Values that ARE path literals are resolved and
 * substituted in place.
 *
 * Intended as the "NC pre-resolver" step (NC design spec, Invariant 11):
 * run this on `action.params` BEFORE calling `resolveAction`, so that by
 * the time the core `resolveAction` sees the params it only has to deal
 * with literal values. Core's `resolveAction` then runs its own data-path
 * pass, which is a no-op for anything we already substituted.
 */
export function preResolveDynamicParams(
  params: Record<string, unknown> | undefined,
  staging: StagingSnapshot | ReadonlyMap<FieldId, unknown> | undefined,
  data: DataModel | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (params === undefined) return out;
  for (const [key, value] of Object.entries(params)) {
    if (isDynamicPathLiteral(value)) {
      out[key] = resolveStagingOrDataPath(value.path, staging, data);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Resolve a catalog `Action` against BOTH a staging snapshot AND a data
 * model, using the staging-first-for-single-segment rule. Returns a
 * `ResolvedAction` with the same shape as core's `resolveAction` output.
 *
 * Behavior:
 *
 * 1. Every `DynamicValue` param that looks like `{path}` resolves through
 *    `resolveStagingOrDataPath` — staging wins for single-segment paths,
 *    data wins for anything slashed.
 * 2. Literal params pass through unchanged.
 * 3. `confirm.title` and `confirm.message` are interpolated against the
 *    data model (matching core's `resolveAction` behavior).
 * 4. `confirm.variant` passes through unchanged — the previous Plan 3 bug
 *    (silently dropped) is avoided by explicit field assignment.
 * 5. `onSuccess` and `onError` pass through as-is. Neither currently
 *    supports DynamicValue substitution, and widening them is out of
 *    scope.
 *
 * The NC runtime's React path calls this helper INSTEAD of
 * `resolveAction`. The headless renderer's context consumes it too, so
 * there is exactly one implementation of the rule across the repo.
 */
export function resolveActionWithStaging(
  action: Action,
  staging: StagingSnapshot | ReadonlyMap<FieldId, unknown> | undefined,
  data: DataModel,
): ResolvedAction {
  // Walk the params once, substituting any single-segment path literals
  // from staging. Then delegate the rest (literal coercion,
  // `confirm` interpolation) to core's existing `resolveAction`, which
  // takes only a data model — the pre-resolved params it sees now are
  // either literals or slashed-path DynamicValues that it will handle.
  const preResolved = preResolveDynamicParams(action.params, staging, data);
  const actionWithResolvedStagingPaths: Action = {
    ...action,
    params: preResolved as Action["params"],
  };
  const resolved = resolveAction(actionWithResolvedStagingPaths, data);

  // Core's resolveAction interpolates confirm.title/message but copies
  // confirm.variant through its object spread. Our version does the same
  // with an explicit assignment, guarding against a future refactor that
  // drops the spread.
  if (resolved.confirm) {
    resolved.confirm = {
      title: resolved.confirm.title,
      message: resolved.confirm.message,
      ...(resolved.confirm.confirmLabel !== undefined && {
        confirmLabel: resolved.confirm.confirmLabel,
      }),
      ...(resolved.confirm.cancelLabel !== undefined && {
        cancelLabel: resolved.confirm.cancelLabel,
      }),
      ...(resolved.confirm.variant !== undefined && {
        variant: resolved.confirm.variant,
      }),
    };
  }
  return resolved;
}

