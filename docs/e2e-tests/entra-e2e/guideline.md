# entra-e2e: DocumentDB MCP end-to-end against a real Mongo vCore cluster

This folder contains everything needed to stand up a fresh DocumentDB MCP
server against a **real** Cosmos DB Mongo vCore cluster with **Microsoft Entra
ID auth on both surfaces** (caller and backend), and then exercise it with a
full CRUD smoke test.

Two parallel ports of the same flow are provided:

| Subfolder | Shell | Use when |
| --- | --- | --- |
| [bash/](bash/) | Bash 4+ | WSL Ubuntu, Linux, macOS (with `jq` installed) |
| [pwsh/](pwsh/) | PowerShell 7+ (`pwsh`) | Windows host, or pwsh on Linux/macOS |

Both ports persist the same `.state.json` shape and produce the same Azure
resources. Pick one and stick with it for a given run.

> **Note**: this guide has been validated end-to-end on the Microsoft corp
> tenant from WSL Ubuntu. The bash port is the better-tested path right now.

---

## Why the flow is split into numbered steps

The full flow cannot run unattended:

1. **Step 02** has a mandatory portal click to enable Entra auth on the cluster
   — the `cosmosdb-preview` CLI extension (≤ 1.6.2) does not yet expose this.
2. **Step 03** has a mandatory portal click to publish the `user_impersonation`
   OAuth2 scope — `az ad app` cannot do this cleanly.
3. **Step 03** also requires manual app registration on the Microsoft corp
   tenant (Service Tree GUID requirement that `az ad app create` cannot meet).
4. **Step 04** blocks running the MCP server in the foreground.
5. **Step 05** must run in a second terminal while step 04 is still running.

Each step is a standalone script that can be re-run on its own. Derived values
(`APP_ID`, `TENANT_ID`, `ME_OBJID`) are persisted to `.state.json` so later
steps don't need parameters.

---

## Prerequisites

Common to both shells:

- Azure CLI (`az`) signed in: `az login --tenant <your tenant>`
- Node.js 20+ and `npm` for building the MCP server
- Permission in the target tenant to:
  - create resource groups + Cosmos DB Mongo vCore clusters
  - register Entra apps (or create one manually in the portal)
  - PUT to `Microsoft.DocumentDB/mongoClusters/.../users` on the cluster

Bash port additionally needs:

- `jq` (state serialization): `sudo apt install jq` on Ubuntu/WSL.
- `dig` (DNS / SRV lookups in the VPN-bypass preflight): `sudo apt install dnsutils`.
- `curl` (standard on Linux/macOS).
- Scripts are already `chmod +x`; if you copy them elsewhere, re-apply.

PowerShell port additionally needs:

- **PowerShell 7+** (`pwsh`) — the scripts use `ConvertFrom-Json -AsHashtable`,
  which is not in Windows PowerShell 5.1.
- `curl.exe` on `PATH` (Windows ships it).

---

## File map

Both subfolders mirror each other one-for-one:

| Step | Bash | PowerShell | Purpose |
| --- | --- | --- | --- |
| shared | `_config.sh` | `_config.ps1` | **Edit-me variables**: subscription, RG, cluster name, app URI, repo path. Sourced by every step. |
| shared | `_state.sh` | `_state.ps1` | `save_state` / `load_state` helpers backed by `.state.json`. |
| 01 | `01-provision-cluster.sh` | `01-provision-cluster.ps1` | Create RG + Mongo vCore cluster + firewall rule for your public IP; waits for `Succeeded`. |
| 02 | `02-enable-entra-auth.sh` | `02-enable-entra-auth.ps1` | Portal step to enable Entra on the cluster, then PUT the signed-in user to `mongoClusters/.../users` via ARM REST. |
| 03 | `03-register-app.sh` | `03-register-app.ps1` | Try `az ad app create`; fall back to portal walkthrough; then prompt for the `user_impersonation` scope. |
| 04 | `04-run-server.sh` | `04-run-server.ps1` | Build + launch the MCP server. **Blocks in the foreground.** Bash version includes a WSL VPN-bypass preflight. |
| 05 | `05-smoke-tests.sh` | `05-smoke-tests.ps1` | Hit `/healthz`, `/readyz`, unauth `/mcp` (401), then authed full CRUD probe. Runs in a 2nd window. |
| 99 | `99-teardown.sh` | `99-teardown.ps1` | Delete RG + app registration. Re-prompts for `DELETE`. |
| auto | `bash/.state.json` | `pwsh/.state.json` | Auto-generated. Holds `ME_OBJID`, `APP_ID`, `TENANT_ID`. Safe to delete to start over. |

