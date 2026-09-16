#!/usr/bin/env bash
# 99-teardown.sh
# Destructive. Removes the resource group AND the Entra app registration.
# Re-prompts before doing anything.

set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${HERE}/_config.sh"
source "${HERE}/_state.sh"

APP_ID="$(load_state APP_ID)"

cat <<EOF >&2
WARNING: About to delete:
  - Resource group: ${RG} (subscription ${SUB})
EOF
if [[ -n "$APP_ID" ]]; then
    echo "  - App registration: ${APP_ID} (${APP_DISPLAY_NAME})" >&2
fi

read -r -p "Type 'DELETE' to confirm: " confirm
if [[ "$confirm" != "DELETE" ]]; then
    echo "Aborted."
    exit 1
fi

az group delete --name "$RG" --yes --no-wait
if [[ -n "$APP_ID" ]]; then
    az ad app delete --id "$APP_ID"
fi

if [[ -f "$STATE_FILE" ]]; then
    rm -f "$STATE_FILE"
fi

echo "Teardown initiated. Resource group deletion runs async; check with: az group show -n $RG"
