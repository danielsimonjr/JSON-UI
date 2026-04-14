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

const MAX_CAUSE_DEPTH = 9;

function isErrorLike(
  v: unknown,
): v is { name?: unknown; message: unknown; stack?: unknown; cause?: unknown } {
  return (
    typeof v === "object" &&
    v !== null &&
    "message" in v &&
    typeof (v as { message: unknown }).message === "string"
  );
}

function coerceUnknown(value: unknown): {
  name: string;
  message: string;
  stack?: string;
  cause?: unknown;
} {
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

function walkCause(
  value: unknown,
  depth: number,
): Omit<SerializableError, "phase"> | undefined {
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
export function toSerializableError(
  error: unknown,
  phase: RenderPhase,
): SerializableError {
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
    super(
      `No component registered for type "${elementType}" (element key "${elementKey}")`,
    );
  }
}

/** Thrown when a UITree element references a child key that does not exist in `tree.elements`. */
export class MissingChildError extends Error {
  override name = "MissingChildError";
  constructor(
    public readonly missingKey: string,
    public readonly parentKey: string,
  ) {
    super(
      `Missing child key "${missingKey}" referenced by parent "${parentKey}"`,
    );
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
