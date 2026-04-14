import { describe, it, expect, vi } from "vitest";
import { noopHooks, composeHooks, type RenderHooks } from "./hooks";

describe("noopHooks", () => {
  it("provides a no-throw implementation of every hook field", () => {
    const calls = (
      [
        "onBeforeRender",
        "onAfterRender",
        "onElementRender",
        "onActionDispatched",
        "onStagingChange",
        "onDataChange",
        "onError",
      ] as const
    ).map((k) => () => (noopHooks[k] as (e: unknown) => void)({}));
    for (const fn of calls) {
      expect(fn).not.toThrow();
    }
  });
});

describe("composeHooks", () => {
  it("calls every partial in order on every hook field", () => {
    const a = vi.fn();
    const b = vi.fn();
    const merged = composeHooks({ onBeforeRender: a }, { onBeforeRender: b });
    merged.onBeforeRender({
      passId: 1,
      tree: { root: "r", elements: {} },
      state: { staging: {}, data: {} },
      timestamp: 1,
    });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("falls back to noop for fields no partial provides", () => {
    const merged = composeHooks({ onBeforeRender: vi.fn() });
    expect(() =>
      merged.onAfterRender({
        passId: 1,
        tree: { root: "r", elements: {} },
        result: { key: "r", type: "x", props: {}, children: [] },
        elapsedMs: 0,
        timestamp: 1,
      }),
    ).not.toThrow();
  });

  it("composes multiple partials left-to-right per field", () => {
    const log: string[] = [];
    const merged = composeHooks(
      { onElementRender: () => log.push("first") },
      { onElementRender: () => log.push("second") },
      { onElementRender: () => log.push("third") },
    );
    merged.onElementRender({
      passId: 1,
      elementKey: "k",
      elementType: "Text",
      result: { key: "k", type: "Text", props: {}, children: [] },
      timestamp: 1,
    });
    expect(log).toEqual(["first", "second", "third"]);
  });

  it("isolates a throwing hook so other composed hooks still fire", () => {
    const a = vi.fn(() => {
      throw new Error("a-blew-up");
    });
    const b = vi.fn();
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const merged = composeHooks({ onBeforeRender: a }, { onBeforeRender: b });
    merged.onBeforeRender({
      passId: 1,
      tree: { root: "r", elements: {} },
      state: { staging: {}, data: {} },
      timestamp: 1,
    });
    expect(a).toHaveBeenCalled();
    expect(b).toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});
