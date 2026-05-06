# DocumentDB MCP Server

> **Public preview.** This server is in public preview. Interfaces, configuration, and tool behavior may change without notice. Do not use it in production without your own review.

DocumentDB MCP Server is a tools-only Model Context Protocol server for Azure Cosmos DB for MongoDB vCore and other MongoDB-compatible DocumentDB deployments. It exposes stateless database, collection, index, and document tools through MCP while keeping database connection details under server administrator control.

Every tool call uses a configured `connection_profile`. Tools do not accept runtime database connection strings, and production deployments can use Microsoft Entra ID / OIDC backend authentication so the server does not need a database password.

## Installation

Node.js 20 or later is required. The server is not yet published to a public package registry, so install it directly from this repository.

### Run from source

```bash
git clone https://github.com/microsoft/documentdb-mcp.git
cd documentdb-mcp
npm install
npm run build
node dist/main.js
```

For local development with watch mode:

```bash
npm install
npm run dev
```

### Run with `npx` from GitHub

For MCP clients that spawn a server over stdio (Copilot CLI, Claude Desktop, VS Code), `npx` can fetch and run the server directly from this repository:

```bash
npx -y github:microsoft/documentdb-mcp
```

See [MCP Client Quickstart](#mcp-client-quickstart) for client configuration examples.

## MCP Client Quickstart

For local development with an MCP client, run the server over stdio with a single connection profile. The server uses an existing `CONNECTION_PROFILES` JSON value (or a file via `CONNECTION_PROFILES_FILE`) to choose the backend; tools never accept connection strings as MCP arguments.

Set these environment variables in the client config below to match your environment:

- `TRANSPORT=stdio` — talk to the MCP client over stdio.
- `ALLOW_UNAUTHENTICATED_STDIO=true` — local stdio is unauthenticated; only enable on a trusted machine.
- `CONNECTION_PROFILES` — a JSON map of administrator-defined profiles. Tools reference one by name via the `connection_profile` argument.

### Copilot CLI

Run `/mcp add` interactively, or edit `~/.copilot/mcp-config.json`:

```json
{
  "mcpServers": {
    "DocumentDB": {
      "command": "npx",
      "args": ["-y", "github:microsoft/documentdb-mcp"],
      "env": {
        "TRANSPORT": "stdio",
        "ALLOW_UNAUTHENTICATED_STDIO": "true",
        "CONNECTION_PROFILES": "{\"local\":{\"authMode\":\"connectionString\",\"uri\":\"mongodb://localhost:27017\"}}"
      }
    }
  }
}
```

In tool calls, set `connection_profile` to `"local"` (or whatever profile name you defined).

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "DocumentDB": {
      "command": "npx",
      "args": ["-y", "github:microsoft/documentdb-mcp"],
      "env": {
        "TRANSPORT": "stdio",
        "ALLOW_UNAUTHENTICATED_STDIO": "true",
        "CONNECTION_PROFILES": "{\"local\":{\"authMode\":\"connectionString\",\"uri\":\"mongodb://localhost:27017\"}}"
      }
    }
  }
}
```

### VS Code

Add to `settings.json`:

```json
{
  "mcp.servers": {
    "documentdb": {
      "command": "npx",
      "args": ["-y", "github:microsoft/documentdb-mcp"],
      "env": {
        "TRANSPORT": "stdio",
        "ALLOW_UNAUTHENTICATED_STDIO": "true",
        "CONNECTION_PROFILES": "{\"local\":{\"authMode\":\"connectionString\",\"uri\":\"mongodb://localhost:27017\"}}"
      }
    }
  }
}
```

To enable write or management tools, also set `"ENABLE_WRITE_TOOLS": "true"` and/or `"ENABLE_MANAGEMENT_TOOLS": "true"` in the `env` block. By default only read tools are exposed.

## Configuration

Copy [.env.example](.env.example) to `.env` and adjust it for your deployment. The default transport is streamable HTTP on `http://localhost:8070/mcp`.

