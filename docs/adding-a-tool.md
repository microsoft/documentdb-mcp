# Adding a New Tool

The MCP server exposes tools through a small declarative registry in
[`src/tools/registry.ts`](../src/tools/registry.ts) and an aggregator in
[`src/tools/index.ts`](../src/tools/index.ts). Adding a new tool — even a
complex query — is a single-file change in most cases.

## TL;DR

1. Author a `ToolDefinition` (typically inside an existing category file such
   as [`src/tools/document-tools.ts`](../src/tools/document-tools.ts), or in a
   new category file you create yourself).
2. If you created a new category file, add its exported array to
   [`allToolDefinitions`](../src/tools/index.ts).

That's it. `server.ts`, `withDbGuard`, the audit pipeline, RBAC checks,
per-profile resource scope, pipeline-namespace scope, full-collection write
protection and `server.registerTool` wiring are all applied automatically.

## The shape

```ts
import { defineTool, type ToolDefinition } from './registry';
import { z } from 'zod';
import { connectionProfileSchema } from './utils/toolSecurity';
import { serializeResponse } from './utils/limits';

export const myToolDefinitions: ToolDefinition[] = [
    defineTool({
        name: 'top_n_by_field',                    // unique MCP tool id
        title: 'Top N By Field',                   // shown in tool listings
        description: 'Return the top N documents sorted by `field` desc.',
        requiredRole: 'read',                      // read | write | management
        inputSchema: {
            connection_profile: connectionProfileSchema,
            db_name: z.string(),
            collection_name: z.string(),
            field: z.string(),
            n: z.number().int().positive().default(10),
        },
        handler: async ({ db_name, collection_name, field, n }, client) => {
            const docs = await client
                .db(db_name)
                .collection(collection_name)
                .find({})
                .sort({ [field]: -1 })
                .limit(n)
                .toArray();
            return serializeResponse({ documents: docs });
        },
    }),
];
```

Then export the array from your file and add it to the aggregator:

```ts
// src/tools/index.ts
import { myToolDefinitions } from './my-tools';

export const allToolDefinitions: ReadonlyArray<ToolDefinition> = [
    ...databaseToolDefinitions,
    ...collectionToolDefinitions,
    ...documentToolDefinitions,
    ...indexToolDefinitions,
    ...myToolDefinitions,   // ← add here
];
```

## What you do **not** need to touch

- **`server.ts`** — `registerAllTools(server)` walks the aggregated list.
- **`withDbGuard`** — `registerToolDefinitions` wraps every handler for you.
- **Audit / RBAC / scope checks** — driven by `requiredRole` and the standard
  `connection_profile` / `db_name` / `collection_name` fields on the input.
- **MCP plumbing** — the `{ title, description, inputSchema }` descriptor is
  forwarded to `server.registerTool` automatically.

## Conventions that the security layer relies on

The shared `withDbGuard` wrapper inspects well-known input fields. When your
tool exposes any of them, prefer the documented names so the guards engage:

| Field                                  | Effect                                                                                   |
| -------------------------------------- | ---------------------------------------------------------------------------------------- |
| `connection_profile`                   | **Required.** Resolves the backend connection and per-profile policy.                    |
| `db_name`, `collection_name`           | Checked against the profile's `allowedDatabases` / `allowedCollections` / deny lists.    |
| `new_collection_name`                  | Same scope check, applied to the rename target.                                          |
| `pipeline` (+ optional `operation`)    | Triggers `assertPipelineNamespacesAllowed` for every namespace in the pipeline.          |
| `filter`, `multi`, `confirm_full_collection_operation` | Triggers full-collection write/delete protection on `update_documents` / `delete_documents`. |

Tools that don't expose these fields simply skip the corresponding guard.
