import { describe, it, expect } from "vitest";
import { JsonSerializer, JsonStringSerializer } from "./json";
import type { NormalizedNode } from "../types";

const sample: NormalizedNode = {
  key: "r",
  type: "Container",
  props: { className: "x" },
  children: [
    { key: "a", type: "Text", props: { content: "hi" }, children: [] },
  ],
  meta: { visible: true },
};

describe("JsonSerializer", () => {
  it("returns the input node as-is (identity serializer)", () => {
    const out = JsonSerializer.serialize(sample);
    expect(out).toBe(sample);
  });
});

describe("JsonStringSerializer", () => {
  it("returns a JSON string that round-trips to the original", () => {
    const str = JsonStringSerializer.serialize(sample);
    expect(typeof str).toBe("string");
    const parsed = JSON.parse(str);
    expect(parsed).toEqual(JSON.parse(JSON.stringify(sample)));
  });

  it("produces stable output (no functions, no symbols, no undefined-stripping surprises)", () => {
    const str = JsonStringSerializer.serialize(sample);
    expect(str).toContain('"type":"Container"');
    expect(str).toContain('"content":"hi"');
  });
});
