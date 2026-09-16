# End-to-end testing with Entra ID and documentdb-agent-kit

This guide walks through standing up the `documentdb-mcp` server with full Microsoft Entra ID authentication on both the caller and backend surfaces, then driving it from an MCP client that has the [`documentdb-agent-kit`](https://github.com/microsoft/documentdb-agent-kit) skills loaded.

## How the pieces fit

```
┌─ MCP client process (the agent) ────────────────────────────────────┐
│   • VS Code / Copilot CLI / Claude Code / Cursor                    │
│   • Loads documentdb-agent-kit skills (markdown only — passive)     │
│   • Speaks MCP to the server                                        │
└────────────────────────────┬────────────────────────────────────────┘
                             │ MCP over stdio or HTTP
                             ▼
┌─ documentdb-mcp server ─────────────────────────────────────────────┐
│   • Validates incoming caller token (Entra) if AUTH_REQUIRED=true   │
│   • Resolves connection_profile → opens MongoClient                 │
│   • For authMode=entra profiles: gets backend token via Azure       │
│     Identity (DefaultAzureCredential) and uses MongoDB OIDC         │
└────────────────────────────┬────────────────────────────────────────┘
                             │ MongoDB wire + Entra OIDC
                             ▼
                   Azure DocumentDB cluster
```

Two distinct Entra surfaces — keep them separate:

| Surface | Token issued to | Configured by | Sent to |
|---|---|---|---|
| **Caller auth** | the human/agent | `AUTH_REQUIRED=true` + `ENTRA_TENANT_ID` + `ENTRA_AUDIENCE` on the MCP server | the MCP server (`Authorization: Bearer …`) |
| **Backend auth** | the MCP server process | profile `authMode=entra` + `tokenScope` | Azure DocumentDB cluster |

For "Entra ID end-to-end" you want **both** turned on. Stdio doesn't carry headers, so caller-Entra requires the **streamable-http** transport.

---

## Step-by-step

### 1. Pre-reqs on the cluster (one-time)

#### 1a. Create the cluster (skip if you already have one)

```bash
SUB=<sub-id>
RG=<rg>
LOCATION=eastus
CLUSTER=<documentdb-cluster-name>          # lowercase, globally unique
ADMIN_USER=clusteradmin
ADMIN_PASSWORD='<strong-password>'          # ≥ 8 chars, mixed case + digit + symbol

az account set --subscription "$SUB"
az group create --name "$RG" --location "$LOCATION"

# Smallest dev-friendly tier (M10, single node, 32 GB). Bump for real workloads.
az cosmosdb mongocluster create \
  --resource-group "$RG" \
  --cluster-name "$CLUSTER" \
  --location "$LOCATION" \
  --administrator-login "$ADMIN_USER" \
  --administrator-login-password "$ADMIN_PASSWORD" \
  --shard-node-tier M10 \
  --shard-node-ha false \
  --shard-node-disk-size-gb 32 \
  --shard-node-count 1 \
  --server-version 7.0

# Open the firewall so your workstation can reach the cluster.
# For a quick dev test you can allow your current IP:
MY_IP=$(curl -s https://api.ipify.org)
az cosmosdb mongocluster firewall-rule create \
  --resource-group "$RG" --cluster-name "$CLUSTER" \
  --rule-name allow-my-ip --start-ip-address "$MY_IP" --end-ip-address "$MY_IP"
```

Provisioning typically takes 5–10 minutes. Confirm with:

```bash
az cosmosdb mongocluster show -g "$RG" -n "$CLUSTER" --query "provisioningState"
# "Succeeded"
```

> For Bicep / Terraform / portal alternatives and richer firewall examples, see [`documentdb-agent-kit/examples/azure-deployment/`](https://github.com/microsoft/documentdb-agent-kit/tree/main/examples/azure-deployment) or the `documentdb-azure-deployment` skill.

#### 1b. Enable Entra auth and grant yourself the dbAdmin role

```bash
ME_OBJID=$(az ad signed-in-user show --query id -o tsv)

az cosmosdb mongocluster update \
  --resource-group "$RG" --cluster-name "$CLUSTER" \
  --data-api '{"mode":"Enabled"}' \
  --entra-auth Enabled

az cosmosdb mongocluster user create \
  --resource-group "$RG" --cluster-name "$CLUSTER" \
  --user-name "$ME_OBJID" --identity-provider EntraID --role dbAdmin
```

Verify your own backend token works before bringing the MCP server into it:

```bash
az account get-access-token --resource https://ossrdbms-aad.database.windows.net --query expiresOn
```

### 2. Register the MCP server as an Entra app (one-time, for caller auth)

```bash
APP_ID=$(az ad app create --display-name "documentdb-mcp-dev" \
  --identifier-uris api://documentdb-mcp-dev --query appId -o tsv)
az ad sp create --id "$APP_ID"
# Portal → App registrations → Expose an API → Add a scope `user_impersonation`
```

Note `APP_ID` and `TENANT_ID=$(az account show --query tenantId -o tsv)`.

### 3. Start the MCP server with Entra on both surfaces

```bash
cd ~/wsl_workspace/code2026/documentdb-mcp
nvm use 23.6.1
npm run build

export TRANSPORT=streamable-http
export HOST=127.0.0.1
export PORT=8070
export AUTH_REQUIRED=true
export ENTRA_TENANT_ID="$TENANT_ID"
export ENTRA_AUDIENCE="$APP_ID"          # or api://documentdb-mcp-dev
export CONNECTION_PROFILES='{
  "sandbox": {
    "authMode": "entra",
    "endpoint": "'"$CLUSTER"'.mongocluster.cosmos.azure.com",
    "tokenScope": "https://ossrdbms-aad.database.windows.net/.default",
    "allowedHosts": ["*.mongocluster.cosmos.azure.com"],
    "allowedRoles": ["read","write"]
  }
}'

# az login so DefaultAzureCredential can pick up your creds for backend auth
az login --tenant "$TENANT_ID"

node dist/main.js
```

Sanity:

```bash
curl -s http://127.0.0.1:8070/healthz   # {"status":"ok"}
curl -s http://127.0.0.1:8070/readyz    # {"status":"ready"}
curl -i http://127.0.0.1:8070/mcp       # 401 (proves caller auth is on)
```

### 4. Configure your MCP client

The agent-kit is just skills — it has no transport. The actual client is what dials the server. Pick one.

#### Option A — VS Code (recommended; supports custom headers)

Add to `.vscode/mcp.json`:

```jsonc
{
  "servers": {
    "documentdb-local": {
      "type": "http",
      "url": "http://127.0.0.1:8070/mcp",
      "headers": {
        "Authorization": "Bearer ${input:caller_token}"
      }
    }
  },
  "inputs": [
    { "id": "caller_token", "type": "promptString", "password": true,
      "description": "az account get-access-token --resource api://documentdb-mcp-dev --query accessToken -o tsv" }
  ]
}
```

Get the caller token on demand:

```bash
az account get-access-token --resource "api://documentdb-mcp-dev" --query accessToken -o tsv
```

Paste when VS Code prompts.

#### Option B — Copilot CLI / Claude Code (stdio only → use a bridge)

These don't send custom headers over HTTP. Use `mcp-remote` to bridge stdio→HTTP and inject the bearer:

```bash
npm i -g mcp-remote
```

In `~/.copilot/mcp-config.json` (or Claude's config):

```json
{
  "mcpServers": {
    "documentdb-local": {
      "command": "bash",
      "args": [
        "-lc",
        "TOKEN=$(az account get-access-token --resource api://documentdb-mcp-dev --query accessToken -o tsv) && exec npx -y mcp-remote http://127.0.0.1:8070/mcp --header \"Authorization: Bearer $TOKEN\""
      ]
    }
  }
}
```

Caveat: caller-token lifetime is ~1 hour; on expiry, restart the MCP client and it will re-fetch.

### 5. Wire the agent-kit into the same client

```bash
cd ~/wsl_workspace/code2026/documentdb-agent-kit

# Claude Code (project-scoped)
mkdir -p .claude && ln -s "$(pwd)/skills" .claude/skills

# Copilot — AGENTS.md is auto-read when you open the agent-kit repo in the editor
# Gemini CLI
ln -s AGENTS.md GEMINI.md
```

Then open the agent-kit repo (or your test repo with AGENTS.md copied in) in the same client you wired up in step 4.

### 6. Smoke test end-to-end

In the agent chat:

> Using the DocumentDB MCP server, list databases on `connection_profile: sandbox`, then list collections in `<your-db>`.

Expected: the agent calls `list_databases` → server validates your caller token (step 2 audience) → resolves `sandbox` → opens an Entra-OIDC `MongoClient` using your az-login identity (step 1 grant) → returns the list.

Validate from both sides:

- Server stdout shows an `auth.allow` audit line with your `oid`.
- `/readyz` still `200`; no `validateConfig` errors.

### 7. Negative tests (proves Entra is doing work)

| Test | Expectation |
|---|---|
| Stop sending the Authorization header | `401` from `/mcp` |
| Use a token with wrong audience (`--resource https://graph.microsoft.com`) | `401` |
| `az logout`, restart server | tool calls fail with backend-token error (DefaultAzureCredential has no source) |
| Add `"allowedDatabases": ["nope"]` to the profile and re-ask for your real DB | `withDbGuard` deny + audit entry |

---

## Common gotchas

- **`AGENTS.md` is per-repo.** If you want skills active while testing in a third repo (e.g., `documentdb-mcp` itself), copy `AGENTS.md` and `skills/` there, or open the agent-kit repo as the working directory.
- **The `mcp-setup` skill in agent-kit is written for the old `DOCUMENTDB_URI` flow.** It predates `CONNECTION_PROFILES` + Entra; don't follow it for this test. Use step 3 above.
- **Stdio + `AUTH_REQUIRED=true` is incompatible.** Stdio has no headers; the server gates HTTP/SSE only. For an Entra E2E you must use `streamable-http`.
- **Two different audiences.** `ENTRA_AUDIENCE` on the server = caller-token audience (your custom app). `tokenScope` in the profile = backend audience (`https://ossrdbms-aad.database.windows.net/.default`). Mixing them up is the #1 cause of 401s.

