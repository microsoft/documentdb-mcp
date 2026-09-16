# 99-teardown.ps1
# Destructive. Removes the resource group AND the Entra app registration.
# Re-prompts before doing anything.

. "$PSScriptRoot/_config.ps1"
. "$PSScriptRoot/_state.ps1"

$state = Load-State
$APP_ID = $state.APP_ID

Write-Warning "About to delete:"
Write-Warning "  - Resource group: $RG (subscription $SUB)"
if ($APP_ID) { Write-Warning "  - App registration: $APP_ID ($APP_DISPLAY_NAME)" }

$confirm = Read-Host -Prompt "Type 'DELETE' to confirm"
if ($confirm -ne 'DELETE') {
    Write-Host "Aborted."
    exit 1
}

az group delete --name $RG --yes --no-wait
if ($APP_ID) {
    az ad app delete --id $APP_ID
}

if (Test-Path $STATE_FILE) {
    Remove-Item $STATE_FILE
}

Write-Host "Teardown initiated. Resource group deletion runs async; check with: az group show -n $RG"