The CRUD probe used by step 05 lives in
[scripts/e2e-tests/_entra-probe.mjs](../../../scripts/e2e-tests/_entra-probe.mjs).

---

## Edit `_config` first

Before running anything, open the config for your chosen shell and set:

| Variable | What it is |
| --- | --- |
| `SUFFIX` | Resource-name suffix. Bump (e.g. `11` → `12`) to spin up a parallel environment without colliding. |
| `SUB` | Azure subscription that owns the cluster. |
| `RG` | Resource group (defaults to `documentdb-mcp-<user><SUFFIX>`). |
| `LOCATION` | Azure region. `westus2` is a known-good default. |
| `CLUSTER` | Globally-unique cluster name; lowercase. |
| `ADMIN_USER` / `ADMIN_PASSWORD` | Mongo SCRAM admin (only used if you later switch to a connection-string profile). |
| `APP_DISPLAY_NAME` | Display name of the caller-auth app registration. |
| `APP_IDENTIFIER` | Application ID URI of the app registration. Format: `api://<the-app-id-guid>`. |
| `MCP_REPO` | Local path to the MCP server repo. |
| `MCP_HOST` / `MCP_PORT` | Where the server should listen. Defaults: `127.0.0.1:8070`. |

On the **Microsoft corp tenant** you will not know `APP_IDENTIFIER` until after
step 03 (because the app must be created manually). The script will prompt and
print a warning if the value in `_config` doesn't match the app you just made.
Edit `_config` then re-run step 03 to persist the right state.

---

## Run order — Bash / WSL

```bash
cd docs/e2e-tests/entra-e2e/bash

# 1. Edit shared variables first
$EDITOR _config.sh

# 2. Provision cluster + firewall (5-10 min)
./01-provision-cluster.sh

# 3. Enable Entra auth (portal click) + create Mongo Entra user (REST)
./02-enable-entra-auth.sh

# 4. Register the MCP app (CLI or portal) + publish the user_impersonation scope
./03-register-app.sh
#    -> see "Step 03 portal walkthrough" below for the click-by-click

# 5. Start the server (foreground; leave this terminal open)
./04-run-server.sh

# 6. In a SECOND terminal:
cd docs/e2e-tests/entra-e2e/bash
./05-smoke-tests.sh
```

## Run order — PowerShell

```pwsh
cd docs/e2e-tests/entra-e2e/pwsh

# 1. Edit shared variables first
code _config.ps1

# 2. Provision cluster + firewall (5-10 min)
./01-provision-cluster.ps1

# 3. Enable Entra auth (portal click) + create Mongo Entra user (REST)
./02-enable-entra-auth.ps1

# 4. Register the MCP app (CLI or portal) + publish the user_impersonation scope
./03-register-app.ps1

# 5. Start the server (foreground; leave this window open)
./04-run-server.ps1

# 6. In a SECOND PowerShell 7 window:
cd docs/e2e-tests/entra-e2e/pwsh
./05-smoke-tests.ps1
```

---

## Portal walkthroughs

### Step 02 — enable Entra auth on the cluster

1. Azure portal → **Cosmos DB** → click your cluster (`$CLUSTER` from `_config`).
2. Left nav → **Settings** → **Authentication**.
3. Tick **Microsoft Entra ID authentication = Enabled**.
4. (Recommended) Tick **Data API = Enabled**. Useful if you ever want to fall
   back to a SCRAM connection string for debugging.
5. Click **Save** at the top. Wait for the green confirmation toast.
6. Return to the terminal and press `<Enter>`.

The script then PUTs your signed-in user to
`/subscriptions/.../mongoClusters/<cluster>/users/<your-object-id>` via ARM
REST with `api-version=2026-06-01`, granting `root@admin`.

> **API version matters.** `api-version=2024-07-01` and earlier reject Entra
> users without a password. `2025-09-01` and `2026-06-01` accept the Entra
> identity provider schema. The script pins `2026-06-01`.

