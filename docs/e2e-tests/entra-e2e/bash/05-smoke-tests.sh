#!/usr/bin/env bash
# 05-smoke-tests.sh
# Run from a SECOND terminal while 04-run-server.sh is still running in the
# first terminal. Hits the unauth probes, then acquires a caller token and
# hits the authenticated /mcp endpoint.

set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${HERE}/_config.sh"
source "${HERE}/_state.sh"

baseUrl="http://${MCP_HOST}:${MCP_PORT}"

echo "==> healthz"
curl -s  "${baseUrl}/healthz"; echo

echo "==> readyz"
curl -s  "${baseUrl}/readyz";  echo

echo "==> /mcp without token (expect 401)"
curl -i  "${baseUrl}/mcp" || true

echo "==> Acquiring caller token for $APP_IDENTIFIER"
CALLER_TOKEN="$(az account get-access-token --resource "$APP_IDENTIFIER" --query accessToken -o tsv)"
if [[ -z "$CALLER_TOKEN" ]]; then
    echo "ERROR: Failed to acquire caller token. Did Step 03's manual scope step complete?" >&2
    exit 1
fi

echo "==> /mcp with token (full MCP handshake via SDK probe)"
MCP_URL="${baseUrl}/mcp" MCP_BEARER="$CALLER_TOKEN" MCP_PROFILE="sandbox" \
    node "${MCP_REPO}/scripts/e2e-tests/_entra-probe.mjs" || true

echo
echo "Smoke tests done. Point your MCP client at ${baseUrl}/mcp with the same Authorization header."
echo "See docs/e2e-tests/entra-e2e-with-agent-kit.md Step 4 Option A for the .vscode/mcp.json snippet."
