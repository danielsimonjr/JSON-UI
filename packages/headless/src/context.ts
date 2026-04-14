import {
  evaluateVisibility as coreEvaluateVisibility,
  runValidation as coreRunValidation,
  resolveAction as coreResolveAction,
  getByPath,
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
import type { NormalizedAction, NormalizedValidation } from "./types";

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
  runValidation(
    config: ValidationConfig,
    value: JSONValue,
  ): NormalizedValidation;
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
      // undefined/function/symbol/bigint → null. Intentional: a missing
      // staging field (undefined) collapses to null in resolved params so
      // downstream JSON serializers do not drop the key.
      return null;
  }
}

/**
 * Build a staging view bound to a FROZEN snapshot captured at construction
 * time. This is what makes render passes pure on shared stores (Invariant 15):
 * even if a hook callback writes through the live `StagingBuffer` mid-render,
 * later elements in the same pass continue reading from the pass-start
 * snapshot.
 */
function makeStagingView(buf: StagingBuffer): ReadonlyStagingView {
  const frozen: StagingSnapshot = buf.snapshot();
  return {
    get: (id) => frozen[id],
    has: (id) => Object.prototype.hasOwnProperty.call(frozen, id),
    snapshot: () => frozen,
  };
}

/**
 * Build a data view bound to a FROZEN snapshot captured at construction time.
 * See `makeStagingView` for the Invariant 15 rationale.
 */
function makeDataView(data: ObservableDataModel): ReadonlyDataView {
  const frozen = data.snapshot() as Record<string, JSONValue>;
  return {
    get: (path) => {
      const raw = getByPath(frozen, path);
      return raw === undefined ? undefined : (raw as JSONValue);
    },
    snapshot: () => frozen,
  };
}

/**
 * Resolve a `{path: string}` DynamicValue literal against a pass-start
 * snapshot pair using the staging-first-for-single-segment-ids rule that
 * the repo documents in CLAUDE.md. Returns `undefined` for a miss; callers
 * decide how to coerce.
 */
function resolveDynamicPath(
  path: string,
  staging: ReadonlyStagingView,
  data: ReadonlyDataView,
): unknown {
  // Staging is keyed by flat field IDs (no slashes). A single-segment path
  // that exists in staging wins; everything else falls through to data.
  if (!path.includes("/") && staging.has(path)) {
    return staging.get(path);
  }
  return getByPath(data.snapshot(), path);
}

function isDynamicPathLiteral(
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

export function createHeadlessContext(
  input: CreateHeadlessContextInput,
): HeadlessContext {
  const stagingView = makeStagingView(input.staging);
  const dataView = makeDataView(input.data);

  const resolveDynamic = (
    params: Record<string, unknown>,
  ): Record<string, JSONValue> => {
    const out: Record<string, JSONValue> = {};
    for (const [key, value] of Object.entries(params)) {
      if (isDynamicPathLiteral(value)) {
        out[key] = coerceToJSONValue(
          resolveDynamicPath(value.path, stagingView, dataView),
        );
        continue;
      }
      out[key] = coerceToJSONValue(value);
    }
    return out;
  };

  return {
    staging: stagingView,
    data: dataView,

    resolveDynamic,

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
      // Core's resolveAction only consults the data model, so it silently
      // drops any staging-only field IDs referenced as `{path: "email"}`.
      // We call core for the auth/confirm/name shape, then re-resolve the
      // params locally using the staging-first rule so the NormalizedAction
      // the LLM Observer sees matches what dispatch would actually send.
      const resolved = coreResolveAction(
        action,
        dataView.snapshot() as Record<string, unknown>,
      );
      const params: Record<string, JSONValue> = {};
      for (const [key, rawValue] of Object.entries(action.params ?? {})) {
        if (isDynamicPathLiteral(rawValue)) {
          params[key] = coerceToJSONValue(
            resolveDynamicPath(rawValue.path, stagingView, dataView),
          );
        } else {
          // Fall back to core's resolved value for literal/non-path entries
          // so we keep any upstream transformations (e.g., function params).
          params[key] = coerceToJSONValue(resolved.params[key]);
        }
      }
      const out: NormalizedAction = {
        name: resolved.name,
        params,
      };
      if (resolved.confirm) {
        const confirm: NormalizedAction["confirm"] = {
          title: resolved.confirm.title,
          message: resolved.confirm.message,
        };
        if (resolved.confirm.variant !== undefined) {
          confirm.variant = resolved.confirm.variant;
        }
        out.confirm = confirm;
      }
      return out;
    },
  };
}
