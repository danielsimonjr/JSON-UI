import { describe, it, expect, vi } from "vitest";
import {
  createObservableDataModel,
  createStagingBuffer,
  type UITree,
} from "@json-ui/core";
import { walkTree } from "./walker";
import { createHeadlessContext } from "./context";
import { type HeadlessRegistry } from "./registry";
import { type NormalizedNode } from "./types";
import { noopHooks } from "./hooks";

const passthroughText: HeadlessRegistry = {
  Text: (element, _ctx, children) => ({
    key: element.key,
    type: "Text",
    props: { content: (element.props as { content?: string }).content ?? "" },
    children,
    meta: { visible: true },
  }),
  Container: (element, _ctx, children) => ({
    key: element.key,
    type: "Container",
    props: {},
    children,
    meta: { visible: true },
  }),
};

function makeCtx(initialData: Record<string, unknown> = {}) {
  return createHeadlessContext({
    staging: createStagingBuffer(),
    data: createObservableDataModel(initialData as never),
  });
}

describe("walkTree", () => {
  it("walks a single root element", () => {
    const tree: UITree = {
      root: "r",
      elements: {
        r: { key: "r", type: "Text", props: { content: "hello" } },
      },
    };
    const result = walkTree({
      tree,
      registry: passthroughText,
      ctx: makeCtx(),
      hooks: noopHooks,
      passId: 1,
    });
    expect(result.key).toBe("r");
    expect(result.type).toBe("Text");
    expect(result.props.content).toBe("hello");
    expect(result.children).toEqual([]);
  });

  it("walks nested children in declared order", () => {
    const tree: UITree = {
      root: "root",
      elements: {
        root: {
          key: "root",
          type: "Container",
          props: {},
          children: ["a", "b", "c"],
        },
        a: { key: "a", type: "Text", props: { content: "A" } },
        b: { key: "b", type: "Text", props: { content: "B" } },
        c: { key: "c", type: "Text", props: { content: "C" } },
      },
    };
    const result = walkTree({
      tree,
      registry: passthroughText,
      ctx: makeCtx(),
      hooks: noopHooks,
      passId: 1,
    });
    expect(
      result.children.map((n) => (n.props as { content?: string }).content),
    ).toEqual(["A", "B", "C"]);
  });

  it("prunes invisible elements (visible: false flag) from the parent's children array", () => {
    const tree: UITree = {
      root: "root",
      elements: {
        root: {
          key: "root",
          type: "Container",
          props: {},
          children: ["a", "b"],
        },
        a: { key: "a", type: "Text", props: { content: "A" }, visible: false },
        b: { key: "b", type: "Text", props: { content: "B" } },
      },
    };
    const result = walkTree({
      tree,
      registry: passthroughText,
      ctx: makeCtx(),
      hooks: noopHooks,
      passId: 1,
    });
    expect(result.children).toHaveLength(1);
    expect(result.children[0]?.key).toBe("b");
  });

  it("prunes elements with a path-based visibility resolving false", () => {
    const tree: UITree = {
      root: "root",
      elements: {
        root: { key: "root", type: "Container", props: {}, children: ["a"] },
        a: {
          key: "a",
          type: "Text",
          props: { content: "secret" },
          visible: { path: "showSecret" },
        },
      },
    };
    const ctx = makeCtx({ showSecret: false });
    const result = walkTree({
      tree,
      registry: passthroughText,
      ctx,
      hooks: noopHooks,
      passId: 1,
    });
    expect(result.children).toEqual([]);
  });

  it("handles a missing child key by emitting onError and skipping", () => {
    const tree: UITree = {
      root: "root",
      elements: {
        root: {
          key: "root",
          type: "Container",
          props: {},
          children: ["a", "ghost", "b"],
        },
        a: { key: "a", type: "Text", props: { content: "A" } },
        b: { key: "b", type: "Text", props: { content: "B" } },
      },
    };
    const onError = vi.fn();
    const result = walkTree({
      tree,
      registry: passthroughText,
      ctx: makeCtx(),
      hooks: { ...noopHooks, onError },
      passId: 1,
    });
    expect(result.children.map((n) => n.key)).toEqual(["a", "b"]);
    expect(onError).toHaveBeenCalledTimes(1);
    const call = onError.mock.calls[0]?.[0] as {
      name: string;
      phase: string;
      message: string;
    };
    expect(call.name).toBe("MissingChildError");
    expect(call.phase).toBe("walk");
    expect(call.message).toContain("ghost");
  });

  it("handles an unknown component type with a fallback Unknown node + onError", () => {
    const tree: UITree = {
      root: "root",
      elements: {
        root: { key: "root", type: "Container", props: {}, children: ["x"] },
        x: { key: "x", type: "Mystery", props: { foo: "bar" } },
      },
    };
    const onError = vi.fn();
    const result = walkTree({
      tree,
      registry: passthroughText,
      ctx: makeCtx(),
      hooks: { ...noopHooks, onError },
      passId: 1,
    });
    expect(result.children).toHaveLength(1);
    const fallback = result.children[0];
    expect(fallback?.type).toBe("Unknown");
    expect((fallback?.props as { _originalType?: string })._originalType).toBe(
      "Mystery",
    );
    expect(onError).toHaveBeenCalledTimes(1);
    const call = onError.mock.calls[0]?.[0] as { name: string; phase: string };
    expect(call.name).toBe("UnknownComponentError");
    expect(call.phase).toBe("walk");
  });

  it("fires onElementRender once per visible element in walk order", () => {
    const tree: UITree = {
      root: "root",
      elements: {
        root: {
          key: "root",
          type: "Container",
          props: {},
          children: ["a", "b"],
        },
        a: { key: "a", type: "Text", props: { content: "A" } },
        b: { key: "b", type: "Text", props: { content: "B" } },
      },
    };
    const events: Array<{ key: string; type: string }> = [];
    walkTree({
      tree,
      registry: passthroughText,
      ctx: makeCtx(),
      hooks: {
        ...noopHooks,
        onElementRender: (e) =>
          events.push({ key: e.elementKey, type: e.elementType }),
      },
      passId: 1,
    });
    // Post-order: children before their parent.
    expect(events.map((e) => e.key)).toEqual(["a", "b", "root"]);
  });
});
