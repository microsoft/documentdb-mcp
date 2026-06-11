# 05-smoke-tests.ps1
# Run from a SECOND PowerShell window while 04-run-server.ps1 is still
# running in the first window. Hits the unauth probes, then acquires a
# caller token and hits the authenticated /mcp endpoint.

. "$PSScriptRoot/_config.ps1"
. "$PSScriptRoot/_state.ps1"

$baseUrl = "http://${MCP_HOST}:${MCP_PORT}"

Write-Host "==> healthz"
curl.exe -s  "$baseUrl/healthz"; Write-Host ''

Write-Host "==> readyz"
curl.exe -s  "$baseUrl/readyz";  Write-Host ''

Write-Host "==> /mcp without token (expect 401)"
curl.exe -i  "$baseUrl/mcp"

Write-Host "==> Acquiring caller token for $APP_IDENTIFIER"
$CALLER_TOKEN = az account get-access-token --resource $APP_IDENTIFIER --query accessToken -o tsv
if (-not $CALLER_TOKEN) {
    throw "Failed to acquire caller token. Did Step 03's manual scope step complete?"
}

Write-Host "==> /mcp with token (full MCP handshake via SDK probe)"
$env:MCP_URL     = "$baseUrl/mcp"
$env:MCP_BEARER  = $CALLER_TOKEN
$env:MCP_PROFILE = 'sandbox'
node (Join-Path $MCP_REPO 'scripts/e2e-tests/_entra-probe.mjs')

Write-Host ""
Write-Host "Smoke tests done. Point your MCP client at $baseUrl/mcp with the same Authorization header."
Write-Host "See docs/e2e-tests/entra-e2e-with-agent-kit.md Step 4 Option A for the .vscode/mcp.json snippet."
