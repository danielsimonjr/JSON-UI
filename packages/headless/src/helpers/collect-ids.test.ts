import { describe, it, expect } from "vitest";
import type { UITree } from "@json-ui/core";
import { collectFieldIds } from "./collect-ids";

describe("collectFieldIds", () => {
  it("returns an empty set for a tree with no input components", () => {
    const tree: UITree = {
      root: "r",
      elements: {
        r: { key: "r", type: "Text", props: { content: "hi" } },
      },
    };
    expect(collectFieldIds(tree)).toEqual(new Set<string>());
  });

  it("collects an id from a single input element", () => {
    const tree: UITree = {
      root: "r",
      elements: {
        r: {
          key: "r",
          type: "TextField",
          props: { id: "email", label: "Email" },
        },
      },
    };
    expect(collectFieldIds(tree)).toEqual(new Set(["email"]));
  });

  it("collects ids from a deeply nested tree", () => {
    const tree: UITree = {
      root: "root",
      elements: {
        root: {
          key: "root",
          type: "Container",
          props: {},
          children: ["a", "b"],
        },
        a: { key: "a", type: "TextField", props: { id: "name" } },
        b: { key: "b", type: "Container", props: {}, children: ["c"] },
        c: { key: "c", type: "TextField", props: { id: "address" } },
      },
    };
    expect(collectFieldIds(tree)).toEqual(new Set(["name", "address"]));
  });

  it("ignores non-string id props", () => {
    const tree: UITree = {
      root: "r",
      elements: {
        r: { key: "r", type: "TextField", props: { id: 42 } },
      },
    };
    expect(collectFieldIds(tree)).toEqual(new Set<string>());
  });

  it("treats duplicate ids as one entry in the set", () => {
    const tree: UITree = {
      root: "root",
      elements: {
        root: {
          key: "root",
          type: "Container",
          props: {},
          children: ["a", "b"],
        },
        a: { key: "a", type: "TextField", props: { id: "shared" } },
        b: { key: "b", type: "TextField", props: { id: "shared" } },
      },
    };
    expect(collectFieldIds(tree)).toEqual(new Set(["shared"]));
  });
});
