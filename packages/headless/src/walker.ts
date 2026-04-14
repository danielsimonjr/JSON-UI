import type { UIElement, UITree } from "@json-ui/core";
import {
  MissingChildError,
  UnknownComponentError,
  toSerializableError,
} from "./errors";
import type { HeadlessContext } from "./context";
import type { HeadlessRegistry } from "./registry";
import type { NormalizedNode, RenderPassId } from "./types";
import type { RenderHooks } from "./hooks";

interface WalkInput {
  tree: UITree;
  registry: HeadlessRegistry;
  ctx: HeadlessContext;
  hooks: RenderHooks;
  passId: RenderPassId;
}

/**
 * Walk a flat UITree from its root and produce a NormalizedNode.
 *
 * - Visibility-pruned elements are absent from their parent's `children`.
 * - Missing child keys produce a MissingChildError on `hooks.onError` and are
 *   skipped (the rest of the tree continues to walk).
 * - Unknown component types produce an UnknownComponentError on `hooks.onError`
 *   and are replaced with a fallback `{type: "Unknown", props: {_originalType: ...}}`.
 * - `onElementRender` fires after each element's NormalizedNode is constructed,
 *   in depth-first order (children before their parent).
 */
export function walkTree(input: WalkInput): NormalizedNode {
  const { tree, registry, ctx, hooks, passId } = input;

  const walk = (
    elementKey: string,
    parentKey: string | null,
  ): NormalizedNode | undefined => {
    const element = tree.elements[elementKey];
    if (element === undefined) {
      // Should only fire when the ROOT key is missing, since walkChildren
      // catches missing keys before recursing. Treat as a structural error.
      const err = new MissingChildError(elementKey, parentKey ?? "<root>");
      hooks.onError(toSerializableError(err, "walk"));
      return undefined;
    }

    // Visibility evaluation
    if (!ctx.evaluateVisibility(element.visible)) {
      return undefined;
    }

    const renderedChildren: NormalizedNode[] = [];
    if (element.children !== undefined) {
      for (const childKey of element.children) {
        if (tree.elements[childKey] === undefined) {
          const err = new MissingChildError(childKey, elementKey);
          hooks.onError(toSerializableError(err, "walk"));
          continue;
        }
        const childNode = walk(childKey, elementKey);
        if (childNode !== undefined) renderedChildren.push(childNode);
      }
    }

    let resultNode: NormalizedNode;

    const componentFn = registry[element.type];
    if (componentFn === undefined) {
      const err = new UnknownComponentError(element.type, element.key);
      hooks.onError(toSerializableError(err, "walk"));
      resultNode = {
        key: element.key,
        type: "Unknown",
        props: {
          _originalType: element.type,
        },
        children: renderedChildren,
        meta: { visible: true },
      };
    } else {
      try {
        resultNode = componentFn(element as UIElement, ctx, renderedChildren);
      } catch (componentError) {
        // Default: bubble. Open Question 4 in the spec — without
        // continueOnComponentError, render() rethrows. The walker delegates
        // that decision to the renderer.
        hooks.onError(toSerializableError(componentError, "component"));
        throw componentError;
      }
    }

    hooks.onElementRender({
      passId,
      elementKey: element.key,
      elementType: element.type,
      result: resultNode,
      timestamp: Date.now(),
    });

    return resultNode;
  };

  const rootResult = walk(tree.root, null);
  if (rootResult === undefined) {
    // Root was either invisible or missing. Return an empty placeholder so
    // callers always get a NormalizedNode (the renderer's onAfterRender hook
    // requires a result object). Use the distinct `"Empty"` type so callers
    // can detect the placeholder; `meta.visible` remains `true` because the
    // spec requires every emitted node to have `meta.visible === true`
    // (pruned nodes are ABSENT from output, not flagged).
    return {
      key: tree.root,
      type: "Empty",
      props: {},
      children: [],
      meta: { visible: true },
    };
  }
  return rootResult;
}
