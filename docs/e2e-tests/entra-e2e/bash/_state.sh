#!/usr/bin/env bash
# _state.sh
# Tiny helpers so each step can persist + reload derived values
# (objectId, appId, tenantId) without re-querying Azure.
# Requires: jq
# Source after _config.sh:
#     source "$(dirname "${BASH_SOURCE[0]}")/_state.sh"

if ! command -v jq >/dev/null 2>&1; then
    echo "ERROR: 'jq' is required. Install with: sudo apt-get install -y jq" >&2
    exit 1
fi

# save_state KEY VALUE [KEY VALUE ...]
# Merges into existing state file.
save_state() {
    if [[ $(( $# % 2 )) -ne 0 ]]; then
        echo "save_state: expected key/value pairs, got $# args" >&2
        return 1
    fi
    local existing='{}'
    if [[ -f "$STATE_FILE" ]]; then
        existing="$(cat "$STATE_FILE")"
    fi
    local args=() filter='.'
    local i=0
    while [[ $# -gt 0 ]]; do
        local k="$1"; local v="$2"; shift 2
        args+=(--arg "k${i}" "$k" --arg "v${i}" "$v")
        filter+=" | .[\$k${i}] = \$v${i}"
        i=$((i + 1))
    done
    printf '%s' "$existing" | jq "${args[@]}" "$filter" > "$STATE_FILE"
    echo "Saved state -> $STATE_FILE"
}

# load_state KEY
# Echoes the value or empty string.
load_state() {
    local key="$1"
    if [[ ! -f "$STATE_FILE" ]]; then
        return 0
    fi
    jq -r --arg k "$key" '.[$k] // empty' "$STATE_FILE"
}

# require_state KEY ... ; aborts if any key is missing.
require_state() {
    if [[ ! -f "$STATE_FILE" ]]; then
        echo "ERROR: State file not found: $STATE_FILE. Run earlier steps first." >&2
        exit 1
    fi
    for key in "$@"; do
        local v
        v="$(load_state "$key")"
        if [[ -z "$v" ]]; then
            echo "ERROR: state key '$key' missing from $STATE_FILE. Re-run the step that produces it." >&2
            exit 1
        fi
    done
}
