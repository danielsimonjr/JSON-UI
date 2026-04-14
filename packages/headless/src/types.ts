import type { JSONValue, StagingSnapshot } from "@json-ui/core";

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
