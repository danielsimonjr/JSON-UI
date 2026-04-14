import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  createCatalog,
  createObservableDataModel,
  createStagingBuffer,
  type IntentEvent,
  type UITree,
} from "@json-ui/core";
import {
  createHeadlessRenderer,
  createHtmlSerializer,
  JsonStringSerializer,
  type HeadlessRegistry,
} from "./index";

const ncCatalog = createCatalog({
  name: "nc-test",
  components: {
    Container: { props: z.object({}) },
    TextField: { props: z.object({ id: z.string(), label: z.string() }) },
    Checkbox: { props: z.object({ id: z.string(), label: z.string() }) },
    Button: { props: z.object({ label: z.string() }) },
  },
  actions: {
    submit_form: { description: "submit the form" },
  },
});

const registry: HeadlessRegistry = {
  Container: (el, _ctx, children) => ({
    key: el.key,
    type: "Container",
    props: {},
    children,
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
  Checkbox: (el, ctx) => {
    const id = (el.props as { id: string }).id;
    const value = ctx.staging.get(id);
    return {
      key: el.key,
      type: "Checkbox",
      props: {
        id,
        label: (el.props as { label: string }).label,
        checked: typeof value === "boolean" ? value : false,
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

const formTree: UITree = {
  root: "form",
  elements: {
    form: {
      key: "form",
      type: "Container",
      props: {},
      children: ["email", "agree", "submit"],
    },
    email: {
      key: "email",
      type: "TextField",
      props: { id: "email", label: "Email" },
    },
    agree: {
      key: "agree",
      type: "Checkbox",
      props: { id: "agree", label: "I agree" },
    },
    submit: { key: "submit", type: "Button", props: { label: "Submit" } },
  },
};

describe("integration: dual-backend friendly headless session", () => {
  it("renders a typical NC form", () => {
    const session = createHeadlessRenderer({
      catalog: ncCatalog,
      registry,
    });
    const out = session.render(formTree);
    expect(out.type).toBe("Container");
    expect(out.children).toHaveLength(3);
    expect(out.children[0]?.type).toBe("TextField");
    expect(out.children[0]?.props.value).toBe("");
  });

  it("reflects external staging writes through shared store", () => {
    const sharedStaging = createStagingBuffer();
    const session = createHeadlessRenderer({
      catalog: ncCatalog,
      registry,
      staging: sharedStaging,
    });
    sharedStaging.set("email", "user@example.com");
    sharedStaging.set("agree", true);
    const out = session.render(formTree);
    const email = out.children[0]!;
    const agree = out.children[1]!;
    expect(email.props.value).toBe("user@example.com");
    expect(agree.props.checked).toBe(true);
  });

  it("dispatch emits an IntentEvent the JsonStringSerializer can serialize", () => {
    let emitted: IntentEvent | null = null;
    const session = createHeadlessRenderer({
      catalog: ncCatalog,
      registry,
      onIntent: (e) => {
        emitted = e;
      },
    });
    session.setStagingField("email", "x@y.z");
    session.setStagingField("agree", true);
    session.dispatch("submit_form", { source: "test" });

    expect(emitted).not.toBeNull();
    const json = JsonStringSerializer.serialize({
      key: "ev",
      type: "Event",
      props: emitted as never,
      children: [],
    });
    const round = JSON.parse(json);
    expect(round.props.action_name).toBe("submit_form");
    expect(round.props.staging_snapshot).toEqual({
      email: "x@y.z",
      agree: true,
    });
  });

  it("HTML serializer renders the rendered tree with a per-type emitter map", () => {
    const sharedStaging = createStagingBuffer();
    sharedStaging.set("email", "alice@example.com");
    const session = createHeadlessRenderer({
      catalog: ncCatalog,
      registry,
      staging: sharedStaging,
    });
    const out = session.render(formTree);
    const html = createHtmlSerializer({
      emitters: {
        Container: (_, emit) => `<form>${emit()}</form>`,
        TextField: (node, _emit, escape) => {
          const props = node.props as {
            id: string;
            label: string;
            value: string;
          };
          return `<label>${escape(props.label)}<input name="${escape(props.id)}" value="${escape(props.value)}"/></label>`;
        },
        Checkbox: (node) => {
          const props = node.props as {
            id: string;
            label: string;
            checked: boolean;
          };
          return `<label><input type="checkbox" name="${props.id}" ${props.checked ? "checked" : ""}/>${props.label}</label>`;
        },
        Button: (node) => {
          const props = node.props as { label: string };
          return `<button>${props.label}</button>`;
        },
      },
    }).serialize(out);
    expect(html).toContain("<form>");
    expect(html).toContain('value="alice@example.com"');
    expect(html).toContain("<button>Submit</button>");
  });

  it("two sessions sharing data + staging see each other's writes", () => {
    const staging = createStagingBuffer();
    const data = createObservableDataModel({});
    const a = createHeadlessRenderer({
      catalog: ncCatalog,
      registry,
      staging,
      data,
    });
    const b = createHeadlessRenderer({
      catalog: ncCatalog,
      registry,
      staging,
      data,
    });
    a.setStagingField("email", "shared@a.com");
    a.setData("user/name", "Alice");
    expect(b.getStaging().get("email")).toBe("shared@a.com");
    expect(b.getData()).toEqual({ user: { name: "Alice" } });
  });

  it("every emitted hook event is JSON.stringify/parse round-trip safe", () => {
    const captured: Array<{ kind: string; payload: unknown }> = [];
    const session = createHeadlessRenderer({
      catalog: ncCatalog,
      registry,
      onIntent: () => {},
      hooks: {
        onBeforeRender: (e) =>
          captured.push({ kind: "onBeforeRender", payload: e }),
        onAfterRender: (e) =>
          captured.push({ kind: "onAfterRender", payload: e }),
        onElementRender: (e) =>
          captured.push({ kind: "onElementRender", payload: e }),
        onActionDispatched: (e) =>
          captured.push({ kind: "onActionDispatched", payload: e }),
        onStagingChange: (e) =>
          captured.push({ kind: "onStagingChange", payload: e }),
        onDataChange: (e) =>
          captured.push({ kind: "onDataChange", payload: e }),
        onError: (e) => captured.push({ kind: "onError", payload: e }),
      },
    });
    session.setStagingField("email", "x@y.z");
    session.setData("user/role", "admin");
    session.render(formTree);
    session.dispatch("submit_form", { ok: true });

    // Force at least one onError by rendering a tree with a missing child.
    session.render({
      root: "root",
      elements: {
        root: {
          key: "root",
          type: "Container",
          props: {},
          children: ["ghost"],
        },
      },
    });

    expect(captured.length).toBeGreaterThan(0);
    for (const entry of captured) {
      // Invariant 11: every hook payload must survive a JSON round-trip
      // DEEP-EQUAL to its original. Comparing the round-trip against the
      // original (not against another round-trip) is what actually tests
      // serializability — a `Date`, `Map`, `function`, `undefined`, or
      // `BigInt` in the payload would differ after JSON.stringify/parse
      // and fail this check.
      const round = JSON.parse(JSON.stringify(entry.payload));
      expect(round, `${entry.kind} payload must be JSON round-trip safe`).toEqual(
        entry.payload,
      );
    }
  });

  it("hook serializability assertion fires on a non-JSONValue payload (negative control)", () => {
    // This test proves that the Invariant 11 assertion above is tight: it
    // constructs a payload that contains a Date and verifies the same
    // round-trip+toEqual pattern throws. Without this negative control, a
    // future refactor could silently break the main assertion and no one
    // would notice because every real payload happens to be JSON-safe.
    const badPayload = { when: new Date("2026-04-14T00:00:00Z") };
    const round = JSON.parse(JSON.stringify(badPayload));
    expect(() => {
      expect(round).toEqual(badPayload);
    }).toThrow();
  });

  it("zero React imports across every source file", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const srcDir = path.join(process.cwd(), "packages/headless/src");
    const collect = async (dir: string): Promise<string[]> => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      const out: string[] = [];
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          out.push(...(await collect(full)));
        } else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) {
          out.push(full);
        }
      }
      return out;
    };
    const files = await collect(srcDir);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const content = await fs.readFile(file, "utf-8");
      expect(content, `${file} must not import react`).not.toMatch(
        /from\s+["']react["']/,
      );
      expect(content, `${file} must not import react-dom`).not.toMatch(
        /from\s+["']react-dom["']/,
      );
      expect(content, `${file} must not import jsdom`).not.toMatch(
        /from\s+["']jsdom["']/,
      );
      expect(content, `${file} must not import @json-ui/react`).not.toMatch(
        /from\s+["']@json-ui\/react["']/,
      );
    }
  });
});
