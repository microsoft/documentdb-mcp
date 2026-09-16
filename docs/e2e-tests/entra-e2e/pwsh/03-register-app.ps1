# 03-register-app.ps1
# Wire up an Entra app registration for the MCP server's caller auth and
# persist APP_ID + TENANT_ID to .state.json.
#
# Two paths depending on your tenant:
#   A) Generic tenant:        `az ad app create` succeeds.
#   B) Microsoft corp tenant: portal-only -- the tenant requires a Service
#      Tree GUID on every app, which `az ad app create` cannot set today.
#
# This script tries (A) first; if it fails it walks you through (B) and
# asks you to paste the AppId of the manually-registered app. Either way
# you still have to do the "Expose an API -> Add a scope" portal step
# because the CLI cannot publish OAuth2 scopes cleanly.

. "$PSScriptRoot/_config.ps1"
. "$PSScriptRoot/_state.ps1"

$TENANT_ID = az account show --query tenantId -o tsv
Write-Host "Tenant: $TENANT_ID"

# ---- Reuse existing app, if one already matches APP_IDENTIFIER ------------
$APP_ID = az ad app list --identifier-uri $APP_IDENTIFIER --query "[0].appId" -o tsv 2>$null
if ($APP_ID) {
    Write-Host "Reusing existing app registration: $APP_ID"
}

# ---- Path A: try `az ad app create` --------------------------------------
if (-not $APP_ID) {
    $APP_ID = az ad app create `
        --display-name $APP_DISPLAY_NAME `
        --identifier-uris $APP_IDENTIFIER `
        --query appId -o tsv 2>$null
    if ($APP_ID) {
        az ad sp create --id $APP_ID | Out-Null
        Write-Host "Created app registration via CLI: $APP_ID"
    }
}

# ---- Path B: fall back to manual portal registration ---------------------
if (-not $APP_ID) {
    Write-Warning @"

CLI app creation failed (this is expected on the Microsoft corp tenant, which
requires a Service Tree GUID that 'az ad app create' cannot supply).

Register the app manually in the Azure portal:

  1. Microsoft Entra ID -> App registrations -> '+ New registration'
       Name:                $APP_DISPLAY_NAME
       Supported accounts:  Accounts in this organizational directory only
       Redirect URI:        (leave blank)
       Register
  2. (Corp tenant only) -> Properties -> Set 'Service Management Reference'
       to your Service Tree GUID. Save.
  3. -> Expose an API
       Application ID URI -> 'Add' -> accept the default
         api://<the-new-app-id-guid>
       NOTE: copy this value -- it must match `$APP_IDENTIFIER in _config.ps1.
"@
    $APP_ID = (Read-Host -Prompt "Paste the AppId (the GUID, NOT the api://... URI)").Trim()
    if (-not $APP_ID) { throw "no AppId supplied; aborting." }
    Write-Host "Using AppId: $APP_ID"

    $expected = "api://$APP_ID"
    if ($APP_IDENTIFIER -ne $expected) {
        Write-Warning @"

APP_IDENTIFIER in _config.ps1 is currently:
    $APP_IDENTIFIER
but the standard portal value for the app you just created is:
    $expected

Update _config.ps1 and re-source it before running step 04, otherwise the
caller-token resource won't match the server's ENTRA_AUDIENCE.
"@
    }
}

Save-State @{ APP_ID = $APP_ID; TENANT_ID = $TENANT_ID }

# ---- Manual portal step (mandatory on BOTH paths): publish the scope ------
Write-Warning @"

Manual step in the Azure portal (one-time):

  App registrations -> $APP_DISPLAY_NAME -> Expose an API

  1. 'Scopes defined by this API' -> Add a scope
       Scope name:             user_impersonation
       Who can consent:        Admins and users
       Admin consent display:  Access DocumentDB MCP
       Admin consent desc:     Allow the app to access DocumentDB MCP on behalf of the signed-in user.
       User consent display:   Access DocumentDB MCP
       User consent desc:      Allow the app to access DocumentDB MCP on your behalf.
       State:                  Enabled
       Add scope

  2. (Recommended) 'Authorized client applications' -> Add a client application
       Client ID:              04b07795-8ddb-461a-bbee-02f9e1bf7b46    (Microsoft Azure CLI)
       Tick the user_impersonation scope -> Add application
     This pre-authorizes the Azure CLI, so step 05 won't prompt for consent.

The CLI cannot publish OAuth2 scopes cleanly today; this is the only mandatory
manual step on a generic tenant, and the second one on the corp tenant.
"@

Read-Host -Prompt "Press <Enter> once the scope has been added to continue" | Out-Null
Write-Host "Done. Next: ./04-run-server.ps1"
