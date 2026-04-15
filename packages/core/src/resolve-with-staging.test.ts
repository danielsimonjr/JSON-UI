import { describe, it, expect } from "vitest";
import {
  resolveStagingOrDataPath,
  isDynamicPathLiteral,
  preResolveDynamicParams,
  resolveActionWithStaging,
} from "./resolve-with-staging";

describe("resolveStagingOrDataPath", () => {
  it("returns staging value for a single-segment path present in staging", () => {
    expect(
      resolveStagingOrDataPath("email", { email: "a@b.c" }, { email: "stale" }),
    ).toBe("a@b.c");
  });

  it("falls back to data for a single-segment path absent from staging", () => {
    expect(
      resolveStagingOrDataPath("email", {}, { email: "a@b.c" }),
    ).toBe("a@b.c");
  });

  it("always uses data for a slashed path, even if staging has the full key", () => {
    // "user/name" as a literal staging key would never happen in practice
    // (staging is keyed by flat field IDs), but the rule is deterministic:
    // slashed paths go straight to data.
    expect(
      resolveStagingOrDataPath(
        "user/name",
        { "user/name": "from-staging" } as never,
        { user: { name: "from-data" } },
      ),
    ).toBe("from-data");
  });

  it("returns undefined when neither source has the path", () => {
    expect(resolveStagingOrDataPath("missing", {}, {})).toBeUndefined();
  });

  it("accepts a Map<FieldId, unknown> as the staging source", () => {
    const staging = new Map<string, unknown>([["email", "from-map"]]);
    expect(resolveStagingOrDataPath("email", staging, {})).toBe("from-map");
  });

  it("treats staging=undefined as 'fall straight to data'", () => {
    expect(
      resolveStagingOrDataPath("user/name", undefined, {
        user: { name: "only-data" },
      }),
    ).toBe("only-data");
  });
});

describe("isDynamicPathLiteral", () => {
  it("recognizes a plain {path: string} object", () => {
    expect(isDynamicPathLiteral({ path: "foo" })).toBe(true);
  });

  it("rejects a literal with non-string path", () => {
    expect(isDynamicPathLiteral({ path: 42 })).toBe(false);
  });

  it("rejects null, arrays, primitives", () => {
    expect(isDynamicPathLiteral(null)).toBe(false);
    expect(isDynamicPathLiteral(["path"])).toBe(false);
    expect(isDynamicPathLiteral("path")).toBe(false);
    expect(isDynamicPathLiteral(42)).toBe(false);
    expect(isDynamicPathLiteral(undefined)).toBe(false);
  });
});

describe("preResolveDynamicParams", () => {
  it("substitutes a DynamicValue path that matches a staging field id", () => {
    const out = preResolveDynamicParams(
      { to: { path: "email" } },
      { email: "alice@example.com" },
      {},
    );
    expect(out).toEqual({ to: "alice@example.com" });
  });

  it("passes literal params through unchanged", () => {
    const out = preResolveDynamicParams(
      { to: "fixed@example.com", subject: "Hi" },
      { email: "alice@example.com" },
      {},
    );
    expect(out).toEqual({ to: "fixed@example.com", subject: "Hi" });
  });

  it("leaves slashed DynamicValue paths for data-model resolution", () => {
    const out = preResolveDynamicParams(
      { who: { path: "user/name" } },
      { "user/name": "bogus" } as never,
      { user: { name: "Carol" } },
    );
    expect(out).toEqual({ who: "Carol" });
  });

  it("returns an empty record when params is undefined", () => {
    expect(preResolveDynamicParams(undefined, {}, {})).toEqual({});
  });

  it("resolves a miss to undefined", () => {
    const out = preResolveDynamicParams(
      { missing: { path: "never-set" } },
      {},
      {},
    );
    expect(out).toEqual({ missing: undefined });
  });
});

describe("resolveActionWithStaging", () => {
  it("resolves a staging-only DynamicValue in params", () => {
    const resolved = resolveActionWithStaging(
      {
        name: "send_welcome",
        params: { to: { path: "email" }, subject: "Hi" },
      },
      { email: "alice@example.com" },
      {},
    );
    expect(resolved.name).toBe("send_welcome");
    expect(resolved.params).toEqual({
      to: "alice@example.com",
      subject: "Hi",
    });
  });

  it("resolves a data-model DynamicValue in params", () => {
    const resolved = resolveActionWithStaging(
      {
        name: "greet",
        params: { who: { path: "user/name" } },
      },
      {},
      { user: { name: "Carol" } },
    );
    expect(resolved.params).toEqual({ who: "Carol" });
  });

  it("prefers staging over data for a colliding single-segment path", () => {
    const resolved = resolveActionWithStaging(
      { name: "ping", params: { who: { path: "name" } } },
      { name: "staged" },
      { name: "persisted" },
    );
    expect(resolved.params).toEqual({ who: "staged" });
  });

  it("preserves confirm.variant on the resolved action (regression from Plan 3 bug)", () => {
    const resolved = resolveActionWithStaging(
      {
        name: "delete_account",
        params: {},
        confirm: {
          title: "Are you sure?",
          message: "This cannot be undone.",
          variant: "danger",
        },
      },
      {},
      {},
    );
    expect(resolved.confirm).toEqual({
      title: "Are you sure?",
      message: "This cannot be undone.",
      variant: "danger",
    });
  });

  it("interpolates ${path} in confirm.title and confirm.message against the data model", () => {
    // interpolateString delegates to `getByPath`, which uses slash-separated
    // paths. Matching that convention for the template here.
    const resolved = resolveActionWithStaging(
      {
        name: "delete_thing",
        params: {},
        confirm: {
          title: "Delete ${thing/name}?",
          message: "This will remove ${thing/name} permanently.",
        },
      },
      {},
      { thing: { name: "Widget" } },
    );
    expect(resolved.confirm?.title).toBe("Delete Widget?");
    expect(resolved.confirm?.message).toBe(
      "This will remove Widget permanently.",
    );
  });

  it("omits confirm entirely when the source action has no confirm field", () => {
    const resolved = resolveActionWithStaging(
      { name: "ping", params: {} },
      {},
      {},
    );
    expect(resolved.confirm).toBeUndefined();
  });
});
