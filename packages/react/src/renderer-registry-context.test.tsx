import { describe, it, expect } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { JSONUIProvider, Renderer, type ComponentRegistry } from "./renderer";
import type { UITree } from "@json-ui/core";

const tree: UITree = {
  root: "t",
  elements: {
    t: { key: "t", type: "text", props: { content: "hello" } },
  },
};

const registry: ComponentRegistry = {
  text: ({ element }) =>
    React.createElement(
      "span",
      { "data-testid": "txt" },
      String((element.props as { content?: string }).content ?? ""),
    ),
};

describe("Renderer registry context", () => {
  it("inherits registry from JSONUIProvider so the prop is not required twice", () => {
    render(
      <JSONUIProvider registry={registry}>
        <Renderer tree={tree} />
      </JSONUIProvider>,
    );
    expect(screen.getByTestId("txt").textContent).toBe("hello");
  });

  it("lets an explicit registry prop win over the provider", () => {
    const override: ComponentRegistry = {
      text: ({ element }) =>
        React.createElement(
          "span",
          { "data-testid": "override" },
          String((element.props as { content?: string }).content ?? ""),
        ),
    };
    render(
      <JSONUIProvider registry={registry}>
        <Renderer tree={tree} registry={override} />
      </JSONUIProvider>,
    );
    expect(screen.getByTestId("override")).toBeTruthy();
  });

  it("throws when neither a prop nor a provider registry is present", () => {
    expect(() => render(<Renderer tree={tree} />)).toThrow(/registry/);
  });
});
