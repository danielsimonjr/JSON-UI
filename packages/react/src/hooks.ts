"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { UITree, UIElement, JsonPatch } from "@json-ui/core";
import { setByPath } from "@json-ui/core";

/**
 * Parse a single JSON patch line
 */
function parsePatchLine(line: string): JsonPatch | null {
  try {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//")) {
      return null;
    }
    return JSON.parse(trimmed) as JsonPatch;
  } catch {
    return null;
  }
}

/**
 * Apply a JSON patch to the current tree
 */
function applyPatch(tree: UITree, patch: JsonPatch): UITree {
  const newTree = { ...tree, elements: { ...tree.elements } };

  switch (patch.op) {
    case "set":
    case "add":
    case "replace": {
      // Handle root path
      if (patch.path === "/root") {
        newTree.root = patch.value as string;
        return newTree;
      }

      // Handle elements paths
      if (patch.path.startsWith("/elements/")) {
        const pathParts = patch.path.slice("/elements/".length).split("/");
        const elementKey = pathParts[0];

        if (!elementKey) return newTree;

        if (pathParts.length === 1) {
          // Setting entire element
          newTree.elements[elementKey] = patch.value as UIElement;
        } else {
          // Setting property of element
          const element = newTree.elements[elementKey];
          if (element) {
            const propPath = "/" + pathParts.slice(1).join("/");
            const newElement = { ...element };
            setByPath(
              newElement as unknown as Record<string, unknown>,
              propPath,
              patch.value,
            );
            newTree.elements[elementKey] = newElement;
          }
        }
      }
      break;
    }
    case "remove": {
      if (patch.path.startsWith("/elements/")) {
        const elementKey = patch.path.slice("/elements/".length).split("/")[0];
        if (elementKey) {
          const { [elementKey]: _, ...rest } = newTree.elements;
          newTree.elements = rest;
        }
      }
      break;
    }
  }

  return newTree;
}

/**
 * Options for useUIStream
 */
export interface UseUIStreamOptions {
  /** API endpoint */
  api: string;
  /** Callback when complete */
  onComplete?: (tree: UITree) => void;
  /** Callback on error */
  onError?: (error: Error) => void;
  /**
   * Commit mode for tree state updates.
   *
   * - `"streaming"` (default) — `setTree` fires on every parsed patch, so
   *   consumers see the tree assemble in real time. This is the original
   *   Vercel-style visual streaming behavior that existed before Plan 1 and
   *   is the right choice for UIs that want to show the LLM's output
   *   progressively. It is NOT safe for consumers that reconcile derived
   *   state against `tree` identity on every change, because reconciling
   *   against a partial tree can silently drop entries keyed on elements
   *   that have not yet streamed in.
   *
   * - `"atomic"` — `setTree` fires ONCE, after the stream completes
   *   successfully. During streaming, `tree` stays at its pre-stream value
   *   (or `null` if no previous tree). On error or abort, `tree` is left
   *   untouched. This is required by the Neural Computer runtime's
   *   staging-buffer reconciliation (NC spec Invariant 9 — "reconciliation
   *   runs only on successful tree commits, not on partial streams"). Any
   *   consumer that runs `useEffect(() => reconcile(tree), [tree])` or a
   *   similar identity-based derivation MUST use this mode.
   *
   * Defaults to `"streaming"` to preserve backward compatibility.
   */
  commitMode?: "streaming" | "atomic";
}

/**
 * Return type for useUIStream
 */
export interface UseUIStreamReturn {
  /** Current UI tree */
  tree: UITree | null;
  /** Whether currently streaming */
  isStreaming: boolean;
  /** Error if any */
  error: Error | null;
  /** Send a prompt to generate UI */
  send: (prompt: string, context?: Record<string, unknown>) => Promise<void>;
  /** Clear the current tree */
  clear: () => void;
}

/**
 * Hook for streaming UI generation
 */
export function useUIStream({
  api,
  onComplete,
  onError,
  commitMode = "streaming",
}: UseUIStreamOptions): UseUIStreamReturn {
  const [tree, setTree] = useState<UITree | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const clear = useCallback(() => {
    setTree(null);
    setError(null);
  }, []);

  const send = useCallback(
    async (prompt: string, context?: Record<string, unknown>) => {
      // Abort any existing request
      abortControllerRef.current?.abort();
      abortControllerRef.current = new AbortController();

      setIsStreaming(true);
      setError(null);

      // Start with previous tree if provided, otherwise empty tree
      const previousTree = context?.previousTree as UITree | undefined;
      let currentTree: UITree =
        previousTree && previousTree.root
          ? { ...previousTree, elements: { ...previousTree.elements } }
          : { root: "", elements: {} };
      // In streaming mode, publish the initial (empty or previous) tree so
      // consumers can render a baseline while patches arrive. In atomic
      // mode, suppress all `setTree` calls until the stream is known-good
      // — any identity-based reconciliation should only see the final
      // committed tree, never an in-flight partial (NC Invariant 9).
      const atomic = commitMode === "atomic";
      if (!atomic) setTree(currentTree);

      try {
        const response = await fetch(api, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt,
            context,
            currentTree,
          }),
          signal: abortControllerRef.current.signal,
        });

        if (!response.ok) {
          throw new Error(`HTTP error: ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error("No response body");
        }

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Process complete lines
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const patch = parsePatchLine(line);
            if (patch) {
              currentTree = applyPatch(currentTree, patch);
              if (!atomic) setTree({ ...currentTree });
            }
          }
        }

        // Process any remaining buffer
        if (buffer.trim()) {
          const patch = parsePatchLine(buffer);
          if (patch) {
            currentTree = applyPatch(currentTree, patch);
            if (!atomic) setTree({ ...currentTree });
          }
        }

        // Atomic mode: commit the fully-assembled tree to state exactly
        // once, right before firing onComplete. A consumer's useEffect on
        // [tree] will fire once with the final, validated tree — never
        // with a partial.
        if (atomic) setTree({ ...currentTree });
        onComplete?.(currentTree);
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          return;
        }
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        onError?.(error);
      } finally {
        setIsStreaming(false);
      }
    },
    [api, onComplete, onError, commitMode],
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  return {
    tree,
    isStreaming,
    error,
    send,
    clear,
  };
}

/**
 * Convert a flat element list to a UITree
 */
export function flatToTree(
  elements: Array<UIElement & { parentKey?: string | null }>,
): UITree {
  const elementMap: Record<string, UIElement> = {};
  let root = "";

  // First pass: add all elements to map
  for (const element of elements) {
    elementMap[element.key] = {
      key: element.key,
      type: element.type,
      props: element.props,
      children: [],
      visible: element.visible,
    };
  }

  // Second pass: build parent-child relationships
  for (const element of elements) {
    if (element.parentKey) {
      const parent = elementMap[element.parentKey];
      if (parent) {
        if (!parent.children) {
          parent.children = [];
        }
        parent.children.push(element.key);
      }
    } else {
      root = element.key;
    }
  }

  return { root, elements: elementMap };
}
