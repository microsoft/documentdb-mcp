# _config.ps1
# Shared configuration for the entra-e2e step scripts.
# Edit the values below, then dot-source from each step:
#     . "$PSScriptRoot/_config.ps1"

$ErrorActionPreference = 'Stop'

# ---- Resource naming suffix ------------------------------------------------
# Bump this to spin up a parallel environment (e.g. '01' -> '02') without
# colliding with existing resources. Applied to RG, cluster, and app name.
$SUFFIX         = '01'

# ---- Azure subscription + resource group ----------------------------------
$SUB            = '<your-subscription-guid>'
$RG             = "documentdb-mcp-e2e$SUFFIX"
$LOCATION       = 'westus2'

# ---- DocumentDB / Mongo cluster -------------------------------------------
$CLUSTER        = "documentdb-mcp-e2e$SUFFIX"       # lowercase, globally unique
$ADMIN_USER     = 'clusteradmin'
$ADMIN_PASSWORD = '<change-me-strong-password>'     # >=8 chars, mixed case + digit + symbol

# ---- Entra app registration (MCP server caller auth) ----------------------
$APP_DISPLAY_NAME = "documentdb-mcp-dev$SUFFIX"
# Application ID URI as set on the app registration's 'Expose an API' blade.
# The portal default is `api://<app-id-guid>`; some tenants accept the friendly
# form `api://documentdb-mcp-dev<suffix>`. Whatever it is, the caller-token
# `resource` (step 05) and the server's `ENTRA_AUDIENCE` (step 04) must match.
# Step 03 will print a warning + prompt to update this if it doesn't match the
# app you registered.
$APP_IDENTIFIER   = 'api://<your-app-id-guid>'

# ---- Local MCP repo + server transport ------------------------------------
# When running from Windows PowerShell against a WSL-hosted repo, use the UNC
# path. When running from pwsh inside WSL itself, a native path works.
if ($IsWindows -or $PSVersionTable.Platform -eq 'Win32NT' -or [string]::IsNullOrEmpty($PSVersionTable.Platform)) {
    $MCP_REPO = '\\wsl.localhost\Ubuntu\home\<your-wsl-user>\path\to\documentdb-mcp'
} else {
    $MCP_REPO = "$HOME/path/to/documentdb-mcp"
}
$MCP_HOST    = '127.0.0.1'
$MCP_PORT    = '8070'

# ---- State file shared between steps --------------------------------------
$STATE_FILE = Join-Path $PSScriptRoot '.state.json'

# ---- Workaround: cmd.exe (invoked by az.cmd on Windows) cannot use a UNC cwd
# When these scripts are run from \\wsl.localhost\... PowerShell, every az
# call prints "UNC paths are not supported. Defaulting to Windows directory."
# $PWD.Path includes the PSProvider prefix when accessed via FileSystem::,
# so use $PWD.ProviderPath which is always the native filesystem path.
if ($PWD.ProviderPath.StartsWith('\\')) {
    Write-Host "Running from UNC cwd; switching to $env:TEMP to silence cmd.exe warnings"
    Set-Location -Path $env:TEMP
    [System.Environment]::CurrentDirectory = $env:TEMP
}
