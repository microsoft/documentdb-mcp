#!/usr/bin/env bash
# _config.sh
# Shared configuration for the entra-e2e step scripts.
# Source from each step:
#     source "$(dirname "${BASH_SOURCE[0]}")/_config.sh"

set -euo pipefail

# ---- Resource naming suffix ------------------------------------------------
# Bump this to spin up a parallel environment (e.g. '01' -> '02') without
# colliding with existing resources. Applied to RG, cluster, and app name.
SUFFIX='01'

# ---- Azure subscription + resource group ----------------------------------
SUB='<your-subscription-guid>'
RG="documentdb-mcp-e2e${SUFFIX}"
LOCATION='westus2'

# ---- DocumentDB / Mongo cluster -------------------------------------------
CLUSTER="documentdb-mcp-e2e${SUFFIX}"        # lowercase, globally unique
ADMIN_USER='clusteradmin'
ADMIN_PASSWORD='<change-me-strong-password>' # >=8 chars, mixed case + digit + symbol

# ---- Entra app registration (MCP server caller auth) ----------------------
APP_DISPLAY_NAME="documentdb-mcp-dev${SUFFIX}"
# Application ID URI as set on the app registration's 'Expose an API' blade.
# The portal default is 'api://<app-id-guid>'; some tenants accept the friendly
# form 'api://documentdb-mcp-dev<suffix>'. Whatever it is, the caller-token
# resource (step 05) and the server's ENTRA_AUDIENCE (step 04) must match.
# Step 03 will print a warning + prompt to update this if it doesn't match the
# app you registered.
APP_IDENTIFIER='api://<your-app-id-guid>'

# ---- Local MCP repo + server transport ------------------------------------
# Path to your local clone of the documentdb-mcp repo.
MCP_REPO="${HOME}/path/to/documentdb-mcp"
MCP_HOST='127.0.0.1'
MCP_PORT='8070'

# ---- State file shared between steps --------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_FILE="${SCRIPT_DIR}/.state.json"
