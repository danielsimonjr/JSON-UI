"use client";

import React, { type ComponentType, type ReactNode, useMemo } from "react";
import type {
  UIElement,
  UITree,
  Action,
  Catalog,
  ComponentDefinition,
} from "@json-ui/core";
import { useIsVisible } from "./contexts/visibility";
import { useActions } from "./contexts/actions";
import { useData } from "./contexts/data";

/**
 * Props passed to component renderers
 */
export interface ComponentRenderProps<P = Record<string, unknown>> {
  /** The element being rendered */
  element: UIElement<string, P>;
  /** Rendered children */
  children?: ReactNode;
  /** Execute an action */
  onAction?: (action: Action) => void;
  /** Whether the parent is loading */
  loading?: boolean;
}

/**
 * Component renderer type
 */
export type ComponentRenderer<P = Record<string, unknown>> = ComponentType<
  ComponentRenderProps<P>
>;

/**
 * Registry of component renderers
 */
export type ComponentRegistry = Record<string, ComponentRenderer<any>>;

/**
 * Props for the Renderer component
 */
export interface RendererProps {
  /** The UI tree to render */
  tree: UITree | null;
  /** Component registry */
  registry: ComponentRegistry;
  /** Whether the tree is currently loading/streaming */
  loading?: boolean;
  /** Fallback component for unknown types */
  fallback?: ComponentRenderer;
}

/**
 * Element renderer component
 */
function ElementRenderer({
  element,
  tree,
  registry,
  loading,
  fallback,
}: {
  element: UIElement;
  tree: UITree;
  registry: ComponentRegistry;
  loading?: boolean;
  fallback?: ComponentRenderer;
}) {
  const isVisible = useIsVisible(element.visible);
  const { execute } = useActions();

  // Don't render if not visible
  if (!isVisible) {
    return null;
  }

  // Get the component renderer
  const Component = registry[element.type] ?? fallback;

  if (!Component) {
    console.warn(`No renderer for component type: ${element.type}`);
    return null;
  }

  // Render children
  const children = element.children?.map((childKey) => {
    const childElement = tree.elements[childKey];
    if (!childElement) {
      return null;
    }
    return (
      <ElementRenderer
        key={childKey}
        element={childElement}
        tree={tree}
        registry={registry}
        loading={loading}
        fallback={fallback}
      />
    );
  });

  return (
    <Component element={element} onAction={execute} loading={loading}>
      {children}
    </Component>
  );
}

/**
 * Main renderer component
 */
export function Renderer({ tree, registry, loading, fallback }: RendererProps) {
  if (!tree || !tree.root) {
    return null;
  }

  const rootElement = tree.elements[tree.root];
  if (!rootElement) {
    return null;
  }

  return (
    <ElementRenderer
      element={rootElement}
      tree={tree}
      registry={registry}
      loading={loading}
      fallback={fallback}
    />
  );
}

/**
 * Props for JSONUIProvider
 */
export interface JSONUIProviderProps {
  /** Component registry */
  registry: ComponentRegistry;
  /** Initial data model — ignored when `store` is provided. */
  initialData?: Record<string, unknown>;
  /**
   * Optional external `ObservableDataModel` to back the nested
   * `DataProvider` in external-store mode. When provided, reads and
   * writes flow through the store via `useSyncExternalStore`, and
   * `initialData` is silently ignored. The Neural Computer runtime's
   * "Path C" integration passes a memoryjs-backed adapter here so the
   * React renderer and a parallel headless-renderer session can share
   * one durable-state source.
   *
   * Without this prop, the nested `DataProvider` runs in its original
   * `useState`-based internal mode, preserving backward compatibility
   * with every existing caller.
   */
  store?: ObservableDataModel;
  /**
   * Optional external `StagingBuffer` to mount via `StagingProvider`
   * inside the provider tree. When provided, the `useStaging` /
   * `useStagingField` / `useStagingSnapshot` hooks work anywhere below
   * this boundary without the caller having to hand-mount a separate
   * `StagingProvider`. NC's Path C integration passes a buffer that is
   * ALSO consumed by a headless renderer session running for the LLM
   * Observer, so both backends see each other's writes.
   *
   * When absent, no `StagingProvider` is mounted; `useStaging()` will
   * throw if called. Existing callers that don't need staging see no
   * change.
   */
  stagingStore?: StagingBuffer;
  /** Auth state */
  authState?: { isSignedIn: boolean; user?: Record<string, unknown> };
  /** Action handlers */
  actionHandlers?: Record<
    string,
    (params: Record<string, unknown>) => Promise<unknown> | unknown
  >;
  /** Navigation function */
  navigate?: (path: string) => void;
  /** Custom validation functions */
  validationFunctions?: Record<
    string,
    (value: unknown, args?: Record<string, unknown>) => boolean
  >;
  /** Callback when data changes */
  onDataChange?: (path: string, value: unknown) => void;
  children: ReactNode;
}

// Import the providers
import type {
  ObservableDataModel,
  StagingBuffer,
} from "@json-ui/core";
import { DataProvider } from "./contexts/data";
import { StagingProvider } from "./contexts/staging";
import { VisibilityProvider } from "./contexts/visibility";
import { ActionProvider } from "./contexts/actions";
import { ValidationProvider } from "./contexts/validation";
import { ConfirmDialog } from "./contexts/actions";

/**
 * Combined provider for all JSONUI contexts. See `JSONUIProviderProps`
 * for the `store` and `stagingStore` props added for NC Path C.
 */
export function JSONUIProvider({
  registry,
  initialData,
  store,
  stagingStore,
  authState,
  actionHandlers,
  navigate,
  validationFunctions,
  onDataChange,
  children,
}: JSONUIProviderProps) {
  // Wrap in StagingProvider inside the inner subtree only when the
  // caller supplied a buffer. Mounting StagingProvider unconditionally
  // would silently create a disposable buffer that no one else shares,
  // masking wiring mistakes; an explicit opt-in is safer.
  const stagedChildren =
    stagingStore !== undefined ? (
      <StagingProvider store={stagingStore}>{children}</StagingProvider>
    ) : (
      children
    );

  return (
    <DataProvider
      initialData={initialData}
      store={store}
      authState={authState}
      onDataChange={onDataChange}
    >
      <VisibilityProvider>
        <ActionProvider handlers={actionHandlers} navigate={navigate}>
          <ValidationProvider customFunctions={validationFunctions}>
            {stagedChildren}
            <ConfirmationDialogManager />
          </ValidationProvider>
        </ActionProvider>
      </VisibilityProvider>
    </DataProvider>
  );
}

/**
 * Renders the confirmation dialog when needed
 */
function ConfirmationDialogManager() {
  const { pendingConfirmation, confirm, cancel } = useActions();

  if (!pendingConfirmation?.action.confirm) {
    return null;
  }

  return (
    <ConfirmDialog
      confirm={pendingConfirmation.action.confirm}
      onConfirm={confirm}
      onCancel={cancel}
    />
  );
}

/**
 * Helper to create a renderer component from a catalog
 */
export function createRendererFromCatalog<
  C extends Catalog<Record<string, ComponentDefinition>>,
>(
  _catalog: C,
  registry: ComponentRegistry,
): ComponentType<Omit<RendererProps, "registry">> {
  return function CatalogRenderer(props: Omit<RendererProps, "registry">) {
    return <Renderer {...props} registry={registry} />;
  };
}
