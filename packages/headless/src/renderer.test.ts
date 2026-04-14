import { describe, it, expect, vi } from "vitest";
import {
  createCatalog,
  createObservableDataModel,
  createStagingBuffer,
  type IntentEvent,
  type UITree,
} from "@json-ui/core";
import { z } from "zod";
import { createHeadlessRenderer } from "./renderer";
import { type HeadlessRegistry } from "./registry";

const textCatalog = createCatalog({
  components: {
    Container: { props: z.object({}) },
    Text: { props: z.object({ content: z.string() }) },
    TextField: { props: z.object({ id: z.string(), label: z.string() }) },
    Button: { props: z.object({ label: z.string() }) },
  },
  actions: {
    submit: { description: "submit form" },
  },
});

const textRegistry: HeadlessRegistry = {
  Container: (el, _ctx, children) => ({
    key: el.key,
    type: "Container",
    props: {},
    children,
    meta: { visible: true },
  }),
  Text: (el) => ({
    key: el.key,
    type: "Text",
    props: { content: (el.props as { content: string }).content },
    children: [],
    meta: { visible: true },
  }),
  TextField: (el, ctx) => {
    const id = (el.props as { id: string }).id;
    const value = ctx.staging.get(id);
    return {
      key: el.key,
      type: "TextField",
      props: {
        id,
        label: (el.props as { label: string }).label,
        value: typeof value === "string" ? value : "",
      },
      children: [],
      meta: { visible: true },
    };
  },
  Button: (el) => ({
    key: el.key,
    type: "Button",
    props: { label: (el.props as { label: string }).label },
    children: [],
    meta: { visible: true },
  }),
};

const simpleTree: UITree = {
  root: "r",
  elements: {
    r: { key: "r", type: "Text", props: { content: "hello" } },
  },
};

