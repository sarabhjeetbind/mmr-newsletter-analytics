#!/usr/bin/env bash
# ============================================================
# Deploy the MMR Newsletter Analytics app + live proxy to Azure Container Apps.
# Run from the APP ROOT (the folder with the Dockerfile), NOT from server/:
#     cd "MMR Newsletter Analytics - OpenBI App"
#     bash server/deploy-azure.sh
# Prereqs: Azure CLI (`az login`), and the service principal + IDs from server/README.md.
# ============================================================
set -euo pipefail

# ---- fill these in (or export them before running) ----
RG="${RG:-rg-mmr-analytics}"
LOCATION="${LOCATION:-canadacentral}"
ENVIRONMENT="${ENVIRONMENT:-mmr-analytics-env}"
APP_NAME="${APP_NAME:-mmr-analytics}"

TENANT_ID="${TENANT_ID:?set TENANT_ID}"
CLIENT_ID="${CLIENT_ID:?set CLIENT_ID}"
CLIENT_SECRET="${CLIENT_SECRET:?set CLIENT_SECRET}"
WORKSPACE_ID="${WORKSPACE_ID:?set WORKSPACE_ID}"
DATASET_ID="${DATASET_ID:?set DATASET_ID}"

echo "==> resource group + container apps environment"
az group create -n "$RG" -l "$LOCATION" -o none
az containerapp env create -n "$ENVIRONMENT" -g "$RG" -l "$LOCATION" -o none 2>/dev/null || true

echo "==> build image from Dockerfile (context = current dir) and create the app"
az containerapp up \
  --name "$APP_NAME" -g "$RG" --environment "$ENVIRONMENT" \
  --ingress external --target-port 8787 \
  --source .

echo "==> store the client secret"
az containerapp secret set -n "$APP_NAME" -g "$RG" \
  --secrets sp-secret="$CLIENT_SECRET" -o none

echo "==> set environment variables (MOCK=false = real DAX against the model)"
az containerapp update -n "$APP_NAME" -g "$RG" -o none --set-env-vars \
  MOCK=false \
  TENANT_ID="$TENANT_ID" \
  CLIENT_ID="$CLIENT_ID" \
  CLIENT_SECRET=secretref:sp-secret \
  WORKSPACE_ID="$WORKSPACE_ID" \
  DATASET_ID="$DATASET_ID"

FQDN=$(az containerapp show -n "$APP_NAME" -g "$RG" --query properties.configuration.ingress.fqdn -o tsv)
echo ""
echo "✅ Deployed.  App URL:  https://$FQDN"
echo "   Verify data:        https://$FQDN/api/mmr   (check _meta.liveFields)"
echo "   Health:             https://$FQDN/healthz"
echo "   Embed in Fabric:    iframe this URL in a Web-content tile (see DEPLOY.md, Step 2)"
