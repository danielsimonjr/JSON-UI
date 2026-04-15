import type { UITree } from "./types";
import type { FieldId } from "./runtime";

/**
 * Walk a UITree and collect every `id` prop from input components.
 *
 * Consumers use the returned set as the `liveIds` argument to
 * `StagingBuffer.reconcile(liveIds)` — any staging entry whose key is NOT in
 * the returned set will be dropped. Entries whose keys ARE in the set are
 * preserved unchanged across re-render.
 *
 * Convention: any element whose `props.id` is a non-empty string is treated
 * as an input element. This matches the NC runtime's convention (TextField,
 * Checkbox, NumberField, etc. all carry `id: string` as their staging key).
 *
 * The helper lives in `@json-ui/core` because both `@json-ui/headless` and
 * a React-only NC runtime need it — forcing the React path to pull in the
 * full headless package just to get this walker was a Plan 3 review gap.
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