describe("createHeadlessRenderer", () => {
  it("renders a single-element tree", () => {
    const session = createHeadlessRenderer({
      catalog: textCatalog,
      registry: textRegistry,
    });
    const out = session.render(simpleTree);
    expect(out.type).toBe("Text");
    expect(out.props.content).toBe("hello");
  });

  it("render is a pure function of (tree, state) — Invariant 1", () => {
    const session = createHeadlessRenderer({
      catalog: textCatalog,
      registry: textRegistry,
    });
    const a = session.render(simpleTree);
    const b = session.render(simpleTree);
    expect(b).toEqual(a);
  });

  it("each render pass captures a consistent state snapshot — Invariant 15 (between passes)", () => {
    const staging = createStagingBuffer();
    staging.set("v", "first");
    const session = createHeadlessRenderer({
      catalog: textCatalog,
      registry: textRegistry,
      staging,
    });
    const tree: UITree = {
      root: "r",
      elements: {
        r: { key: "r", type: "TextField", props: { id: "v", label: "X" } },
      },
    };
    const passA = session.render(tree);
    staging.set("v", "second");
    const passB = session.render(tree);
    expect(passA.props.value).toBe("first");
    expect(passB.props.value).toBe("second");
  });

  it("mid-render staging writes do not leak into later elements of the same pass — Invariant 15 (within pass)", () => {
    // The tighter reading of Invariant 15: if a hook callback (or any other
    // code running during the render pass) mutates the shared staging
    // buffer, the elements walked AFTER the mutation must still see the
    // pass-start snapshot. The context binds its views to a frozen
    // snapshot at pass-start construction, so this holds structurally.
    const staging = createStagingBuffer();
    staging.set("v", "pass-start");
    const session = createHeadlessRenderer({
      catalog: textCatalog,
      registry: textRegistry,
      staging,
      // The onBeforeRender hook writes a new value to the live staging
      // buffer after the pass has started (the context has already
      // been constructed by that point).
      hooks: {
        onBeforeRender: () => {
          staging.set("v", "written-mid-pass");
        },
      },
    });
    const tree: UITree = {
      root: "parent",
      elements: {
        parent: {
          key: "parent",
          type: "Container",
          props: {},
          children: ["child"],
        },
        child: {
          key: "child",
          type: "TextField",
          props: { id: "v", label: "X" },
        },
      },
    };
    const result = session.render(tree);
    // The child walked AFTER onBeforeRender fired. If the view were live,
    // it would now report "written-mid-pass". The frozen-snapshot view
    // keeps the pass-start value.
    expect(result.children[0]?.props.value).toBe("pass-start");
    // The live buffer did accept the write — this is not about
    // preventing the write, just about pass isolation.
    expect(staging.get("v")).toBe("written-mid-pass");
  });

  it("creates its own staging and data when none are provided", () => {
    const session = createHeadlessRenderer({
      catalog: textCatalog,
      registry: textRegistry,
    });
    expect(session.getStaging().has("anything")).toBe(false);
    expect(session.getData()).toEqual({});
  });

  it("uses provided shared stores", () => {
    const staging = createStagingBuffer();
    staging.set("email", "shared@example.com");
    const data = createObservableDataModel({ user: { name: "Alice" } });
    const session = createHeadlessRenderer({
      catalog: textCatalog,
      registry: textRegistry,
      staging,
      data,
    });
    expect(session.getStaging().get("email")).toBe("shared@example.com");
    expect(session.getData()).toEqual({ user: { name: "Alice" } });
  });

  it("throws OptionConflictError when both data and initialData are provided", () => {
    expect(() =>
      createHeadlessRenderer({
        catalog: textCatalog,
        registry: textRegistry,
        data: createObservableDataModel({}),
        initialData: { x: 1 },
      }),
    ).toThrow(/OptionConflict|Mutually exclusive/);
  });

  it("validates initialData and throws InitialDataNotSerializableError on bad input", () => {
    expect(() =>
      createHeadlessRenderer({
        catalog: textCatalog,
        registry: textRegistry,
        initialData: { bad: new Date() as never },
      }),
    ).toThrow(/initialData contains non-JSON-serializable/);
  });

  it("setStagingField writes to the underlying buffer and fires onStagingChange", () => {
    const onStagingChange = vi.fn();
    const session = createHeadlessRenderer({
      catalog: textCatalog,
      registry: textRegistry,
      hooks: { onStagingChange },
    });
    session.setStagingField("email", "x@y.z");
    expect(session.getStaging().get("email")).toBe("x@y.z");
    expect(onStagingChange).toHaveBeenCalledTimes(1);
    expect(onStagingChange.mock.calls[0]?.[0]).toMatchObject({
      fieldId: "email",
      newValue: "x@y.z",
      oldValue: undefined,
    });
  });

  it("setData writes to the underlying store and fires onDataChange", () => {
    const onDataChange = vi.fn();
    const session = createHeadlessRenderer({
      catalog: textCatalog,
      registry: textRegistry,
      hooks: { onDataChange },
    });
    session.setData("user/name", "Bob");
    expect(session.getData()).toEqual({ user: { name: "Bob" } });
    expect(onDataChange).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "user/name",
        newValue: "Bob",
        oldValue: undefined,
      }),
    );
  });

  it("dispatch emits a structurally correct IntentEvent and fires onIntent + onActionDispatched", () => {
    const onIntent = vi.fn<(e: IntentEvent) => void>();
    const onActionDispatched = vi.fn();
    const session = createHeadlessRenderer({
      catalog: textCatalog,
      registry: textRegistry,
      onIntent,
      hooks: { onActionDispatched },
      catalogVersion: "v1.2.3",
    });
    session.setStagingField("email", "a@b.c");
    session.dispatch("submit", { foo: "bar" });
    expect(onIntent).toHaveBeenCalledTimes(1);
    expect(onActionDispatched).toHaveBeenCalledTimes(1);
    const event = onIntent.mock.calls[0]?.[0] as IntentEvent;
    expect(event.action_name).toBe("submit");
    expect(event.action_params).toEqual({ foo: "bar" });
    expect(event.staging_snapshot).toEqual({ email: "a@b.c" });
    expect(event.catalog_version).toBe("v1.2.3");
    expect(typeof event.timestamp).toBe("number");
  });

  it("buffer is NOT cleared on dispatch", () => {
    const session = createHeadlessRenderer({
      catalog: textCatalog,
      registry: textRegistry,
      onIntent: () => {},
    });
    session.setStagingField("a", 1);
    session.dispatch("submit");
    expect(session.getStaging().get("a")).toBe(1);
  });

  it("fires onBeforeRender, onElementRender, onAfterRender in order", () => {
    const calls: string[] = [];
    const session = createHeadlessRenderer({
      catalog: textCatalog,
      registry: textRegistry,
      hooks: {
        onBeforeRender: () => calls.push("before"),
        onElementRender: () => calls.push("element"),
        onAfterRender: () => calls.push("after"),
      },
    });
    session.render(simpleTree);
    expect(calls).toEqual(["before", "element", "after"]);
  });

  it("passId increments across successive render calls", () => {
    const passes: number[] = [];
    const session = createHeadlessRenderer({
      catalog: textCatalog,
      registry: textRegistry,
      hooks: { onBeforeRender: (e) => passes.push(e.passId) },
    });
    session.render(simpleTree);
    session.render(simpleTree);
    session.render(simpleTree);
    expect(passes).toEqual([1, 2, 3]);
  });

  it("destroy makes subsequent calls throw SessionDestroyedError", () => {
    const session = createHeadlessRenderer({
      catalog: textCatalog,
      registry: textRegistry,
    });
    session.destroy();
    expect(() => session.render(simpleTree)).toThrow(/destroyed/i);
    expect(() => session.dispatch("submit")).toThrow(/destroyed/i);
    expect(() => session.setStagingField("x", 1)).toThrow(/destroyed/i);
    expect(() => session.setData("x", 1)).toThrow(/destroyed/i);
  });

  it("destroy is idempotent", () => {
    const session = createHeadlessRenderer({
      catalog: textCatalog,
      registry: textRegistry,
    });
    session.destroy();
    expect(() => session.destroy()).not.toThrow();
  });

  it("renders with shared stores reflects external mutations", () => {
    const staging = createStagingBuffer();
    const session = createHeadlessRenderer({
      catalog: textCatalog,
      registry: textRegistry,
      staging,
    });
    const tree: UITree = {
      root: "r",
      elements: {
        r: {
          key: "r",
          type: "TextField",
          props: { id: "name", label: "Name" },
        },
      },
    };
    let out = session.render(tree);
    expect(out.props.value).toBe("");
    staging.set("name", "Alice");
    out = session.render(tree);
    expect(out.props.value).toBe("Alice");
  });

  it("onError on missing-child does not crash the render", () => {
    const tree: UITree = {
      root: "root",
      elements: {
        root: {
          key: "root",
          type: "Text",
          props: { content: "ok" },
          children: ["ghost"],
        },
      },
    };
    const onError = vi.fn();
    const session = createHeadlessRenderer({
      catalog: textCatalog,
      registry: textRegistry,
      hooks: { onError },
    });
    const out = session.render(tree);
    expect(out.type).toBe("Text");
    expect(onError).toHaveBeenCalled();
  });
});
