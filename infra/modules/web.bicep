param name string
param location string
param tags object
param apiResourceId string

resource swa 'Microsoft.Web/staticSites@2023-12-01' = {
  name: name
  location: location
  tags: union(tags, { 'azd-service-name': 'web' })
  sku: {
    name: 'Free'
    tier: 'Free'
  }
  properties: {
    provider: 'Custom'
    buildProperties: {
      skipGithubActionWorkflowGeneration: true
    }
  }
}

resource backend 'Microsoft.Web/staticSites/linkedBackends@2023-12-01' = {
  parent: swa
  name: 'api'
  properties: {
    backendResourceId: apiResourceId
    region: 'centralus'
  }
}

output id string = swa.id
output name string = swa.name
output defaultHostname string = 'https://${swa.properties.defaultHostname}'
