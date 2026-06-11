#!/usr/bin/env bash
# 01-provision-cluster.sh
# Provision the DocumentDB (Cosmos DB Mongo vCore) cluster + firewall rule.
# Takes 5-10 minutes; blocks until provisioningState = Succeeded.
# Idempotent.

set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${HERE}/_config.sh"

# ---- subscription + resource group ----------------------------------------
az account set --subscription "$SUB"
az group create --name "$RG" --location "$LOCATION" >/dev/null

# ---- cluster (skip if it already exists) ----------------------------------
existing="$(az cosmosdb mongocluster show \
  --resource-group "$RG" --cluster-name "$CLUSTER" \
  --query name -o tsv 2>/dev/null || true)"

if [[ -n "$existing" ]]; then
    echo "Cluster '$CLUSTER' already exists in '$RG'; skipping create."
else
    # Smallest dev-friendly tier (M10, single node, 32 GB). Bump for real workloads.
    az cosmosdb mongocluster create \
      --resource-group "$RG" \
      --cluster-name "$CLUSTER" \
      --location "$LOCATION" \
      --administrator-login "$ADMIN_USER" \
      --administrator-login-password "$ADMIN_PASSWORD" \
      --shard-node-tier M10 \
      --shard-node-ha false \
      --shard-node-disk-size-gb 32 \
      --shard-node-count 1 \
      --server-version 7.0
fi

# ---- firewall: allow current public IP ------------------------------------
MY_IP="$(curl -fsSL https://api.ipify.org)"
echo "Detected public IP: $MY_IP"

rule_exists="$(az cosmosdb mongocluster firewall rule show \
  --resource-group "$RG" --cluster-name "$CLUSTER" --rule-name allow-my-ip \
  --query name -o tsv 2>/dev/null || true)"

if [[ -n "$rule_exists" ]]; then
    echo "Firewall rule 'allow-my-ip' already exists; updating to $MY_IP."
    az cosmosdb mongocluster firewall rule update \
      --resource-group "$RG" --cluster-name "$CLUSTER" --rule-name allow-my-ip \
      --start-ip-address "$MY_IP" --end-ip-address "$MY_IP" >/dev/null
else
    az cosmosdb mongocluster firewall rule create \
      --resource-group "$RG" --cluster-name "$CLUSTER" --rule-name allow-my-ip \
      --start-ip-address "$MY_IP" --end-ip-address "$MY_IP" >/dev/null
fi

# ---- wait for provisioning to finish --------------------------------------
while true; do
    state="$(az cosmosdb mongocluster show \
      --resource-group "$RG" --cluster-name "$CLUSTER" \
      --query properties.provisioningState -o tsv)"
    echo "provisioningState = $state"
    case "$state" in
        Succeeded|Failed|Canceled) break ;;
    esac
    sleep 30
done

if [[ "$state" != "Succeeded" ]]; then
    echo "ERROR: Cluster did not reach Succeeded state (current: $state)" >&2
    exit 1
fi

echo "Cluster provisioned. Next: ./02-enable-entra-auth.sh"
