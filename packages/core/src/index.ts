// Types
export type {
  DynamicValue,
  DynamicString,
  DynamicNumber,
  DynamicBoolean,
  UIElement,
  UITree,
  VisibilityCondition,
  LogicExpression,
  AuthState,
  DataModel,
  ComponentSchema,
  ValidationMode,
  PatchOp,
  JsonPatch,
} from "./types";

export {
  DynamicValueSchema,
  DynamicStringSchema,
  DynamicNumberSchema,
  DynamicBooleanSchema,
  resolveDynamicValue,
  getByPath,
  setByPath,
} from "./types";

// Visibility
export type { VisibilityContext } from "./visibility";

export {
  VisibilityConditionSchema,
  LogicExpressionSchema,
  evaluateVisibility,
  evaluateLogicExpression,
  visibility,
} from "./visibility";

// Actions
export type {
  Action,
  ActionConfirm,
  ActionOnSuccess,
  ActionOnError,
  ActionHandler,
  ActionDefinition,
  ResolvedAction,
  ActionExecutionContext,
} from "./actions";

export {
  ActionSchema,
  ActionConfirmSchema,
  ActionOnSuccessSchema,
  ActionOnErrorSchema,
  resolveAction,
  executeAction,
  interpolateString,
  action,
} from "./actions";

// Validation
export type {
  ValidationCheck,
  ValidationConfig,
  ValidationFunction,
  ValidationFunctionDefinition,
  ValidationCheckResult,
  ValidationResult,
  ValidationContext,
} from "./validation";

export {
  ValidationCheckSchema,
  ValidationConfigSchema,
  builtInValidationFunctions,
  runValidationCheck,
  runValidation,
  check,
} from "./validation";

// Catalog
export type {
  ComponentDefinition,
  CatalogConfig,
  Catalog,
  InferCatalogComponentProps,
} from "./catalog";

export { createCatalog, generateCatalogPrompt } from "./catalog";

// Runtime types — see runtime.ts and the spec at
// docs/specs/2026-04-13-core-runtime-types-design.md
export type {
  FieldId,
  StagingSnapshot,
  JSONValue,
  StagingBuffer,
  ObservableDataModel,
  IntentEvent,
} from "./runtime";

export {
  createStagingBuffer,
  createObservableDataModel,
  validateJSONValue,
  InitialDataNotSerializableError,
} from "./runtime";

// Field-ID helpers — used by consumers that bind `StagingBuffer` to a
// rendered tree (the NC runtime, both React and headless renderer paths).
export { collectFieldIds } from "./collect-field-ids";
export {
  validateUniqueFieldIds,
  DuplicateFieldIdError,
} from "./validate-field-ids";

// Staging-aware resolution helpers — shared between `@json-ui/headless`
// and the NC runtime's React path so there is exactly one implementation
// of the "staging wins for single-segment paths, data wins otherwise"
// rule across the repo. See `docs/specs/2026-04-13-headless-renderer-design.md`
// (Invariant 3) and NC's own Invariant 11 in
// `neural-computer/docs/specs/2026-04-11-ephemeral-ui-state-design.md`.
export {
  resolveStagingOrDataPath,
  isDynamicPathLiteral,
  preResolveDynamicParams,
  resolveActionWithStaging,
} from "./resolve-with-staging";