Key settings:

```env
TRANSPORT=streamable-http
HOST=localhost
PORT=8070

AUTH_REQUIRED=true
ENTRA_TENANT_ID=<tenant-id>
ENTRA_AUDIENCE=<application-client-id-or-api-audience>

RATE_LIMIT_ENABLED=true
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=120

MCP_READ_ROLE_VALUES=DocumentDB.MCP.Read
MCP_WRITE_ROLE_VALUES=DocumentDB.MCP.Write
MCP_MANAGEMENT_ROLE_VALUES=DocumentDB.MCP.Management

ENABLE_READ_TOOLS=true
ENABLE_WRITE_TOOLS=false
ENABLE_MANAGEMENT_TOOLS=false
ALLOW_AGGREGATE_WRITE_STAGES=false
```

HTTP and SSE transports require a Microsoft Entra bearer token by default. `stdio` is unauthenticated and is blocked unless `ALLOW_UNAUTHENTICATED_STDIO=true`; use it only for trusted local development.

HTTP and SSE endpoints are rate-limited before token validation. The default is 120 requests per IP per 60 seconds and can be adjusted with the `RATE_LIMIT_*` settings.

## Authentication And Authorization

The server validates incoming Entra tokens and maps configured claim values to MCP roles. Values can come from the `roles`, `groups`, or `scp` claims.

Roles are hierarchical:

- `read` can call read-only tools.
- `write` can call write and read tools.
- `management` can call management, write, and read tools.

Write and management tools also require explicit capability flags. This keeps higher-impact operations unavailable by default even when a caller has the matching role.

The Entra layer protects access to the MCP server. Backend database access is configured separately through connection profiles.

## App Role Example

For production, app roles are the clearest way to govern MCP access.

Create an Entra App Registration for the MCP server/API and add app roles similar to these values:

```json
[
  {
    "allowedMemberTypes": ["User", "Group"],
    "displayName": "DocumentDB MCP Read",
    "value": "DocumentDB.MCP.Read",
    "description": "Allows read-only MCP tools"
  },
  {
    "allowedMemberTypes": ["User", "Group"],
    "displayName": "DocumentDB MCP Write",
    "value": "DocumentDB.MCP.Write",
    "description": "Allows write MCP tools"
  },
  {
    "allowedMemberTypes": ["User", "Group"],
    "displayName": "DocumentDB MCP Management",
    "value": "DocumentDB.MCP.Management",
    "description": "Allows high-impact management MCP tools"
  }
]
```

Assign users or groups to these roles in the Enterprise Application. Set `ENTRA_AUDIENCE` to the application client ID or Application ID URI that your MCP clients use when requesting tokens.

For manual validation with Azure CLI, request a token for the configured audience:

```bash
az login --tenant <tenant-id>
az account get-access-token --resource <entra-audience>
```

## Connection Profiles

Connection profiles are administrator-defined and selected by name in tool calls.

Recommended Entra/OIDC backend profile:

```env
CONNECTION_PROFILES={"sandbox":{"authMode":"entra","endpoint":"example.mongocluster.cosmos.azure.com","tokenScope":"https://ossrdbms-aad.database.windows.net/.default","allowedHosts":["*.mongocluster.cosmos.azure.com"]}}
```

Before running locally, sign in with Azure CLI:

```bash
az login --tenant <tenant-id>
```

In Azure hosting, use managed identity or workload identity and grant that identity access to the backend database. The server uses `DefaultAzureCredential`, so the same profile shape works for local Azure CLI login and managed deployments.

Legacy SCRAM profiles are still available for local or sandbox use when an administrator explicitly configures them:

```env
CONNECTION_PROFILES={"local":{"uriEnv":"DOCUMENTDB_LOCAL_URI"}}
DOCUMENTDB_LOCAL_URI=mongodb://localhost:27017
```

You can also load profiles from a file:

```env
CONNECTION_PROFILES_FILE=/etc/documentdb-mcp/profiles.json
```