### Step 03 — register the Entra app

#### Path A — generic tenant (CLI works)

The script runs `az ad app create` and persists the resulting AppId. You only
have to do the **Scope publication** step below.

#### Path B — Microsoft corp tenant (CLI blocked)

The Microsoft tenant policy refuses any new app registration that doesn't
carry a Service Tree GUID, and `az ad app create` cannot supply one. Do this:

1. Azure portal → **Microsoft Entra ID** → **App registrations** → **+ New registration**.
2. Fill in:
   - **Name**: same as `$APP_DISPLAY_NAME` (default `documentdb-mcp-dev<SUFFIX>`).
   - **Supported account types**: **Accounts in this organizational directory only**.
   - **Redirect URI**: leave blank.
   - Click **Register**.
3. On the new app's overview → copy the **Application (client) ID**. This is the
   AppId you'll paste back into the script. The full `Application ID URI` for
   step 04's `ENTRA_AUDIENCE` will be `api://<this-guid>`.
4. Left nav → **Properties** → **Service Management Reference** → paste your
   Service Tree GUID → **Save**. (Without this the app will be flagged for
   deletion within hours.)
5. Left nav → **Expose an API** → **Application ID URI** → **Add** → accept
   the default `api://<the-app-id>` → **Save**.
6. Return to the terminal, paste the AppId, press `<Enter>`.

#### Scope publication (both paths)

Both paths still require the OAuth2 scope:

1. **Expose an API** → **Scopes defined by this API** → **+ Add a scope**.
2. Fill in:
   - **Scope name**: `user_impersonation`
   - **Who can consent?**: **Admins and users**
   - **Admin consent display name**: `Access DocumentDB MCP`
   - **Admin consent description**: `Allow the app to access DocumentDB MCP on behalf of the signed-in user.`
   - **User consent display name**: `Access DocumentDB MCP`
   - **User consent description**: `Allow the app to access DocumentDB MCP on your behalf.`
   - **State**: **Enabled**
   - Click **Add scope**.
3. (Recommended) **Authorized client applications** → **+ Add a client application**:
   - **Client ID**: `04b07795-8ddb-461a-bbee-02f9e1bf7b46` (Azure CLI public client).
   - Tick `user_impersonation`.
   - Click **Add application**.

The optional step 3 pre-authorizes Azure CLI so step 05's
`az account get-access-token` doesn't trigger a consent prompt or fail with
`AADSTS650057: Invalid resource`.

Return to the terminal, press `<Enter>`.

---

## What step 04 actually configures on the server

Step 04 exports the following environment variables before booting
`node dist/main.js`:

| Variable | Value | Why |
| --- | --- | --- |
| `TRANSPORT` | `streamable-http` | MCP HTTP transport (so clients can negotiate sessions). |
| `HOST` / `PORT` | `127.0.0.1` / `8070` | Loopback listener. |
| `AUTH_REQUIRED` | `true` | Reject `/mcp` requests without a valid JWT. |
| `ENTRA_TENANT_ID` | from `.state.json` | Issuer must match `https://login.microsoftonline.com/<tenant>/v2.0`. |
| `ENTRA_AUDIENCE` | **`$APP_ID`** (the GUID), not `$APP_IDENTIFIER` | App registrations created in the portal default to `accessTokenAcceptedVersion=2`, so v2.0 tokens have `aud` = the bare app GUID. |
| `MCP_READ_ROLE_VALUES` | `user_impersonation` | Server maps this `scp` value to its `read` tool tier. |
| `MCP_WRITE_ROLE_VALUES` | `user_impersonation` | Same for `write`. |
| `MCP_MANAGEMENT_ROLE_VALUES` | `user_impersonation` | Same for `management`. |
| `ENABLE_WRITE_TOOLS` | `true` | Off by default. Step 05 needs `insert_documents`. |
| `ENABLE_MANAGEMENT_TOOLS` | `true` | Off by default. Optional teardown calls `drop_database`. |
| `CONNECTION_PROFILES` | inline JSON, `authMode=entra` | Backend uses Azure Identity / Entra OIDC against Mongo (no SCRAM). |

