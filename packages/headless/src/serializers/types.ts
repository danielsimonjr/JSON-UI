import type { NormalizedNode } from "../types";

/** A pluggable output format for NormalizedNode trees. */
export interface Serializer<Output> {
  serialize(node: NormalizedNode): Output;
}
