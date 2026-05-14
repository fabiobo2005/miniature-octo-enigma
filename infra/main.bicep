targetScope = 'subscription'

@description('Environment name (azd)')
param environmentName string

@description('Primary location')
param location string = 'centralus'

@description('Common tags applied to all resources')
param tags object = {
  Application: 'apex'
  Contact: 'faoliveira'
  CostCenter: 'Hybrid'
  Environment: 'dev'
  Owner: 'faoliveira'
  Tier: 'dev'
  Workload: 'dev'
  'azd-env-name': environmentName
}

@description('PostgreSQL administrator login (Entra group/user object id)')
param postgresAdminObjectId string

@description('PostgreSQL administrator login name (UPN of the Entra user)')
param postgresAdminLogin string

@description('PostgreSQL administrator type')
@allowed([ 'User', 'Group', 'ServicePrincipal' ])
param postgresAdminType string = 'User'

var resourceToken = uniqueString(subscription().id, environmentName, location)
var rgName = 'rg-${environmentName}'

resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: rgName
  location: location
  tags: tags
}

module identity 'modules/identity.bicep' = {
  scope: rg
  name: 'identity'
  params: {
    name: 'id-apex-${resourceToken}'
    location: location
    tags: tags
  }
}

module monitoring 'modules/monitoring.bicep' = {
  scope: rg
  name: 'monitoring'
  params: {
    workspaceName: 'log-apex-${resourceToken}'
    appInsightsName: 'appi-apex-${resourceToken}'
    location: location
    tags: tags
  }
}

module db 'modules/db.bicep' = {
  scope: rg
  name: 'db'
  params: {
    serverName: 'psql-apex-${resourceToken}'
    location: location
    tags: tags
    adminObjectId: postgresAdminObjectId
    adminLogin: postgresAdminLogin
    adminType: postgresAdminType
    apiPrincipalId: identity.outputs.principalId
    apiPrincipalName: identity.outputs.name
  }
}

module api 'modules/api.bicep' = {
  scope: rg
  name: 'api'
  params: {
    functionAppName: 'func-apex-${resourceToken}'
    storageName: 'stapex${resourceToken}'
    planName: 'plan-apex-${resourceToken}'
    location: location
    tags: tags
    userAssignedIdentityId: identity.outputs.id
    userAssignedIdentityClientId: identity.outputs.clientId
    appInsightsConnectionString: monitoring.outputs.appInsightsConnectionString
    pgHost: db.outputs.fqdn
    pgDatabase: db.outputs.databaseName
    pgUser: identity.outputs.name
  }
}

module web 'modules/web.bicep' = {
  scope: rg
  name: 'web'
  params: {
    name: 'stapp-apex-${resourceToken}'
    location: 'centralus'
    tags: tags
    apiResourceId: api.outputs.functionAppId
  }
}

output AZURE_LOCATION string = location
output AZURE_RESOURCE_GROUP string = rg.name
output AZURE_FUNCTION_APP_NAME string = api.outputs.functionAppName
output AZURE_STATIC_WEB_APP_NAME string = web.outputs.name
output AZURE_STATIC_WEB_APP_URL string = web.outputs.defaultHostname
output AZURE_POSTGRES_FQDN string = db.outputs.fqdn
output AZURE_POSTGRES_DATABASE string = db.outputs.databaseName
output AZURE_USER_ASSIGNED_IDENTITY_ID string = identity.outputs.id
output AZURE_USER_ASSIGNED_IDENTITY_CLIENT_ID string = identity.outputs.clientId
