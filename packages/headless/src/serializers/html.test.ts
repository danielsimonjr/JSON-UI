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
