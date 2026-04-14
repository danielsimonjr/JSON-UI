import type { NormalizedNode } from "../types";
import type { Serializer } from "./types";

/** Identity serializer — returns the NormalizedNode unchanged. */
export const JsonSerializer: Serializer<NormalizedNode> = {
  serialize(node) {
    return node;
  },
};

/** JSON.stringify serializer — returns a string. */
export const JsonStringSerializer: Serializer<string> = {
  serialize(node) {
    return JSON.stringify(node);
  },
};
