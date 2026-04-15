import { describe, it, expect } from "vitest";
import { createHtmlSerializer } from "./html";
import type { NormalizedNode } from "../types";

describe("createHtmlSerializer", () => {
  it("calls the per-type emitter for a single node", () => {
    const ser = createHtmlSerializer({
      emitters: {
        Text: (node) =>
          `<span>${(node.props as { content: string }).content}</span>`,
      },
    });
    const node: NormalizedNode = {
      key: "r",
      type: "Text",
      props: { content: "hello" },
      children: [],
    };
    expect(ser.serialize(node)).toBe("<span>hello</span>");
  });

  it("recurses into children via emitChildren", () => {
    const ser = createHtmlSerializer({
      emitters: {
        Container: (_, emitChildren) => `<div>${emitChildren()}</div>`,
        Text: (node) =>
          `<span>${(node.props as { content: string }).content}</span>`,
      },
    });
    const node: NormalizedNode = {
      key: "r",
      type: "Container",
      props: {},
      children: [
        { key: "a", type: "Text", props: { content: "A" }, children: [] },
        { key: "b", type: "Text", props: { content: "B" }, children: [] },
      ],
    };
    expect(ser.serialize(node)).toBe("<div><span>A</span><span>B</span></div>");
  });

  it("uses the fallback for unknown types", () => {
    const ser = createHtmlSerializer({
      emitters: {},
    });
    const node: NormalizedNode = {
      key: "r",
      type: "Mystery",
      props: {},
      children: [],
    };
    expect(ser.serialize(node)).toBe('<div data-type="Mystery"></div>');
  });

  it("default fallback escapes node.type so a malicious type cannot break out of the data-type attribute", () => {
    // Component type names are LLM-emitted from the catalog. A type
    // containing a `"` or `<` without escaping would close the attribute
    // early and let attacker-controlled HTML leak into the output. The
    // default fallback is explicitly a safety fallback, not a raw-HTML
    // path — it always escapes node.type.
    const ser = createHtmlSerializer({
      emitters: {},
    });
    const node: NormalizedNode = {
      key: "r",
      type: 'Evil"><script>alert(1)</script>',
      props: {},
      children: [],
    };
    const out = ser.serialize(node);
    // The escaped type ends up as text inside the attribute — no raw
    // script tag, no attribute break.
    expect(out).toContain(
      "data-type=\"Evil&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;\"",
    );
    expect(out).not.toContain("<script>");
  });

  it("supports a custom fallback", () => {
    const ser = createHtmlSerializer({
      emitters: {},
      fallback: (node) => `<unknown:${node.type}/>`,
    });
    const node: NormalizedNode = {
      key: "r",
      type: "Mystery",
      props: {},
      children: [],
    };
    expect(ser.serialize(node)).toBe("<unknown:Mystery/>");
  });

  it("escapes text content in props by default", () => {
    const ser = createHtmlSerializer({
      emitters: {
        Text: (node, _emit, escape) =>
          `<span>${escape((node.props as { content: string }).content)}</span>`,
      },
    });
    const node: NormalizedNode = {
      key: "r",
      type: "Text",
      props: { content: '<script>alert("xss")</script>' },
      children: [],
    };
    expect(ser.serialize(node)).toBe(
      "<span>&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;</span>",
    );
  });

  it("provides a no-op escape when escapeText is false", () => {
    const ser = createHtmlSerializer({
      escapeText: false,
      emitters: {
        Text: (node, _emit, escape) => escape("<b>raw</b>"),
      },
    });
    const node: NormalizedNode = {
      key: "r",
      type: "Text",
      props: {},
      children: [],
    };
    expect(ser.serialize(node)).toBe("<b>raw</b>");
  });
});
