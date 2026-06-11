# 02-enable-entra-auth.ps1
# Enable Entra ID auth on the cluster (portal step), then grant the
# signed-in user `root@admin` on the Mongo data plane via the ARM REST API.
#
# Persists ME_OBJID to .state.json for later steps.
#
# Why REST and not `az cosmosdb mongocluster user create`?
#   The public `cosmosdb-preview` CLI extension (<= 1.6.2) does not yet
#   expose the user subgroup or the EntraID identity provider schema.
#   The Microsoft.DocumentDB/mongoClusters/users sub-resource exists in
#   ARM though, and we PUT to it directly with api-version 2026-06-01.

. "$PSScriptRoot/_config.ps1"
. "$PSScriptRoot/_state.ps1"

az account set --subscription $SUB | Out-Null

$ME_OBJID = az ad signed-in-user show --query id -o tsv
Write-Host "Signed-in user objectId: $ME_OBJID"
Save-State @{ ME_OBJID = $ME_OBJID }

# ---- 1. Confirm Entra auth is enabled on the cluster ----------------------
Write-Warning @"

Manual step in the Azure portal (one-time per cluster):
  Cosmos DB -> '$CLUSTER' -> Authentication (under 'Settings')
    - Microsoft Entra ID authentication = Enabled
    - (Recommended) Data API = Enabled
    - Save
"@
Read-Host -Prompt "Press <Enter> after Entra auth is enabled on the cluster"

# ---- 2. Create the Mongo data-plane user via ARM REST ---------------------
$API_VERSION = '2026-06-01'
$USER_BODY = @'
{
  "properties": {
    "identityProvider": {
      "type": "MicrosoftEntraID",
      "properties": { "principalType": "User" }
    },
    "roles": [
      { "db": "admin", "role": "root" }
    ]
  }
}
'@

$USER_URI = "https://management.azure.com/subscriptions/$SUB/resourceGroups/$RG/providers/Microsoft.DocumentDB/mongoClusters/$CLUSTER/users/$ME_OBJID" +
            "?api-version=$API_VERSION"

# az rest --body on PowerShell needs the JSON on one line to avoid quoting issues.
$bodyOneLine = ($USER_BODY -replace "`r?`n", ' ' -replace '\s+', ' ').Trim()

Write-Host "Creating Mongo Entra user $ME_OBJID on cluster $CLUSTER..."
az rest --method put --uri $USER_URI --body $bodyOneLine | Out-Null
Write-Host "User created."

# ---- 3. Verify by acquiring a backend access token ------------------------
$expires = az account get-access-token `
  --resource https://ossrdbms-aad.database.windows.net `
  --query expiresOn -o tsv
if (-not $expires) {
    throw "Failed to acquire a backend access token. Is 'az login' valid for this tenant?"
}
Write-Host "Backend token OK (expiresOn = $expires)."

Write-Host ""
Write-Host "Entra auth wired up. Data-plane propagation can take up to ~60s before"
Write-Host "the cluster will accept the new user. By the time you finish the portal"
Write-Host "app registration in step 03 the user will be live."
Write-Host ""
Write-Host "Next: ./03-register-app.ps1"
