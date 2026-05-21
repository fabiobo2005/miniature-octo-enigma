param name string
param location string
param tags object
param envId string
param image string
param userAssignedIdentityId string
param userAssignedIdentityClientId string
param acrLoginServer string
param pgHost string
param pgDatabase string
param pgUser string

@description('Comma-separated list of allowed CORS origins (full URL incl. scheme). Empty = allow all (dev only).')
param allowedOrigins string = ''

@secure()
@description('Shared secret protecting /api/db/inspect. Empty disables the endpoint (returns 404).')
param adminSecret string = ''

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: name
  location: location
  tags: union(tags, { 'azd-service-name': 'api' })
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
        external: false
        targetPort: 3000
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
          name: 'api'
          image: image
          resources: { cpu: json('0.25'), memory: '0.5Gi' }
          env: concat([
            { name: 'PORT', value: '3000' }
            { name: 'AZURE_CLIENT_ID', value: userAssignedIdentityClientId }
            { name: 'PG_HOST', value: pgHost }
            { name: 'PG_DATABASE', value: pgDatabase }
            { name: 'PG_USER', value: pgUser }
            { name: 'PG_PORT', value: '5432' }
            { name: 'PG_SSL', value: 'true' }
            { name: 'ALLOWED_ORIGINS', value: allowedOrigins }
          ], empty(adminSecret) ? [] : [
            { name: 'ADMIN_SECRET', secretRef: 'admin-secret' }
          ])
          probes: [
            {
              type: 'Liveness'
              httpGet: { path: '/health', port: 3000 }
              initialDelaySeconds: 10
              periodSeconds: 30
            }
            {
              type: 'Readiness'
              httpGet: { path: '/health', port: 3000 }
              initialDelaySeconds: 5
              periodSeconds: 10
            }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 3
      }
    }
  }
}

output id string = app.id
output name string = app.name
output internalFqdn string = app.properties.configuration.ingress.fqdn
