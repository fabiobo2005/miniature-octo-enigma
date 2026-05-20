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

@description('Postgres admin Entra principal object id')
param postgresAdminObjectId string

@description('Postgres admin Entra principal UPN/name')
param postgresAdminLogin string

@allowed([ 'User', 'Group', 'ServicePrincipal' ])
param postgresAdminType string = 'User'

@description('Placeholder image used until first azd deploy pushes real images')
param placeholderImage string = 'mcr.microsoft.com/k8se/quickstart:latest'

@description('Image tag/path for apex-api (set by azd after build)')
param apiImage string = ''

@description('Image tag/path for apex-web (set by azd after build)')
param webImage string = ''

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

module acr 'modules/acr.bicep' = {
  scope: rg
  name: 'acr'
  params: {
    name: 'acrapex${resourceToken}'
    location: location
    tags: tags
  }
}

module acrRole 'modules/acr-role.bicep' = {
  scope: rg
  name: 'acrRole'
  params: {
    acrName: acr.outputs.name
    principalId: identity.outputs.principalId
  }
}

module acaEnv 'modules/aca-env.bicep' = {
  scope: rg
  name: 'acaEnv'
  params: {
    envName: 'cae-apex-${resourceToken}'
    workspaceName: 'log-apex-${resourceToken}'
    location: location
    tags: tags
  }
}

module acaApi 'modules/aca-api.bicep' = {
  scope: rg
  name: 'acaApi'
  params: {
    name: 'ca-apex-api'
    location: location
    tags: tags
    envId: acaEnv.outputs.id
    image: empty(apiImage) ? placeholderImage : apiImage
    userAssignedIdentityId: identity.outputs.id
    userAssignedIdentityClientId: identity.outputs.clientId
    acrLoginServer: acr.outputs.loginServer
    pgHost: db.outputs.fqdn
    pgDatabase: db.outputs.databaseName
    pgUser: identity.outputs.name
  }
  dependsOn: [ acrRole ]
}

module acaWeb 'modules/aca-web.bicep' = {
  scope: rg
  name: 'acaWeb'
  params: {
    name: 'ca-apex-web'
    location: location
    tags: tags
    envId: acaEnv.outputs.id
    image: empty(webImage) ? placeholderImage : webImage
    userAssignedIdentityId: identity.outputs.id
    acrLoginServer: acr.outputs.loginServer
    apiInternalFqdn: acaApi.outputs.internalFqdn
  }
  dependsOn: [ acrRole ]
}

output AZURE_LOCATION string = location
output AZURE_RESOURCE_GROUP string = rg.name
output AZURE_CONTAINER_REGISTRY_ENDPOINT string = acr.outputs.loginServer
output AZURE_CONTAINER_REGISTRY_NAME string = acr.outputs.name
output AZURE_CONTAINER_APPS_ENVIRONMENT_NAME string = acaEnv.outputs.name
output AZURE_CONTAINER_APP_API_NAME string = acaApi.outputs.name
output AZURE_CONTAINER_APP_WEB_NAME string = acaWeb.outputs.name
output WEB_URL string = 'https://${acaWeb.outputs.fqdn}'
output AZURE_POSTGRES_FQDN string = db.outputs.fqdn
output AZURE_POSTGRES_DATABASE string = db.outputs.databaseName
output AZURE_USER_ASSIGNED_IDENTITY_ID string = identity.outputs.id
output AZURE_USER_ASSIGNED_IDENTITY_CLIENT_ID string = identity.outputs.clientId
