#!/usr/bin/env bash
# 02-enable-entra-auth.sh
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

set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${HERE}/_config.sh"
source "${HERE}/_state.sh"

# Make sure we are on the right subscription -- helpful when az defaults
# to a different sub from a previous session.
az account set --subscription "$SUB"

ME_OBJID="$(az ad signed-in-user show --query id -o tsv)"
echo "Signed-in user objectId: $ME_OBJID"
save_state ME_OBJID "$ME_OBJID"

# ---- 1. Confirm Entra auth is enabled on the cluster ----------------------
# The CLI extension cannot toggle this yet, so this is a portal step.
cat <<EOF >&2

Manual step in the Azure portal (one-time per cluster):
  Cosmos DB -> '${CLUSTER}' -> Authentication (under 'Settings')
    - Microsoft Entra ID authentication = Enabled
    - (Recommended) Data API = Enabled
    - Save

EOF
read -r -p "Press <Enter> after Entra auth is enabled on the cluster: " _

# ---- 2. Create the Mongo data-plane user via ARM REST ---------------------
# api-version 2026-06-01 and 2025-09-01 both accept the EntraID schema with
# role=root on db=admin. Older api-versions (2024-07-01, 2024-10-01-preview)
# still require a password and reject EntraID-only users.
API_VERSION='2026-06-01'
USER_BODY=$(cat <<EOF
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
EOF
)

USER_URI="https://management.azure.com/subscriptions/${SUB}/resourceGroups/${RG}/providers/Microsoft.DocumentDB/mongoClusters/${CLUSTER}/users/${ME_OBJID}?api-version=${API_VERSION}"

echo "Creating Mongo Entra user ${ME_OBJID} on cluster ${CLUSTER}..."
az rest --method put --uri "$USER_URI" --body "$USER_BODY" >/dev/null
echo "User created."

# ---- 3. Verify by acquiring a backend access token ------------------------
expires="$(az account get-access-token \
  --resource https://ossrdbms-aad.database.windows.net \
  --query expiresOn -o tsv)"
if [[ -z "$expires" ]]; then
    echo "ERROR: Failed to acquire a backend access token. Is 'az login' valid for this tenant?" >&2
    exit 1
fi
echo "Backend token OK (expiresOn = $expires)."

echo
echo "Entra auth wired up. Data-plane propagation can take up to ~60s before"
echo "the cluster will accept the new user. By the time you finish the portal"
echo "app registration in step 03 the user will be live."
echo
echo "Next: ./03-register-app.sh"
