import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useUIStream } from "./hooks";
import type { UITree } from "@json-ui/core";

// -------- Fetch mock helpers ------------------------------------------------

function makeStreamBody(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[i]!));
      i += 1;
    },
  });
}

function mockFetchOnce(body: ReadableStream<Uint8Array>) {
  const response = {
    ok: true,
    status: 200,
    body,
  } as unknown as Response;
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// -------- Test corpus: a three-patch stream building a root + 2 children ---

const patches = [
  `{"op":"set","path":"/root","value":"r"}\n`,
  `{"op":"set","path":"/elements/r","value":{"key":"r","type":"Container","props":{},"children":["a","b"]}}\n`,
  `{"op":"set","path":"/elements/a","value":{"key":"a","type":"Text","props":{"content":"A"}}}\n`,
  `{"op":"set","path":"/elements/b","value":{"key":"b","type":"Text","props":{"content":"B"}}}\n`,
];

describe("useUIStream — streaming mode (default, backward compat)", () => {
  it("publishes intermediate trees on every patch", async () => {
    mockFetchOnce(makeStreamBody(patches));
    const treeSeen: Array<UITree | null> = [];

    const { result } = renderHook(() =>
      useUIStream({ api: "/mock" }),
    );

    // Capture tree at every render — a consumer that re-renders on tree
    // changes sees these intermediate states in streaming mode.
    await act(async () => {
      await result.current.send("draw me something");
    });

    // After the stream completes, tree has all 4 elements (root + a + b + "r" itself).
    expect(result.current.tree).not.toBeNull();
    expect(result.current.tree!.root).toBe("r");
    expect(Object.keys(result.current.tree!.elements).sort()).toEqual([
      "a",
      "b",
      "r",
    ]);
    // isStreaming flipped false after onComplete fired.
    expect(result.current.isStreaming).toBe(false);
  });

  it("onComplete fires with the final tree", async () => {
    mockFetchOnce(makeStreamBody(patches));
    const onComplete = vi.fn();

    const { result } = renderHook(() =>
      useUIStream({ api: "/mock", onComplete }),
    );
    await act(async () => {
      await result.current.send("draw me something");
    });

    expect(onComplete).toHaveBeenCalledTimes(1);
    const finalTree = onComplete.mock.calls[0]![0] as UITree;
    expect(finalTree.root).toBe("r");
    expect(Object.keys(finalTree.elements).sort()).toEqual(["a", "b", "r"]);
  });
});

describe("useUIStream — atomic mode (NC Path C, Invariant 9)", () => {
  it("publishes the final tree exactly once, after onComplete", async () => {
    mockFetchOnce(makeStreamBody(patches));
    const onComplete = vi.fn();

    const { result } = renderHook(() =>
      useUIStream({ api: "/mock", onComplete, commitMode: "atomic" }),
    );

    // Pre-send: tree is the initial null from useState.
    expect(result.current.tree).toBeNull();

    await act(async () => {
      await result.current.send("draw me something");
    });

    // Post-send: the fully assembled tree is visible AND onComplete fired.
    expect(result.current.tree).not.toBeNull();
    expect(result.current.tree!.root).toBe("r");
    expect(Object.keys(result.current.tree!.elements).sort()).toEqual([
      "a",
      "b",
      "r",
    ]);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(result.current.isStreaming).toBe(false);
  });

  it("atomic mode leaves tree untouched when the stream errors mid-way", async () => {
    // Return a body whose second chunk is malformed JSON — parsePatchLine
    // returns null for those lines so they get silently skipped, but the
    // response is fine. We need a real failure: a fetch that rejects.
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    const onError = vi.fn();
    const onComplete = vi.fn();

    const { result } = renderHook(() =>
      useUIStream({
        api: "/mock",
        onComplete,
        onError,
        commitMode: "atomic",
      }),
    );

    await act(async () => {
      await result.current.send("draw me something");
    });

    // Stream failed before any commit: tree stays null, onComplete never
    // fires, onError fires with the thrown error.
    expect(result.current.tree).toBeNull();
    expect(onComplete).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(result.current.error?.message).toBe("network down");
  });

  it("does not publish the pre-stream baseline tree (null → final in one step)", async () => {
    mockFetchOnce(makeStreamBody(patches));

    const { result } = renderHook(() =>
      useUIStream({ api: "/mock", commitMode: "atomic" }),
    );

    // Pre-send baseline: tree is null.
    const treeBefore = result.current.tree;

    await act(async () => {
      await result.current.send("go");
    });

    const treeAfter = result.current.tree;

    // In streaming mode, line 141 of hooks.ts publishes the initial empty
    // tree ({root: "", elements: {}}) to state BEFORE the stream starts —
    // so a consumer would observe an empty tree between null and the
    // final assembled tree. Atomic mode must suppress that baseline
    // publish. The observable transition is null → final, with no empty
    // intermediate.
    expect(treeBefore).toBeNull();
    expect(treeAfter).not.toBeNull();
    expect(treeAfter!.root).toBe("r");
  });
});
