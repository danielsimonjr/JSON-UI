import { describe, it, expect } from "vitest";
import { createObservableDataModel, createStagingBuffer } from "@json-ui/core";
import { createHeadlessContext } from "./context";

describe("createHeadlessContext", () => {
  it("exposes a read-only staging view that mirrors the underlying buffer", () => {
    const buf = createStagingBuffer();
    buf.set("name", "Alice");
    const ctx = createHeadlessContext({
      staging: buf,
      data: createObservableDataModel({}),
    });
    expect(ctx.staging.get("name")).toBe("Alice");
    expect(ctx.staging.has("name")).toBe(true);
    expect(ctx.staging.has("missing")).toBe(false);
    // No write methods on the view.
    expect("set" in ctx.staging).toBe(false);
    expect("delete" in ctx.staging).toBe(false);
    expect("subscribe" in ctx.staging).toBe(false);
  });

  it("exposes a read-only data view that mirrors the underlying store", () => {
    const data = createObservableDataModel({ user: { name: "Bob" } });
    const ctx = createHeadlessContext({ staging: createStagingBuffer(), data });
    expect(ctx.data.get("user/name")).toBe("Bob");
    expect("set" in ctx.data).toBe(false);
  });

  it("evaluates a true visibility condition", () => {
    const ctx = createHeadlessContext({
      staging: createStagingBuffer(),
      data: createObservableDataModel({ flag: true }),
    });
    expect(ctx.evaluateVisibility(undefined)).toBe(true);
    expect(ctx.evaluateVisibility(true)).toBe(true);
    expect(ctx.evaluateVisibility({ path: "flag" })).toBe(true);
  });

  it("evaluates a false visibility condition", () => {
    const ctx = createHeadlessContext({
      staging: createStagingBuffer(),
      data: createObservableDataModel({ flag: false }),
    });
    expect(ctx.evaluateVisibility(false)).toBe(false);
    expect(ctx.evaluateVisibility({ path: "flag" })).toBe(false);
    expect(ctx.evaluateVisibility({ path: "missing" })).toBe(false);
  });

  it("resolves DynamicValue against data", () => {
    const ctx = createHeadlessContext({
      staging: createStagingBuffer(),
      data: createObservableDataModel({ user: { id: 42 } }),
    });
    const resolved = ctx.resolveDynamic({
      direct: "literal",
      ref: { path: "user/id" },
    });
    expect(resolved).toEqual({ direct: "literal", ref: 42 });
  });

  it("resolves DynamicValue against staging when path is a single-segment field id", () => {
    // Spec: resolveDynamic must consult BOTH data and staging. A button's
    // action params may reference a staging field ({path: "email"}) — that
    // should pull from the staging buffer, not from the data model.
    const buf = createStagingBuffer();
    buf.set("email", "user@example.com");
    const ctx = createHeadlessContext({
      staging: buf,
      data: createObservableDataModel({}),
    });
    const resolved = ctx.resolveDynamic({
      to: { path: "email" },
      subject: "Welcome",
    });
    expect(resolved).toEqual({ to: "user@example.com", subject: "Welcome" });
  });

  it("prefers staging over data when both have a value for a single-segment path", () => {
    // Edge case: same key exists in both. Staging wins because it is the
    // user's in-progress state and supersedes durable data for the moment.
    const buf = createStagingBuffer();
    buf.set("name", "draft-name");
    const ctx = createHeadlessContext({
      staging: buf,
      data: createObservableDataModel({ name: "saved-name" }),
    });
    const resolved = ctx.resolveDynamic({ ref: { path: "name" } });
    expect(resolved.ref).toBe("draft-name");
  });

  it("falls back to data when a single-segment path is not in staging", () => {
    const ctx = createHeadlessContext({
      staging: createStagingBuffer(),
      data: createObservableDataModel({ name: "saved-name" }),
    });
    const resolved = ctx.resolveDynamic({ ref: { path: "name" } });
    expect(resolved.ref).toBe("saved-name");
  });

  it("resolveAction returns a NormalizedAction", () => {
    const ctx = createHeadlessContext({
      staging: createStagingBuffer(),
      data: createObservableDataModel({ user: { name: "Carol" } }),
    });
    const norm = ctx.resolveAction({
      name: "submit",
      params: { who: { path: "user/name" }, where: "form" },
    });
    expect(norm.name).toBe("submit");
    expect(norm.params.who).toBe("Carol");
    expect(norm.params.where).toBe("form");
  });

  it("runs a passing validation", () => {
    const ctx = createHeadlessContext({
      staging: createStagingBuffer(),
      data: createObservableDataModel({}),
    });
    const result = ctx.runValidation(
      { checks: [{ fn: "required", message: "Required" }] },
      "hello",
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("runs a failing validation", () => {
    const ctx = createHeadlessContext({
      staging: createStagingBuffer(),
      data: createObservableDataModel({}),
    });
    const result = ctx.runValidation(
      { checks: [{ fn: "required", message: "Required" }] },
      "",
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.message).toBe("Required");
  });

  it("resolveAction pulls staging-only field IDs from the staging buffer", () => {
    // Same staging-first-for-single-segment rule as resolveDynamic: a
    // catalog action whose params reference {path: "email"} must resolve
    // against the staging buffer, not against the data model (which is
    // what core's resolveAction would do alone).
    const buf = createStagingBuffer();
    buf.set("email", "alice@example.com");
    const ctx = createHeadlessContext({
      staging: buf,
      data: createObservableDataModel({}),
    });
    const norm = ctx.resolveAction({
      name: "send_welcome",
      params: { to: { path: "email" }, subject: "Hi" },
    });
    expect(norm.params).toEqual({
      to: "alice@example.com",
      subject: "Hi",
    });
  });

  it("resolveAction preserves confirm.variant on the NormalizedAction", () => {
    // confirm.variant distinguishes "default" vs "danger" confirmation
    // dialogs. Core passes it through in ResolvedAction.confirm and the
    // NormalizedAction type carries it, but the runtime copy in
    // resolveAction previously dropped everything except title/message.
    const ctx = createHeadlessContext({
      staging: createStagingBuffer(),
      data: createObservableDataModel({}),
    });
    const norm = ctx.resolveAction({
      name: "delete_account",
      params: {},
      confirm: {
        title: "Are you sure?",
        message: "This cannot be undone.",
        variant: "danger",
      },
    });
    expect(norm.confirm).toEqual({
      title: "Are you sure?",
      message: "This cannot be undone.",
      variant: "danger",
    });
  });

  it("staging view reads from a frozen snapshot captured at construction (Invariant 15)", () => {
    // The context is constructed once per render pass. Any write through
    // the live StagingBuffer AFTER construction must not leak into the
    // view — otherwise a hook callback that writes mid-render would
    // corrupt later elements in the same pass.
    const buf = createStagingBuffer();
    buf.set("v", "pass-start");
    const ctx = createHeadlessContext({
      staging: buf,
      data: createObservableDataModel({}),
    });
    expect(ctx.staging.get("v")).toBe("pass-start");
    // Mutate the live buffer after the context was built.
    buf.set("v", "mid-pass");
    buf.set("extra", "also-mid-pass");
    // The view still reports the pass-start snapshot.
    expect(ctx.staging.get("v")).toBe("pass-start");
    expect(ctx.staging.has("extra")).toBe(false);
    expect(ctx.staging.snapshot()).toEqual({ v: "pass-start" });
  });

  it("data view reads from a frozen snapshot captured at construction (Invariant 15)", () => {
    const data = createObservableDataModel({ user: { name: "start" } });
    const ctx = createHeadlessContext({
      staging: createStagingBuffer(),
      data,
    });
    expect(ctx.data.get("user/name")).toBe("start");
    data.set("user/name", "changed");
    expect(ctx.data.get("user/name")).toBe("start");
    expect(ctx.data.snapshot()).toEqual({ user: { name: "start" } });
  });
});
