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
export { noopHooks, composeHooks, type RenderHooks } from "./hooks";

// Context
export {
  createHeadlessContext,
  type HeadlessContext,
  type ReadonlyStagingView,
  type ReadonlyDataView,
} from "./context";

// Registry
export type { HeadlessComponent, HeadlessRegistry } from "./registry";

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
