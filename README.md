# DocumentDB MCP Server

DocumentDB MCP Server is a tools-only Model Context Protocol server for Azure Cosmos DB for MongoDB vCore and other MongoDB-compatible DocumentDB deployments. It exposes stateless database, collection, index, and document tools through MCP while keeping database connection details under server administrator control.

Every tool call uses a configured `connection_profile`. Tools never accept connection strings as MCP arguments; connections are selected only from server-side configuration. For local quickstart the server can synthesize a `default` profile from a single environment variable. For production, deployments should use Microsoft Entra ID / OIDC backend authentication so the server does not need a database password.

## Getting Started

The package has not yet been published to npm. Until then, choose one of the paths below.

### Option 1 — Local connection string over stdio (fastest)

Best for: local development, sandbox use, MCP clients like Copilot CLI, Claude Desktop, or VS Code that spawn an MCP server over stdio.

Run directly from GitHub with `npx`:

```bash
npx -y github:microsoft/documentdb-mcp --stdio
```

Configure the server with a single environment variable:

```bash
export DOCUMENTDB_MCP_CONNECTION_STRING='mongodb://localhost:27017/myDatabase'
```

When `DOCUMENTDB_MCP_CONNECTION_STRING` is set and no other connection profiles are configured, the server creates a `default` profile from it. The `--stdio` flag selects stdio transport and permits trusted local unauthenticated stdio. To enforce read-only operation, add `--read-only`:

```bash
npx -y github:microsoft/documentdb-mcp --stdio --read-only
```

The connection string can target any MongoDB-compatible cluster — local MongoDB, Azure Cosmos DB for MongoDB vCore, or any MongoDB-API endpoint.

### Option 2 — Production deployment with Entra ID

Best for: shared, multi-user, or production deployments where the database password should never live on disk.

```env
TRANSPORT=streamable-http
AUTH_REQUIRED=true
ENTRA_TENANT_ID=<tenant-id>
ENTRA_AUDIENCE=<application-client-id-or-api-audience>

CONNECTION_PROFILES={"sandbox":{"authMode":"entra","endpoint":"<your-cluster>.mongocluster.cosmos.azure.com","tokenScope":"<your-token-scope>","allowedHosts":["*.mongocluster.cosmos.azure.com"]}}
```

See [Authentication and Authorization](#authentication-and-authorization) and [Connection Profiles](#connection-profiles) for full details.

### Option 3 — From source (contributors)

Node.js 20 or later is required.

```bash
git clone https://github.com/microsoft/documentdb-mcp.git
cd documentdb-mcp
npm install
npm run build
node dist/main.js
```

For local development with auto-reload:

```bash
npm install
npm run dev
```

### MCP Client Configuration

#### Copilot CLI

Run `/mcp add` interactively, or edit `~/.copilot/mcp-config.json`:

```json
{
  "mcpServers": {
    "DocumentDB": {
      "command": "npx",
      "args": ["-y", "github:microsoft/documentdb-mcp", "--stdio", "--read-only"],
      "env": {
        "DOCUMENTDB_MCP_CONNECTION_STRING": "mongodb://localhost:27017/myDatabase"
      }
    }
  }
}
```

#### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "DocumentDB": {
      "command": "npx",
      "args": ["-y", "github:microsoft/documentdb-mcp", "--stdio", "--read-only"],
      "env": {
        "DOCUMENTDB_MCP_CONNECTION_STRING": "mongodb://localhost:27017/myDatabase"
      }
    }
  }
}
```

#### VS Code

Add to your `settings.json`:

```json
{
  "mcp.servers": {
    "documentdb": {
      "command": "npx",
      "args": ["-y", "github:microsoft/documentdb-mcp", "--stdio", "--read-only"],
      "env": {
        "DOCUMENTDB_MCP_CONNECTION_STRING": "mongodb://localhost:27017/myDatabase"
      }
    }
  }
}
```

To enable write tools, drop `--read-only` and pass `ENABLE_WRITE_TOOLS=true` (and `ENABLE_MANAGEMENT_TOOLS=true` for management tools) in the `env` block.

## CLI Flags

| Flag | Effect |
| --- | --- |
| `--stdio` | Use stdio transport. Defaults `AUTH_REQUIRED=false` and `ALLOW_UNAUTHENTICATED_STDIO=true` so the server is usable without an Entra token in trusted local development. Both can still be overridden by environment variables. |
| `--read-only`, `--readonly` | Disable write and management capability flags regardless of environment, including `$out`/`$merge` aggregation stages. Read tools remain available. |

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

# Quickstart shortcut for local stdio usage. Ignored when CONNECTION_PROFILES is set.
# DOCUMENTDB_MCP_CONNECTION_STRING=mongodb://localhost:27017/myDatabase
```

HTTP and SSE transports require a Microsoft Entra bearer token by default. `stdio` is unauthenticated and is blocked unless `ALLOW_UNAUTHENTICATED_STDIO=true` (or `--stdio` is passed without overriding env vars); use it only for trusted local development.

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

`connection_profile` is required in tool input by default. As a convenience for the local quickstart, when the server is running on stdio transport and exactly one profile is configured, tools may omit `connection_profile` and the single profile is used automatically. HTTP and SSE transports always require an explicit profile name.

Recommended Entra/OIDC backend profile (replace `<your-token-scope>` with the OAuth resource URI documented for your DocumentDB-compatible service):

```env
CONNECTION_PROFILES={"sandbox":{"authMode":"entra","endpoint":"<your-cluster>.mongocluster.cosmos.azure.com","tokenScope":"<your-token-scope>","allowedHosts":["*.mongocluster.cosmos.azure.com"]}}
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

For the simplest local case, set `DOCUMENTDB_MCP_CONNECTION_STRING` instead. When `CONNECTION_PROFILES` is empty, the server synthesizes a `default` connectionString profile from this value. If `CONNECTION_PROFILES` is non-empty, this variable is ignored so administrator-defined profiles always win.

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
