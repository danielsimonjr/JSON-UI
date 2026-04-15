import type { UITree } from "./types";
import type { FieldId } from "./runtime";

/**
 * Thrown by `validateUniqueFieldIds` when two UITree elements carry the same
 * `id` prop. Implements the Neural Computer's Invariant 8 (field-ID
 * uniqueness), but the helper is generic — any consumer that uses a
 * staging-buffer-style key contract wants this guarantee.
 *
 * The error names the duplicated ID and the two element keys that carry it.
 * That is enough context for the caller to point the user at the offending
 * spot in a catalog-emitted tree without walking it again.
 */
export class DuplicateFieldIdError extends Error {
  override readonly name = "DuplicateFieldIdError";
  constructor(
    public readonly fieldId: FieldId,
    public readonly firstElementKey: string,
    public readonly secondElementKey: string,
  ) {
    super(
      `Duplicate field id "${fieldId}" on elements "${firstElementKey}" and "${secondElementKey}". ` +
        `Field IDs must be unique within a single rendered tree.`,
    );
  }
}

/**
 * Walk a UITree and verify that every `id` prop (string, non-empty) is
 * unique across all elements. Returns the set of discovered IDs on success;
 * throws `DuplicateFieldIdError` on the first collision.
 *
 * Non-string `id` props and missing `id` props are ignored — the rule is
 * "if it's a field ID, it must be unique," not "every element must have an
 * id." This matches the Plan-1 / Plan-3 convention where input components
 * carry `id: string` and display components (Text, Container) omit it.
 *
 * Intended as a tree-emission-time check: the NC runtime calls this before
 * committing a fresh tree from the LLM, catching collisions before the
 * staging buffer reconciliation step runs.
 */
export function validateUniqueFieldIds(tree: UITree): Set<FieldId> {
  const seen = new Map<FieldId, string>();
  for (const [elementKey, element] of Object.entries(tree.elements)) {
    const id = (element.props as { id?: unknown }).id;
    if (typeof id !== "string" || id.length === 0) continue;
    const firstElementKey = seen.get(id);
    if (firstElementKey !== undefined) {
      throw new DuplicateFieldIdError(id, firstElementKey, elementKey);
    }
    seen.set(id, elementKey);
  }
  return new Set(seen.keys());
}
