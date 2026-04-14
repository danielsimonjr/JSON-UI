import type { FieldId, UITree } from "@json-ui/core";

/**
 * Walk a UITree and collect every `id` prop from input components. Used by
 * the renderer to build the `liveIds` set for StagingBuffer.reconcile.
 *
 * Convention: any element whose `props.id` is a string is treated as an input
 * element. This matches NC's existing convention (TextField, Checkbox,
 * NumberField etc. all carry `id: string` as their staging key).
 */
export function collectFieldIds(tree: UITree): Set<FieldId> {
  const ids = new Set<FieldId>();
  for (const element of Object.values(tree.elements)) {
    const id = (element.props as { id?: unknown }).id;
    if (typeof id === "string" && id.length > 0) {
      ids.add(id);
    }
  }
  return ids;
}
