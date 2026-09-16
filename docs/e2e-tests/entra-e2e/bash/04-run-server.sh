#!/usr/bin/env bash
# 04-run-server.sh
# Build the MCP server and launch it with Entra on both surfaces.
# This blocks in the foreground -- leave the terminal open and run step 05
# from a SECOND terminal.

set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${HERE}/_config.sh"
source "${HERE}/_state.sh"

require_state APP_ID TENANT_ID
APP_ID="$(load_state APP_ID)"
TENANT_ID="$(load_state TENANT_ID)"

# ---- Preflight: VPN-bypass route for the Mongo node (WSL gotcha) ----------
# Corporate VPN clients on Windows install a CGNAT-style route in WSL that
# captures Azure prefixes, so our outbound packets to the cluster's public
# IP come from a NAT address that the cluster firewall does not know.
# Detect that and add a per-host route via the LAN interface. Best-effort:
# silently skips if we are not on WSL or if the cluster IP cannot be resolved.
if grep -qi microsoft /proc/version 2>/dev/null; then
    CLUSTER_HOST="${CLUSTER}.mongocluster.cosmos.azure.com"
    CLUSTER_NODE="$(dig +short SRV "_mongodb._tcp.${CLUSTER_HOST}" 2>/dev/null | awk '{print $4}' | sed 's/\.$//' | head -1)"
    if [[ -n "${CLUSTER_NODE:-}" ]]; then
        CLUSTER_IP="$(getent hosts "$CLUSTER_NODE" | awk '{print $1}' | head -1)"
        # Find the default LAN interface + gateway (one that is NOT in the CGNAT
        # 100.64.0.0/10 range typically used by corp VPN clients).
        LAN_LINE="$(ip route show default 2>/dev/null | awk '$3 !~ /^100\./ {print; exit}')"
        if [[ -n "${CLUSTER_IP:-}" && -n "$LAN_LINE" ]]; then
            LAN_GW="$(echo "$LAN_LINE" | awk '{print $3}')"
            LAN_DEV="$(echo "$LAN_LINE" | awk '{print $5}')"
            CURRENT_DEV="$(ip route get "$CLUSTER_IP" 2>/dev/null | awk '/dev/ {for (i=1;i<=NF;i++) if ($i=="dev") print $(i+1); exit}')"
            if [[ -n "$CURRENT_DEV" && "$CURRENT_DEV" != "$LAN_DEV" ]]; then
                echo "VPN-bypass: routing ${CLUSTER_IP} via ${LAN_GW} dev ${LAN_DEV} (sudo required)"
                sudo ip route replace "${CLUSTER_IP}/32" via "$LAN_GW" dev "$LAN_DEV" || \
                    echo "(could not install VPN-bypass route; if the server times out reaching the cluster, see guideline.md troubleshooting)"
            fi
        fi
    fi
fi

cd "$MCP_REPO"

# Build (skip if already built and unchanged).
npm run build

# Caller-auth surface.
export TRANSPORT='streamable-http'
export HOST="$MCP_HOST"
export PORT="$MCP_PORT"
export AUTH_REQUIRED='true'
export ENTRA_TENANT_ID="$TENANT_ID"
# Audience must match the JWT's `aud` claim. App registrations created in the portal
# default to accessTokenAcceptedVersion=2, which issues v2.0 tokens whose `aud` is
# the bare app GUID (not the api://... URI). Set ENTRA_AUDIENCE to APP_ID.
# If you change the manifest to accessTokenAcceptedVersion=1, switch this to APP_IDENTIFIER.
export ENTRA_AUDIENCE="$APP_ID"

# Authorization: map the `user_impersonation` delegated scope (carried in the JWT's
# `scp` claim) to all three MCP tool tiers so the caller can exercise read/write/management.
# For a production deployment, expose dedicated scopes (e.g. mcp.read / mcp.write) and
# map each tier accordingly instead of granting everything to a single scope.
export MCP_READ_ROLE_VALUES='user_impersonation'
export MCP_WRITE_ROLE_VALUES='user_impersonation'
export MCP_MANAGEMENT_ROLE_VALUES='user_impersonation'

# Capability gates: write/management tools are disabled by default. Opt in for e2e.
export ENABLE_WRITE_TOOLS='true'
export ENABLE_MANAGEMENT_TOOLS='true'

# Backend-auth surface (Entra OIDC against DocumentDB).
export CONNECTION_PROFILES="$(cat <<EOF
{"sandbox":{"authMode":"entra","endpoint":"${CLUSTER}.mongocluster.cosmos.azure.com","tokenScope":"https://ossrdbms-aad.database.windows.net/.default","allowedHosts":["*.mongocluster.cosmos.azure.com"],"allowedRoles":["read","write"]}}
EOF
)"

# Make sure DefaultAzureCredential has something to use for the backend.
az login --tenant "$TENANT_ID" >/dev/null

echo "Starting MCP server on http://${MCP_HOST}:${MCP_PORT} ..."
echo "Leave this terminal running. In a separate shell run ./05-smoke-tests.sh"
exec node dist/main.js
