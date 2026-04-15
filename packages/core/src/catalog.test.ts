import { describe, it, expect } from "vitest";
import { z } from "zod";
import { createCatalog, generateCatalogPrompt } from "./catalog";

describe("createCatalog", () => {
  it("creates catalog with components", () => {
    const catalog = createCatalog({
      components: {
        text: {
          props: z.object({ content: z.string() }),
          description: "Display text",
        },
        button: {
          props: z.object({ label: z.string() }),
          description: "A clickable button",
        },
      },
    });

    expect(catalog.componentNames).toHaveLength(2);
    expect(catalog.hasComponent("text")).toBe(true);
    expect(catalog.hasComponent("button")).toBe(true);
    expect(catalog.hasComponent("unknown")).toBe(false);
  });

  it("creates catalog with actions", () => {
    const catalog = createCatalog({
      components: {
        button: { props: z.object({ label: z.string() }) },
      },
      actions: {
        navigate: { description: "Navigate to URL" },
        submit: { description: "Submit form" },
      },
    });

    expect(catalog.actionNames).toHaveLength(2);
    expect(catalog.hasAction("navigate")).toBe(true);
    expect(catalog.hasAction("submit")).toBe(true);
    expect(catalog.hasAction("unknown")).toBe(false);
  });

  it("creates catalog with custom validation functions", () => {
    const catalog = createCatalog({
      components: {
        input: { props: z.object({ value: z.string() }) },
      },
      functions: {
        customValidator: (value) =>
          typeof value === "string" && value.length > 0,
      },
    });

    expect(catalog.functionNames).toHaveLength(1);
    expect(catalog.hasFunction("customValidator")).toBe(true);
  });

  it("validates elements correctly", () => {
    const catalog = createCatalog({
      components: {
        text: {
          props: z.object({ content: z.string() }),
        },
      },
    });

    const validElement = {
      key: "1",
      type: "text",
      props: { content: "Hello" },
    };
    const invalidElement = {
      key: "1",
      type: "text",
      props: { content: 123 },
    };

    expect(catalog.validateElement(validElement).success).toBe(true);
    expect(catalog.validateElement(invalidElement).success).toBe(false);
  });

  it("validates UI trees", () => {
    const catalog = createCatalog({
      components: {
        text: { props: z.object({ content: z.string() }) },
      },
    });

    const validTree = {
      root: "1",
      elements: {
        "1": { key: "1", type: "text", props: { content: "Hello" } },
      },
    };

    expect(catalog.validateTree(validTree).success).toBe(true);
  });

  it("uses default name when not provided", () => {
    const catalog = createCatalog({
      components: {
        text: { props: z.object({ content: z.string() }) },
      },
    });

    expect(catalog.name).toBe("unnamed");
  });

  it("uses provided name", () => {
    const catalog = createCatalog({
      name: "MyCatalog",
      components: {
        text: { props: z.object({ content: z.string() }) },
      },
    });

    expect(catalog.name).toBe("MyCatalog");
  });

  it("validateTree rejects a tree with duplicate field IDs (NC Invariant 8)", () => {
    // Field-ID uniqueness is a catalog-level guarantee for the Neural
    // Computer runtime's staging-buffer reconciliation. Two input
    // components sharing the same `id` would cause last-write-wins
    // corruption of the buffer. validateTree must catch this before
    // the tree is committed.
    const catalog = createCatalog({
      components: {
        TextField: {
          props: z.object({ id: z.string(), label: z.string() }),
        },
      },
    });

    const treeWithDuplicates = {
      root: "root",
      elements: {
        root: {
          key: "root",
          type: "TextField",
          props: { id: "email", label: "Primary" },
        },
        // second element reusing the same id but a different element key
        other: {
          key: "other",
          type: "TextField",
          props: { id: "email", label: "Secondary" },
        },
      },
    };

    const result = catalog.validateTree(treeWithDuplicates);
    expect(result.success).toBe(false);
    expect(result.error).toBeUndefined(); // Zod succeeded, only uniqueness failed
    expect(result.fieldIdError).toBeDefined();
    expect(result.fieldIdError?.fieldId).toBe("email");
    expect(result.fieldIdError?.name).toBe("DuplicateFieldIdError");
    // Element keys of the two colliding elements are both named.
    expect(result.fieldIdError?.firstElementKey).toBe("root");
    expect(result.fieldIdError?.secondElementKey).toBe("other");
  });

  it("validateTree still surfaces Zod failures on malformed trees", () => {
    // Sanity check: the new uniqueness check doesn't shadow Zod-level
    // structural errors. If Zod parse fails, error is the ZodError and
    // fieldIdError is undefined (we bailed before the uniqueness pass).
    const catalog = createCatalog({
      components: {
        TextField: {
          props: z.object({ id: z.string(), label: z.string() }),
        },
      },
    });

    const treeWithBadProps = {
      root: "r",
      elements: {
        r: {
          key: "r",
          type: "TextField",
          // missing `label`, so Zod parse of the props schema fails
          props: { id: "email" },
        },
      },
    };

    const result = catalog.validateTree(treeWithBadProps);
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.fieldIdError).toBeUndefined();
  });

  it("validateTree is a no-op uniqueness check for catalogs without id props", () => {
    // Non-input catalogs (display-only) should see zero overhead and
    // always pass the uniqueness pass. The walker looks only at
    // string-typed id props and returns an empty set for display
    // components.
    const catalog = createCatalog({
      components: {
        Text: { props: z.object({ content: z.string() }) },
      },
    });

    const validTree = {
      root: "1",
      elements: {
        "1": { key: "1", type: "Text", props: { content: "hello" } },
        "2": { key: "2", type: "Text", props: { content: "world" } },
      },
    };

    const result = catalog.validateTree(validTree);
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.fieldIdError).toBeUndefined();
  });
});

describe("generateCatalogPrompt", () => {
  it("generates prompt containing catalog name", () => {
    const catalog = createCatalog({
      name: "TestCatalog",
      components: {
        text: {
          props: z.object({ content: z.string() }),
          description: "Display text content",
        },
      },
    });

    const prompt = generateCatalogPrompt(catalog);

    expect(prompt).toContain("TestCatalog");
  });

  it("includes component descriptions", () => {
    const catalog = createCatalog({
      components: {
        text: {
          props: z.object({ content: z.string() }),
          description: "Display text content",
        },
      },
    });

    const prompt = generateCatalogPrompt(catalog);

    expect(prompt).toContain("text");
    expect(prompt).toContain("Display text content");
  });

  it("includes action descriptions", () => {
    const catalog = createCatalog({
      components: {
        button: { props: z.object({ label: z.string() }) },
      },
      actions: {
        alert: { description: "Show alert message" },
      },
    });

    const prompt = generateCatalogPrompt(catalog);

    expect(prompt).toContain("alert");
    expect(prompt).toContain("Show alert message");
  });

  it("includes visibility documentation", () => {
    const catalog = createCatalog({
      components: {
        text: { props: z.object({ content: z.string() }) },
      },
    });

    const prompt = generateCatalogPrompt(catalog);

    expect(prompt).toContain("Visibility");
    expect(prompt).toContain("visible");
  });

  it("includes validation documentation", () => {
    const catalog = createCatalog({
      components: {
        text: { props: z.object({ content: z.string() }) },
      },
    });

    const prompt = generateCatalogPrompt(catalog);

    expect(prompt).toContain("Validation");
    expect(prompt).toContain("required");
    expect(prompt).toContain("email");
  });
});
