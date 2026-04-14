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

export function createHeadlessContext(
  input: CreateHeadlessContextInput,
): HeadlessContext {
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
