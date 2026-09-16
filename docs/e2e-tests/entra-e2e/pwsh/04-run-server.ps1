# 04-run-server.ps1
# Build the MCP server and launch it with Entra on both surfaces.
# This blocks in the foreground -- leave the window open and run step 05
# from a SECOND PowerShell window.

. "$PSScriptRoot/_config.ps1"
. "$PSScriptRoot/_state.ps1"

$state = Load-State
$APP_ID    = $state.APP_ID
$TENANT_ID = $state.TENANT_ID
if (-not $APP_ID -or -not $TENANT_ID) {
    throw "APP_ID / TENANT_ID missing from state. Run ./03-register-app.ps1 first."
}

Push-Location $MCP_REPO
try {
    # Build (skip if already built and unchanged).
    npm run build

    # Caller-auth surface.
    $env:TRANSPORT        = 'streamable-http'
    $env:HOST             = $MCP_HOST
    $env:PORT             = $MCP_PORT
    $env:AUTH_REQUIRED    = 'true'
    $env:ENTRA_TENANT_ID  = $TENANT_ID
    # Audience must match the JWT's `aud` claim. App registrations created in the portal
    # default to accessTokenAcceptedVersion=2, which issues v2.0 tokens whose `aud` is
    # the bare app GUID (not the api://... URI). Set ENTRA_AUDIENCE to APP_ID.
    # If you change the manifest to accessTokenAcceptedVersion=1, switch this to APP_IDENTIFIER.
    $env:ENTRA_AUDIENCE   = $APP_ID

    # Authorization: map the `user_impersonation` delegated scope (carried in the JWT's
    # `scp` claim) to all three MCP tool tiers so the caller can exercise read/write/management.
    # For a production deployment, expose dedicated scopes (e.g. mcp.read / mcp.write) and
    # map each tier accordingly instead of granting everything to a single scope.
    $env:MCP_READ_ROLE_VALUES       = 'user_impersonation'
    $env:MCP_WRITE_ROLE_VALUES      = 'user_impersonation'
    $env:MCP_MANAGEMENT_ROLE_VALUES = 'user_impersonation'

    # Capability gates: write/management tools are disabled by default. Opt in for e2e.
    $env:ENABLE_WRITE_TOOLS      = 'true'
    $env:ENABLE_MANAGEMENT_TOOLS = 'true'

    # Backend-auth surface (Entra OIDC against DocumentDB).
    # Double-quoted here-string so $CLUSTER expands but JSON quoting is preserved.
    $env:CONNECTION_PROFILES = @"
{"sandbox":{"authMode":"entra","endpoint":"$CLUSTER.mongocluster.cosmos.azure.com","tokenScope":"https://ossrdbms-aad.database.windows.net/.default","allowedHosts":["*.mongocluster.cosmos.azure.com"],"allowedRoles":["read","write"]}}
"@

    # Make sure DefaultAzureCredential has something to use for the backend.
    az login --tenant $TENANT_ID | Out-Null

    Write-Host "Starting MCP server on http://${MCP_HOST}:${MCP_PORT} ..."
    Write-Host "Leave this window running. In a separate shell run ./05-smoke-tests.ps1"
    node dist/main.js
}
finally {
    Pop-Location
}
