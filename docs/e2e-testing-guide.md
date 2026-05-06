# End-To-End Testing Guide

This guide documents how to verify the DocumentDB MCP server end to end against a real MongoDB-compatible backend, and how to validate that standard MCP clients can talk to it.

The goal is to prove the full request path works:

```
MCP client -> transport -> auth/guard -> connection profile -> Mongo driver -> backend DB -> response
```

## Prerequisites

- Node.js 20 or later (the project default of `node` may be older; use `nvm` if needed)
- Docker (for the local DocumentDB backend)
- Repository cloned and dependencies installed:
    ```bash
    npm install
    npm run build
    ```

If `node -v` reports something below 20, switch versions before continuing:

```bash
nvm use 23.6.1
```

## 1. Start A Local DocumentDB Backend

Use the official `documentdb-local` image from the [documentdb/documentdb](https://github.com/documentdb/documentdb) project.

If `docker pull` returns `denied: denied` due to a stale credential helper, bypass it:

```bash
mkdir -p /tmp/docker-clean && echo '{}' > /tmp/docker-clean/config.json
docker --config /tmp/docker-clean pull ghcr.io/documentdb/documentdb/documentdb-local:latest
```

Start the container:

```bash
docker tag ghcr.io/documentdb/documentdb/documentdb-local:latest documentdb-local
docker rm -f documentdb-container 2>/dev/null
docker run -dt -p 10260:10260 --name documentdb-container documentdb-local \
    --username mcpadmin --password 'McpDev!2026'
```

Wait a few seconds, then confirm it is up:

```bash
docker ps --filter name=documentdb-container --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
```

The container ships with a seeded `sampledb` containing `analytics`, `orders`, `products`, and `users`.

The connection URI for any client is:

```
mongodb://mcpadmin:McpDev%212026@localhost:10260/?tls=true&tlsAllowInvalidCertificates=true&authMechanism=SCRAM-SHA-256
```

## 2. Configure The MCP Server

Create or update `.env` for stdio + the local connection profile:

```env
TRANSPORT='stdio'
AUTH_REQUIRED='false'
ALLOW_UNAUTHENTICATED_STDIO='true'

ENABLE_READ_TOOLS='true'
ENABLE_WRITE_TOOLS='true'
ENABLE_MANAGEMENT_TOOLS='false'
ALLOW_AGGREGATE_WRITE_STAGES='false'

CONNECTION_PROFILES='{"local":{"uriEnv":"DOCUMENTDB_LOCAL_URI"}}'
DOCUMENTDB_LOCAL_URI='mongodb://mcpadmin:McpDev%212026@localhost:10260/?tls=true&tlsAllowInvalidCertificates=true&authMechanism=SCRAM-SHA-256'
```

Notes:

- `ENABLE_WRITE_TOOLS=true` is intentionally enabled here only to exercise insert/update/delete during E2E. Set it back to `false` once verification is complete.
- Never commit `.env` with real credentials. Local-only test passwords are fine.
- For HTTP transport testing, see [Section 6](#6-http-transport-verification).

Build the server after any code change:

```bash
npm run build
```

## 3. Smoke Test The Server Process

Start the server directly to confirm it boots cleanly:

```bash
node dist/main.js
```

Expected stderr:

```
Starting DocumentDB MCP server with transport: stdio
Server will run on stdio transport
DocumentDB MCP Server running on stdio transport
```

Press `Ctrl+C` to stop. The server is correct; it is waiting for an MCP client over stdin/stdout.

## 4. Drive The Server With A Programmatic MCP Client

The repo ships the official `@modelcontextprotocol/sdk` as a dependency, so any spec-compliant MCP client will work. The simplest deterministic test is a small Node script that:

- spawns `dist/main.js` over stdio
- calls `tools/list`
- calls a representative read tool, a representative write tool, and a destructive-blocked path

Place the script in the project directory so the SDK resolves from `node_modules`. Example checks to run:

- `list_databases` (no `db_name`) returns at least `sampledb`.
- `list_databases` with `db_name=sampledb` returns the seeded collections.
- `find_documents` on `sampledb.products` with a filter and projection returns matching docs.
- `count_documents` returns the expected total.
- `insert_documents` returns an `inserted_id` and `acknowledged: true`.
- A follow-up `count_documents` confirms the inserted doc is present.
- `[MCP-AUDIT]` lines appear on stderr for every call with `decision: allow`.

Negative checks to run:

- Omit `connection_profile` from any tool call. Expect an `isError: true` response with a clear message.
- Set `ENABLE_WRITE_TOOLS=false` and call `insert_documents`. Expect a deny audit and an error like `Write tools are disabled`.
- Pass an unknown profile name. Expect `Unknown connection profile '...'`.
- Run `aggregate` with `$out` while `ALLOW_AGGREGATE_WRITE_STAGES=false`. Expect the stage to be blocked.

Once these pass, the server protocol surface and security gates are verified.

## 5. Verify With A Real Interactive MCP Client

Server protocol conformance is necessary but not sufficient. Always validate at least one production-style MCP client.

Common options:

- **VS Code GitHub Copilot Chat** with an MCP server entry
- **Claude Desktop** with an MCP server entry
- **MCP Inspector** debug UI:
    ```bash
    npx @modelcontextprotocol/inspector node dist/main.js
    ```

Reference launcher config (works for VS Code and Claude Desktop):

```json
{
    "mcpServers": {
        "documentdb": {
            "command": "/home/rhossain/.nvm/versions/node/v23.6.1/bin/node",
            "args": ["/home/rhossain/wsl_workspace/code2026/documentdb-mcp/dist/main.js"],
            "cwd": "/home/rhossain/wsl_workspace/code2026/documentdb-mcp"
        }
    }
}
```

Important launch-config rules:

- Use an absolute path to a Node.js 20+ binary. GUI clients do not source your shell or `nvm`.
- Set `cwd` to the project directory so `dotenv` finds `.env`.
- For Windows-side clients targeting WSL, invoke through `wsl.exe` or expose the server over HTTP.

Once connected, ask the model in the client to:

1. List available tools.
2. Call `list_databases` with `connection_profile=local`.
3. Call `find_documents` against `sampledb.products`.
4. Call `count_documents`.
5. Call `insert_documents` if write tools are enabled.

Watch the server stderr for `[MCP-AUDIT]` entries to confirm every client-issued call reached the server.

## 6. HTTP Transport Verification

Use this once stdio is verified. It mirrors how external customers will deploy the server.

Update `.env`:

```env
TRANSPORT='streamable-http'
HOST='localhost'
PORT='8070'

AUTH_REQUIRED='true'
ENTRA_TENANT_ID='<your-tenant-id>'
ENTRA_AUDIENCE='<your-app-client-id-or-app-id-uri>'

ENABLE_READ_TOOLS='true'
ENABLE_WRITE_TOOLS='false'
ENABLE_MANAGEMENT_TOOLS='false'

CONNECTION_PROFILES='{"local":{"uriEnv":"DOCUMENTDB_LOCAL_URI"}}'
DOCUMENTDB_LOCAL_URI='mongodb://mcpadmin:McpDev%212026@localhost:10260/?tls=true&tlsAllowInvalidCertificates=true&authMechanism=SCRAM-SHA-256'
```

Sign in for backend access if testing against a cloud DocumentDB / Cosmos Mongo vCore profile:

```bash
az login --tenant <your-tenant-id>
```

Get a bearer token for the MCP server audience:

```bash
az account get-access-token --resource <your-app-client-id-or-app-id-uri>
```

Start the server:

```bash
node dist/main.js
```

Connect any MCP HTTP client (or curl-based tool) to:

```
http://localhost:8070/mcp
```

with header:

```
Authorization: Bearer <token>
```

Negative tests to run on HTTP:

- Omit the bearer token. Expect HTTP `401`.
- Send a token with no matching role claim. Expect `Caller is not authorized for 'read' MCP tools.`
- Send a token with the wrong audience. Expect `401` with audience-mismatch detail.
- Call a write tool while `ENABLE_WRITE_TOOLS=false`. Expect a deny audit and `Write tools are disabled`.

## 7. Audit Logging Validation

For every tool call, confirm a single `[MCP-AUDIT]` line on stderr containing:

- `timestamp`
- `toolName`
- `requiredRole`
- `decision`
- `connectionProfile`
- transport / session / request IDs (when applicable)
- principal metadata for HTTP/SSE callers

Audit logs must NOT include:

- bearer tokens
- backend connection strings
- query result documents
- secrets or credentials

If any of these appear, treat it as a release blocker and patch the offending log site.

## 8. Cleanup

Stop and remove the local backend:

```bash
docker rm -f documentdb-container
```

Restore safe defaults in `.env` before sharing or committing:

```env
ENABLE_WRITE_TOOLS='false'
ENABLE_MANAGEMENT_TOOLS='false'
```

Confirm `.env` is git-ignored.

## 9. Common Pitfalls

- **`node -v` shows < 20.** Switch to Node 20+ via `nvm use 23.6.1`. The default `/usr/bin/node` is often older.
- **`ghcr.io denied: denied` on `docker pull`.** A stale credential helper is interfering. Use `docker --config /tmp/docker-clean pull ...`.
- **`.env` not loaded by GUI MCP client.** The client launched the server from a different working directory. Set `cwd` in the client config or pass env explicitly.
- **`Unknown connection profile`.** Check `CONNECTION_PROFILES` JSON parses, the profile name matches the tool input, and any referenced `uriEnv` is set.
- **`ENOENT mongodb` when running scripts from `/tmp`.** Run from the project directory so `node_modules` is found.
- **HTTP clients fail with `401`.** Token audience or tenant does not match the configured `ENTRA_AUDIENCE` / `ENTRA_TENANT_ID`.

## 10. Recommended E2E Run Before Every Release

1. `npm ci`
2. `npm run build`
3. `npm test`
4. `npm run test:coverage` (once added)
5. Start `documentdb-local` container.
6. Run the programmatic E2E client script (Section 4) against stdio transport.
7. Run the HTTP transport verification (Section 6) against `streamable-http`.
8. Connect at least one real interactive MCP client (Section 5) and execute a representative read tool call.
9. Review `[MCP-AUDIT]` output for unexpected denies or missing fields.
10. Restore safe `.env` defaults and tear down the container.

If any step fails, do not proceed with the release.
