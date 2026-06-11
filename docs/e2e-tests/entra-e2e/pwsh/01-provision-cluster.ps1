# 01-provision-cluster.ps1
# Provision the DocumentDB (Cosmos DB Mongo vCore) cluster + firewall rule.
# Takes 5-10 minutes; blocks until provisioningState = Succeeded.
# Idempotent: re-running with an existing cluster skips create and just
# (re)applies the firewall rule + verifies provisioning state.

. "$PSScriptRoot/_config.ps1"

# ---- subscription + resource group ----------------------------------------
az account set --subscription $SUB
az group create --name $RG --location $LOCATION | Out-Null

# ---- cluster (skip if it already exists) ----------------------------------
$existing = az cosmosdb mongocluster show `
  --resource-group $RG --cluster-name $CLUSTER `
  --query name -o tsv 2>$null

if ($existing) {
    Write-Host "Cluster '$CLUSTER' already exists in '$RG'; skipping create."
}
else {
    # Smallest dev-friendly tier (M10, single node, 32 GB). Bump for real workloads.
    az cosmosdb mongocluster create `
      --resource-group $RG `
      --cluster-name $CLUSTER `
      --location $LOCATION `
      --administrator-login $ADMIN_USER `
      --administrator-login-password $ADMIN_PASSWORD `
      --shard-node-tier M10 `
      --shard-node-ha false `
      --shard-node-disk-size-gb 32 `
      --shard-node-count 1 `
      --server-version 7.0
}

# ---- firewall: allow current public IP ------------------------------------
$MY_IP = (Invoke-RestMethod -Uri 'https://api.ipify.org').Trim()
Write-Host "Detected public IP: $MY_IP"

# Note: 'firewall rule' (space) on current az; older builds used 'firewall-rule'.
$ruleExists = az cosmosdb mongocluster firewall rule show `
  --resource-group $RG --cluster-name $CLUSTER --rule-name allow-my-ip `
  --query name -o tsv 2>$null

if ($ruleExists) {
    Write-Host "Firewall rule 'allow-my-ip' already exists; updating to $MY_IP."
    az cosmosdb mongocluster firewall rule update `
      --resource-group $RG --cluster-name $CLUSTER --rule-name allow-my-ip `
      --start-ip-address $MY_IP --end-ip-address $MY_IP | Out-Null
}
else {
    az cosmosdb mongocluster firewall rule create `
      --resource-group $RG --cluster-name $CLUSTER --rule-name allow-my-ip `
      --start-ip-address $MY_IP --end-ip-address $MY_IP | Out-Null
}

# ---- wait for provisioning to finish --------------------------------------
# provisioningState lives under .properties on this resource type.
do {
    $state = az cosmosdb mongocluster show `
      --resource-group $RG --cluster-name $CLUSTER `
      --query properties.provisioningState -o tsv
    Write-Host "provisioningState = $state"
    if ($state -eq 'Succeeded' -or $state -eq 'Failed' -or $state -eq 'Canceled') { break }
    Start-Sleep -Seconds 30
} while ($true)

if ($state -ne 'Succeeded') {
    throw "Cluster did not reach Succeeded state (current: $state)"
}

Write-Host "Cluster provisioned. Next: ./02-enable-entra-auth.ps1"
