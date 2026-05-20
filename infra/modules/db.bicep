@description('PostgreSQL Flexible Server — Burstable B1ms · 128 GB Premium SSD P10 · Dev/Test')
param serverName string
param location string
param tags object

@description('Object ID of the Entra principal that will be Postgres admin')
param adminObjectId string

@description('Display/UPN of the Entra principal')
param adminLogin string

@allowed([ 'User', 'Group', 'ServicePrincipal' ])
param adminType string = 'User'

@description('Object ID of the API managed identity (will be granted DB access)')
param apiPrincipalId string

@description('Name of the API managed identity (Postgres role name)')
param apiPrincipalName string

@description('Postgres version')
@allowed([ '14', '15', '16' ])
param version string = '16'

resource pg 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: serverName
  location: location
  tags: tags
  sku: {
    name: 'Standard_B1ms'
    tier: 'Burstable'
  }
  properties: {
    version: version
    storage: {
      storageSizeGB: 128
      tier: 'P10'
      autoGrow: 'Disabled'
    }
    backup: {
      backupRetentionDays: 7
      geoRedundantBackup: 'Disabled'
    }
    highAvailability: { mode: 'Disabled' }
    authConfig: {
      activeDirectoryAuth: 'Enabled'
      passwordAuth: 'Disabled'
      tenantId: subscription().tenantId
    }
    network: {
      publicNetworkAccess: 'Enabled'
    }
  }
}

// NOTE: Postgres Entra administrators are managed out-of-band via az CLI,
// because including them in the same Bicep deployment as the server triggers
// AadAuthOperationCannotBePerformedWhenServerIsNotAccessible during server updates.
// See post-deployment runbook for the `az postgres flexible-server microsoft-entra-admin create` commands.

resource db'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: pg
  name: 'apex'
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

// Allow Azure services (Functions) to reach DB
resource fwAzure 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = {
  parent: pg
  name: 'AllowAllAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

output fqdn string = pg.properties.fullyQualifiedDomainName
output databaseName string = db.name
output serverId string = pg.id
