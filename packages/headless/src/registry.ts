import type { UIElement } from "@json-ui/core";
import type { HeadlessContext } from "./context";
import type { NormalizedNode } from "./types";

/**
 * A pure function that takes an element, a render context, and the already-
 * rendered children, and returns a NormalizedNode. No hooks, no closure state,
 * no lifecycle. All state flows through `ctx`.
 */
export type HeadlessComponent<P = Record<string, unknown>> = (
  element: UIElement<string, P>,
  ctx: HeadlessContext,
  children: NormalizedNode[],
) => NormalizedNode;

/** Component-type to function map. */
export type HeadlessRegistry = Record<string, HeadlessComponent>;