## Tools

All tools require `connection_profile`.

| Tool | Role | Purpose |
| --- | --- | --- |
| `list_databases` | read | List databases, or collections for one database. |
| `drop_database` | management | Drop a database and all collections. |
| `drop_collection` | management | Drop a collection. |
| `rename_collection` | management | Rename a collection. |
| `sample_documents` | read | Return sample documents from a collection. |
| `current_ops` | management | Return current MongoDB operations. |
| `get_statistics` | read | Return database, collection, or index statistics. |
| `create_index` | management | Create an index. |
| `list_indexes` | read | List collection indexes. |
| `drop_index` | management | Drop an index. |
| `find_documents` | read | Find documents with query, projection, sort, limit, and skip options. |
| `count_documents` | read | Count documents matching a query. |
| `insert_documents` | write | Insert one or more documents. |
| `update_documents` | write | Update one or many documents. |
| `delete_documents` | write | Delete one or many documents. |
| `aggregate` | read | Run an aggregation pipeline. `$out` and `$merge` are disabled unless explicitly enabled. |
| `find_and_modify` | write | Atomically find and update one document. |
| `explain_operation` | read | Explain `find`, `count`, or `aggregate` with execution stats. |

## MCP Client Usage

For streamable HTTP, configure your MCP client with:

```text
http://<host>:8070/mcp
```

The client must send an Entra bearer token when `AUTH_REQUIRED=true`.

For trusted local `stdio` testing:

```env
TRANSPORT=stdio
AUTH_REQUIRED=false
ALLOW_UNAUTHENTICATED_STDIO=true
```

Then configure the MCP command as:

```bash
node /absolute/path/to/documentdb-mcp/dist/main.js
```

Example read tool input:

```json
{
  "connection_profile": "sandbox",
  "db_name": "mcp_validation",
  "collection_name": "vehicles",
  "query": { "status": "active" },
  "options": { "limit": 5 }
}
```

Example write tool input, requiring both the write role and `ENABLE_WRITE_TOOLS=true`:

```json
{
  "connection_profile": "sandbox",
  "db_name": "mcp_validation",
  "collection_name": "vehicles",
  "documents": {
    "vin": "VIN-100",
    "make": "Contoso",
    "model": "Test",
    "status": "active"
  }
}
```

## Security Checks

The server enforces these controls before opening a database connection:

- HTTP/SSE authentication when `AUTH_REQUIRED=true`.
- Per-IP rate limiting on HTTP/SSE routes before authentication.
- MCP role checks for each tool.
- Default-off gates for write and management tools.
- Server-side connection profile resolution.
- Rejection of tool inputs that omit `connection_profile`.
- Default rejection of aggregation `$out` and `$merge` stages.

Allowed and denied tool invocations are written to stderr with the `[MCP-AUDIT]` prefix. Audit records include the tool name, required role, decision, connection profile, transport, session or request IDs, and caller identity metadata when available.

### Data masking is not supported

The server does **not** mask, redact, or anonymize document fields. Tool results are returned to the MCP client verbatim, which means they typically flow into an LLM and any of its downstream logging, telemetry, or memory. Treat every database the server can reach as fully readable by anyone authorized to call its read tools.

If you need to expose a database that contains PII, PHI, payment data, secrets, or other sensitive fields, configure masking at the database layer (for example, a masked MongoDB view built with `$project` / `$set` / `$substr` / `$concat` / `$hash`) and point the connection profile's identity at the masked view rather than the underlying collection. Per-profile masking support in the server is tracked as a future enhancement.

## Development

Run tests and build before packaging:

```bash
npm test
npm run build
```

Preview the package contents:

```bash
npm pack --dry-run
```

The package should contain `dist/`, [README.md](README.md), [.env.example](.env.example), [tool_list.md](tool_list.md), [LICENSE.md](LICENSE.md), and package metadata.

## License

See [LICENSE.md](LICENSE.md).
