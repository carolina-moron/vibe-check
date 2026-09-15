#!/usr/bin/env bash
# Deploys the Vibe Check agent skills to Azure. Needs: az CLI (logged in), Azure Functions Core Tools.
# Usage: infra/deploy.sh <resource-group> [location]
set -euo pipefail
RG=${1:?resource group}; LOC=${2:-eastus}
TOKEN=${AGENT_TOKEN:-$(openssl rand -hex 24)}
az group create -n "$RG" -l "$LOC" >/dev/null
OUT=$(az deployment group create -g "$RG" -f "$(dirname "$0")/main.bicep" -p agentToken="$TOKEN" --query properties.outputs -o json)
APP=$(az functionapp list -g "$RG" --query "[0].name" -o tsv)
( cd "$(dirname "$0")/../azure" && npm install --silent && cp -R ../src ../scripts ../data . && func azure functionapp publish "$APP" --javascript )
echo "Skills URL: $(echo "$OUT" | python3 -c 'import json,sys;print(json.load(sys.stdin)["functionUrl"]["value"])')"
echo "AGENT_TOKEN: $TOKEN   (paste into Copilot Studio as the bearer token; then import docs/agent-openapi.yaml)"
