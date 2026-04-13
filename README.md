# JSON-UI

A constrained JSON-to-UI library for LLM-driven applications. Define a component catalog with Zod schemas, and the LLM can only produce JSON that matches it. Your app renders the validated tree safely.

```bash
npm install @json-ui/core @json-ui/react
```

## Why

When an LLM generates a user interface, the output space needs to be constrained. JSON-UI gives the model a catalog of typed components and a validator at the boundary: anything the model emits is either schema-valid or rejected. Nothing in between. That is the only way to put generative UI in front of real users without inviting prompt injection.

The library is organized as three layers:

1. **Core schemas** (`@json-ui/core`) — Zod-typed catalog, tree format, actions, validation, and visibility. Framework-agnostic. No React dependency.
2. **React renderer** (`@json-ui/react`) — renders a validated tree as React components, with providers for data binding, action dispatch, and conditional visibility.
3. **Headless renderer** (future) — renders the same tree to an HTML string, JSON output, or a terminal UI. No browser required. Useful for server-side rendering, testing, and non-React runtimes.

## Quick start

```typescript
import { createCatalog } from "@json-ui/core";
import { z } from "zod";

const catalog = createCatalog({
  components: {
    Card: {
      props: z.object({ title: z.string() }),
      hasChildren: true,
    },
    Metric: {
      props: z.object({
        label: z.string(),
        valuePath: z.string(),
        format: z.enum(["currency", "percent", "number"]),
      }),
    },
    Button: {
      props: z.object({
        label: z.string(),
        action: z.any(),
      }),
    },
  },
  actions: {
    refresh: { description: "Refresh data" },
  },
});
```

Your renderer registers components against the catalog and the LLM produces JSON that can only use the components you defined. Validation happens at the boundary; everything downstream is typed.

## Status

Early fork. Identity rewritten, lightweight structure, no monorepo plumbing (npm workspaces only, no pnpm or turbo). The React backend is inherited from the upstream and works. A headless renderer is planned as the next addition.

## Prior art

JSON-UI stands on work done by two earlier projects and credits them explicitly:

- **[Vercel Labs' `json-render`](https://github.com/vercel-labs/json-render)** — the original constrained-catalog approach with Zod schemas, rich actions, and React streaming. This repo started as a fork and inherits the core schemas and React renderer directly.
- **[Google's A2UI](https://github.com/google-agentic-commerce/a2ui)** — the framework-agnostic / portable philosophy, flat ID-based tree representation suitable for incremental LLM generation, and multi-client renderer pattern. JSON-UI's plan to add a headless renderer alongside React is inspired by A2UI's approach.

If you are building for production and do not need the divergence, consider using `json-render` or `a2ui` directly.

## License

Apache-2.0. See [LICENSE](./LICENSE).