For a **production** deployment you would map separate scopes
(`mcp.read` / `mcp.write` / `mcp.management`) instead of granting everything
to `user_impersonation`. Step 04's mapping is convenient for e2e only.

---

## What step 05 exercises

`05-smoke-tests` first hits `/healthz` and `/readyz` (always 200), then
`/mcp` without a token (expects 401), then acquires a delegated user token
with `az account get-access-token --resource $APP_IDENTIFIER`, and finally
runs [`scripts/e2e-tests/_entra-probe.mjs`](../../../scripts/e2e-tests/_entra-probe.mjs)
which uses the MCP SDK to:

1. Complete the streamable-HTTP **initialize** handshake (session id).
2. `tools/list` — should return 18 tools.
3. `insert_documents` into `playground.vehicles`.
4. `list_databases` — `playground` should appear.
5. `get_statistics` at database scope and collection scope.
6. `count_documents` on the collection.
7. `sample_documents` from the collection.
8. (Optional) `drop_database` if `MCP_CLEANUP=true`.

Each call exercises a different combination of caller-auth, server-side
RBAC, backend `DefaultAzureCredential` → ossrdbms token, Mongo SCRAM with
Entra OID, and the cluster's data-plane RBAC.

To clean up after a run:

```bash
MCP_URL=http://127.0.0.1:8070/mcp \
MCP_BEARER="$(az account get-access-token --resource $APP_IDENTIFIER --query accessToken -o tsv)" \
MCP_CLEANUP=true \
node ../../../scripts/e2e-tests/_entra-probe.mjs
```

---

## Cleanup

```bash
./99-teardown.sh        # or ./99-teardown.ps1
```

Deletes the resource group (async) and the Entra app registration. Requires
typing `DELETE` to confirm.

---

## Troubleshooting

### Step 02 — `Bad Request ... 'password' required`

You hit the old API version. The script pins `api-version=2026-06-01`, which
accepts the EntraID schema without a password. If you forked or changed the
version, switch back to `2025-09-01` or newer.

### Step 03 — `az ad app create` fails with Service Tree error

Expected on the Microsoft corp tenant. The script falls back to a portal
walkthrough automatically. Paste the AppId after registering manually.

### Step 04 — `Push-Location: Cannot find path 'C:\Users\...\wsl_workspace\...'`

`$HOME` on Windows expands to `C:\Users\<you>`, which is not where your WSL
repo lives. The pwsh `_config.ps1` already detects Windows and switches to
the UNC path `\\wsl.localhost\Ubuntu\...`. If you customised the value,
make sure you preserve the platform check.

### Step 05 — 401 with `Missing bearer token`

Probably no token was passed. The script always emits this once intentionally
as the first sanity probe. If you see it on the **second** probe instead, the
`Authorization` header isn't reaching the server — check the SDK probe and
confirm `MCP_BEARER` is non-empty.

### Step 05 — 401 with `unexpected "aud" claim value`

`ENTRA_AUDIENCE` on the server doesn't match the token's `aud`. Decode the
token to confirm:

```bash
az account get-access-token --resource $APP_IDENTIFIER --query accessToken -o tsv \
  | awk -F. '{print $2}' | tr '_-' '/+' | base64 -d 2>/dev/null \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["aud"])'
```

