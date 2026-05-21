param name string
param location string
param tags object
param envId string
param image string
param userAssignedIdentityId string
param acrLoginServer string
param apiInternalFqdn string

@secure()
@description('Shared secret that gates /db.html via nginx. Empty = page returns 404 always.')
param adminSecret string = ''

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: name
  location: location
  tags: union(tags, { 'azd-service-name': 'web' })
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${userAssignedIdentityId}': {} }
  }
  properties: {
    managedEnvironmentId: envId
    configuration: {
      activeRevisionsMode: 'Single'
      secrets: empty(adminSecret) ? [] : [
        {
          name: 'admin-secret'
          value: adminSecret
        }
      ]
      ingress: {
        external: true
        targetPort: 80
        transport: 'http'
        allowInsecure: false
      }
      registries: [
        {
          server: acrLoginServer
          identity: userAssignedIdentityId
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'web'
          image: image
          resources: { cpu: json('0.25'), memory: '0.5Gi' }
          env: concat([
            { name: 'API_HOST', value: apiInternalFqdn }
          ], empty(adminSecret) ? [] : [
            { name: 'ADMIN_SECRET', secretRef: 'admin-secret' }
          ])
          probes: [
            {
              type: 'Liveness'
              httpGet: { path: '/healthz', port: 80 }
              initialDelaySeconds: 5
              periodSeconds: 30
            }
          ]
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 3
      }
    }
  }
}

output id string = app.id
output name string = app.name
output fqdn string = app.properties.configuration.ingress.fqdn
