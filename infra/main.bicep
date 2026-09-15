// Vibe Check agent on Azure: Functions (Node 20, consumption), Storage, Cosmos DB (serverless),
// Application Insights, Key Vault for the agent token. Deploy: infra/deploy.sh
param location string = resourceGroup().location
param name string = 'vibecheck'
param agentToken string

var suffix = uniqueString(resourceGroup().id)

resource storage 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: toLower('${name}st${suffix}')
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
}

resource insights 'Microsoft.Insights/components@2020-02-02' = {
  name: '${name}-insights'
  location: location
  kind: 'web'
  properties: { Application_Type: 'web' }
}

resource cosmos 'Microsoft.DocumentDB/databaseAccounts@2023-04-15' = {
  name: toLower('${name}-cosmos-${suffix}')
  location: location
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    capabilities: [ { name: 'EnableServerless' } ]
    locations: [ { locationName: location, failoverPriority: 0 } ]
  }
}

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: toLower('${name}-kv-${suffix}')
  location: location
  properties: { sku: { family: 'A', name: 'standard' }, tenantId: subscription().tenantId, enableRbacAuthorization: true }
}

resource tokenSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: vault
  name: 'agent-token'
  properties: { value: agentToken }
}

resource plan 'Microsoft.Web/serverfarms@2023-01-01' = {
  name: '${name}-plan'
  location: location
  sku: { name: 'Y1', tier: 'Dynamic' }
}

resource func 'Microsoft.Web/sites@2023-01-01' = {
  name: '${name}-agent-${suffix}'
  location: location
  kind: 'functionapp'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'Node|20'
      appSettings: [
        { name: 'AzureWebJobsStorage', value: 'DefaultEndpointsProtocol=https;AccountName=${storage.name};AccountKey=${storage.listKeys().keys[0].value}' }
        { name: 'FUNCTIONS_EXTENSION_VERSION', value: '~4' }
        { name: 'FUNCTIONS_WORKER_RUNTIME', value: 'node' }
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: insights.properties.ConnectionString }
        { name: 'AGENT_TOKEN', value: '@Microsoft.KeyVault(SecretUri=${tokenSecret.properties.secretUri})' }
        { name: 'COSMOS_ENDPOINT', value: cosmos.properties.documentEndpoint }
      ]
    }
  }
}

output functionUrl string = 'https://${func.properties.defaultHostName}/api'
output cosmosEndpoint string = cosmos.properties.documentEndpoint
