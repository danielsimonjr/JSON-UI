import type { NormalizedNode } from "../types";
import type { Serializer } from "./types";

/**
 * Per-type HTML emitter. Receives the node, a `emitChildren` thunk that
 * produces the HTML for the node's children (recursing via the same
 * serializer), and an `escape` helper. The escape helper honors the
 * serializer's `escapeText` option — pass `escapeText: false` to make
 * `escape` a no-op for raw HTML output.
 */
export type HtmlEmitter = (
  node: NormalizedNode,
  emitChildren: () => string,
  escape: (s: string) => string,
) => string;

export interface HtmlSerializerOptions {
  emitters: Record<string, HtmlEmitter>;
  fallback?: HtmlEmitter;
  escapeText?: boolean;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const NO_ESCAPE: (s: string) => string = (s) => s;

// Default fallback always escapes node.type defensively — component type
// names come from the LLM-emitted catalog, so a malicious or typo'd type
// containing `"` would break out of the data-type attribute without this
// guard. The escape pass is a one-time per-node cost and is not
// configurable via `escapeText: false` because this default is explicitly
// a safety fallback. Callers who want raw HTML should provide their own
// `fallback` emitter.
const DEFAULT_FALLBACK: HtmlEmitter = (node, emitChildren) =>
  `<div data-type="${escapeHtml(node.type)}">${emitChildren()}</div>`;

export function createHtmlSerializer(
  options: HtmlSerializerOptions,
): Serializer<string> {
  const fallback = options.fallback ?? DEFAULT_FALLBACK;
  const escape = options.escapeText === false ? NO_ESCAPE : escapeHtml;

  const serializeNode = (node: NormalizedNode): string => {
    const emitter = options.emitters[node.type] ?? fallback;
    const emitChildren = () => node.children.map(serializeNode).join("");
    return emitter(node, emitChildren, escape);
  };

  return { serialize: serializeNode };
}
