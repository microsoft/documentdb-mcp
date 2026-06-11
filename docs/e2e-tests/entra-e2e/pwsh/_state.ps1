# _state.ps1
# Tiny helpers so each step can persist + reload derived values
# (objectId, appId, tenantId) without re-querying Azure.
# Dot-source after _config.ps1:
#     . "$PSScriptRoot/_state.ps1"

function Save-State {
    param([Parameter(Mandatory)][hashtable]$Values)

    $existing = @{}
    if (Test-Path $STATE_FILE) {
        $existing = Get-Content $STATE_FILE -Raw | ConvertFrom-Json -AsHashtable
    }
    foreach ($k in $Values.Keys) { $existing[$k] = $Values[$k] }
    $existing | ConvertTo-Json -Depth 4 | Set-Content $STATE_FILE -Encoding utf8
    Write-Host "Saved state -> $STATE_FILE"
}

function Load-State {
    if (-not (Test-Path $STATE_FILE)) {
        throw "State file not found: $STATE_FILE. Run earlier steps first."
    }
    return Get-Content $STATE_FILE -Raw | ConvertFrom-Json -AsHashtable
}
