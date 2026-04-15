import { describe, it, expect } from "vitest";
import type { UITree } from "./types";
import {
  validateUniqueFieldIds,
  DuplicateFieldIdError,
} from "./validate-field-ids";

describe("validateUniqueFieldIds", () => {
  it("returns an empty set for a tree with no input components", () => {
    const tree: UITree = {
      root: "r",
      elements: {
        r: { key: "r", type: "Text", props: { content: "hi" } },
      },
    };
    expect(validateUniqueFieldIds(tree)).toEqual(new Set());
  });

  it("returns the set of unique IDs for a clean tree", () => {
    const tree: UITree = {
      root: "root",
      elements: {
        root: {
          key: "root",
          type: "Container",
          props: {},
          children: ["a", "b"],
        },
        a: { key: "a", type: "TextField", props: { id: "email" } },
        b: { key: "b", type: "TextField", props: { id: "name" } },
      },
    };
    expect(validateUniqueFieldIds(tree)).toEqual(new Set(["email", "name"]));
  });

  it("throws DuplicateFieldIdError on a collision", () => {
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
        b: { key: "b", type: "Checkbox", props: { id: "shared" } },
      },
    };
    expect(() => validateUniqueFieldIds(tree)).toThrow(DuplicateFieldIdError);
  });

  it("names both colliding element keys on the thrown error", () => {
    const tree: UITree = {
      root: "root",
      elements: {
        root: {
          key: "root",
          type: "Container",
          props: {},
          children: ["first-elem", "second-elem"],
        },
        "first-elem": {
          key: "first-elem",
          type: "TextField",
          props: { id: "dup" },
        },
        "second-elem": {
          key: "second-elem",
          type: "TextField",
          props: { id: "dup" },
        },
      },
    };
    try {
      validateUniqueFieldIds(tree);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(DuplicateFieldIdError);
      const e = err as DuplicateFieldIdError;
      expect(e.fieldId).toBe("dup");
      expect(e.firstElementKey).toBe("first-elem");
      expect(e.secondElementKey).toBe("second-elem");
      expect(e.message).toContain("dup");
      expect(e.message).toContain("first-elem");
      expect(e.message).toContain("second-elem");
    }
  });

  it("ignores non-string id props", () => {
    const tree: UITree = {
      root: "root",
      elements: {
        root: {
          key: "root",
          type: "Container",
          props: {},
          children: ["a", "b"],
        },
        a: { key: "a", type: "TextField", props: { id: 42 } },
        b: { key: "b", type: "TextField", props: { id: 42 } },
      },
    };
    // Two `id: 42` are ignored since they are not strings.
    expect(validateUniqueFieldIds(tree)).toEqual(new Set());
  });

  it("ignores empty-string ids", () => {
    const tree: UITree = {
      root: "root",
      elements: {
        root: {
          key: "root",
          type: "Container",
          props: {},
          children: ["a", "b"],
        },
        a: { key: "a", type: "TextField", props: { id: "" } },
        b: { key: "b", type: "TextField", props: { id: "" } },
      },
    };
    expect(validateUniqueFieldIds(tree)).toEqual(new Set());
  });

  it("throws on the FIRST collision encountered, not the last", () => {
    // If a tree contains three elements with IDs A, A, B, the error should
    // reference the first A-A collision, not wait to aggregate all errors.
    // This keeps the walker O(n) and gives callers actionable feedback on
    // the first problem rather than a bulk dump.
    const tree: UITree = {
      root: "root",
      elements: {
        root: {
          key: "root",
          type: "Container",
          props: {},
          children: ["e1", "e2", "e3"],
        },
        e1: { key: "e1", type: "TextField", props: { id: "A" } },
        e2: { key: "e2", type: "TextField", props: { id: "A" } },
        e3: { key: "e3", type: "TextField", props: { id: "A" } },
      },
    };
    try {
      validateUniqueFieldIds(tree);
      expect.fail("should have thrown");
    } catch (err) {
      const e = err as DuplicateFieldIdError;
      expect(e.fieldId).toBe("A");
      // The first collision is between e1 and e2, not e1 and e3.
      expect(e.firstElementKey).toBe("e1");
      expect(e.secondElementKey).toBe("e2");
    }
  });
});
