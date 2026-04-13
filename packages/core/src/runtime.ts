// Runtime types module — observable stores and shared types for the dual-backend
// architecture. See docs/specs/2026-04-13-core-runtime-types-design.md for the
// authoritative design and docs/specs/2026-04-13-headless-renderer-design.md
// for the type definitions and observable-store contracts.

/** Stable identifier for an input field within a rendered UI tree. */
export type FieldId = string;

/**
 * The subset of JavaScript values that survive a JSON.stringify / JSON.parse
 * round trip losslessly. Recursive: arrays and objects whose elements are
 * themselves JSONValue.
 */
export type JSONValue =
  | null
  | boolean
  | number
  | string
  | JSONValue[]
  | { [key: string]: JSONValue };

/** A plain-JSON snapshot of a staging buffer at a single point in time. */
export type StagingSnapshot = Record<FieldId, JSONValue>;

/**
 * Emitted when a catalog action fires — either through a headless session's
 * dispatch() or through a React backend's action handler. Structurally
 * identical across both backends so NC's orchestrator handles them uniformly.
 */
export interface IntentEvent {
  /** Name of the action from the NC catalog. */
  action_name: string;
  /** Parameters the caller passed to dispatch() or the LLM put in a Button's action. */
  action_params: Record<string, JSONValue>;
  /** Full snapshot of the staging buffer at flush time. */
  staging_snapshot: StagingSnapshot;
  /** Optional version string for the catalog in effect at emission time. */
  catalog_version?: string;
  /** Unix epoch milliseconds when the event fired. */
  timestamp: number;
}
