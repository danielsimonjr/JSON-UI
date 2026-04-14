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

const DEFAULT_FALLBACK: HtmlEmitter = (node, emitChildren) =>
  `<div data-type="${node.type}">${emitChildren()}</div>`;

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const NO_ESCAPE: (s: string) => string = (s) => s;

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
