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
import { composeHooks, type RenderHooks } from "./hooks";
import { createHeadlessContext } from "./context";
import { type HeadlessRegistry } from "./registry";
import { walkTree } from "./walker";
import type {
  NormalizedNode,
  RenderPassId,
  SessionStateSnapshot,
} from "./types";

export interface HeadlessRendererOptions {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  catalog: Catalog<any, any, any>;
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

export function createHeadlessRenderer(
  options: HeadlessRendererOptions,
): HeadlessRenderer {
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
      // Flag-based: every public method calls ensureAlive() first, which
      // throws once destroyed === true. The hooks object itself is never
      // mutated — that was correctness-by-accident and broke if the
      // composed hooks were frozen.
      if (destroyed) return;
      destroyed = true;
    },
  };
}