For v2.0 tokens (the modern default) `aud` is the **bare app GUID**. Set
`ENTRA_AUDIENCE=$APP_ID`, not `$APP_IDENTIFIER`. (If you set
`accessTokenAcceptedVersion=1` in the manifest you'd reverse this.)

### Step 05 — `Caller is not authorized for 'read' MCP tools`

The token authenticated, but no `scp`/`roles`/`groups` claim matches the
server's role lists. Confirm step 04 set
`MCP_READ_ROLE_VALUES=user_impersonation` (and write/management). Confirm
your token has `scp: user_impersonation`:

```bash
az account get-access-token --resource $APP_IDENTIFIER --query accessToken -o tsv \
  | awk -F. '{print $2}' | tr '_-' '/+' | base64 -d 2>/dev/null \
  | python3 -c 'import sys,json; print("scp:", json.load(sys.stdin).get("scp"))'
```

If `scp` is empty, the `user_impersonation` scope was never published on the
app registration. Re-do the **Scope publication** step of the step 03 portal
walkthrough.

### Step 05 — `Server selection timed out after 30000 ms`

Network reachability problem from the server host to the cluster's Mongo port
(TCP `10260`). Diagnose:

```bash
nc -zv -w 5 ${CLUSTER}.mongocluster.cosmos.azure.com 10260
```

If it times out:

1. **Firewall rule missing.** Get the egress IP the cluster sees and add it:
   ```bash
   MY_IP=$(curl -s https://api.ipify.org)
   az cosmosdb mongocluster firewall rule create \
     -g $RG -n allow-my-ip --cluster-name $CLUSTER \
     --start-ip-address "$MY_IP" --end-ip-address "$MY_IP"
   ```
2. **VPN split-tunnel on WSL.** Corp VPN clients can route Azure traffic
   through a CGNAT interface, which the cluster firewall doesn't know.
   `04-run-server.sh` already auto-detects this and installs a per-host route.
   To do it manually:
   ```bash
   ip route get $(getent hosts ${CLUSTER}.mongocluster.cosmos.azure.com | awk '{print $1}')
   # if the output shows dev eth5 or src 100.64.x.x, that's the VPN
   CLUSTER_IP=$(getent hosts ${CLUSTER}.mongocluster.cosmos.azure.com | awk '{print $1}')
   LAN_GW=$(ip route show default | awk '$3 !~ /^100\./ {print $3; exit}')
   LAN_DEV=$(ip route show default | awk '$3 !~ /^100\./ {print $5; exit}')
   sudo ip route replace ${CLUSTER_IP}/32 via $LAN_GW dev $LAN_DEV
   ```
   Note: this route is lost on `wsl --shutdown`. Re-run step 04 to re-install
   it automatically.

### Step 05 — `External identity is not present in the system`

The Mongo data-plane RBAC entry hasn't propagated yet (or doesn't exist).
Wait ~60 seconds after step 02 and retry. To confirm the user exists:

```bash
az rest --method get --uri \
  "https://management.azure.com/subscriptions/$SUB/resourceGroups/$RG/providers/Microsoft.DocumentDB/mongoClusters/$CLUSTER/users?api-version=2026-06-01" \
  --query 'value[].name' -o tsv
```

You should see both `clusteradmin` and your object ID. If your object ID is
missing, re-run step 02.

### Step 05 — `AADSTS65001: not consented` on the second probe

The `user_impersonation` scope exists but has not been consented to. Use the
interactive consent flow:

```bash
az login --tenant $TENANT_ID --scope ${APP_IDENTIFIER}/.default
```

If your tenant blocks `--use-device-code`, do `az login` from a machine with
a working browser (Windows host is fine; WSL needs `wslu` or `BROWSER` env).

### Step 05 — `AADSTS650057: Invalid resource ... List of valid resources from app registration: .`

You requested `.../.default` against an app that has no published scopes.
Open the app registration → **Expose an API** → confirm at least
`user_impersonation` is listed under **Scopes defined by this API**.

### `cannot be loaded because running scripts is disabled` (PowerShell)

```pwsh
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

### `jq: command not found` (bash)

```bash
sudo apt install jq          # Ubuntu / WSL
brew install jq              # macOS
```

### Cluster stuck `Provisioning` for >15 minutes

Cancel step 01 with Ctrl-C and check the portal — the operation log under
the resource group will have a more specific error than the CLI shows.

---

## Re-running individual steps

Any step can be re-run on its own as long as `.state.json` exists from the
prerequisite steps. Useful examples:

- Cluster already provisioned, just want to re-run the server:
  `./04-run-server.sh`
- App registration deleted out from under you:
  `./03-register-app.sh` (reuses if URI matches; creates new otherwise) then 04.
- Starting over against a clean subscription:
  `./99-teardown.sh`, delete `.state.json`, start from 01.

---

## Related docs

- [../entra-e2e-with-agent-kit.md](../entra-e2e-with-agent-kit.md) — concepts +
  how to wire the running server into VS Code / Copilot CLI / Claude Code with
  Entra on both surfaces, including negative tests.
- [../e2e-testing-guide.md](../e2e-testing-guide.md) — broader manual test
  matrix for every shipped security control.
- [../../release-readiness-check.md](../../release-readiness-check.md) —
  release-time checklist that references the matrix.
