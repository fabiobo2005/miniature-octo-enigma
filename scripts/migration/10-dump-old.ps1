# 10 — Dump do Postgres do ambiente ANTIGO (auth Entra/AAD).
# Pré-requisito: 'az login' no tenant ANTIGO + teu usuário é Entra admin do PG antigo.
. "$PSScriptRoot\_lib.ps1"

$envFile = Join-Path $Script:RepoRoot '.azure\apex-dev\.env'
if (-not (Test-Path $envFile)) { throw "Não encontrei $envFile. Está rodando da raiz do repo?" }

# Lê variáveis-chave do .env antigo
$envMap = @{}
foreach ($line in Get-Content $envFile) {
    if ($line -match '^(?<k>[A-Z_]+)="?(?<v>[^"]*)"?$') { $envMap[$Matches.k] = $Matches.v }
}
$oldPgFqdn = $envMap['AZURE_POSTGRES_FQDN']
$oldPgDb   = $envMap['AZURE_POSTGRES_DATABASE']
$oldTenant = $envMap['AZURE_TENANT_ID']
$oldSub    = $envMap['AZURE_SUBSCRIPTION_ID']
$oldLogin  = $envMap['POSTGRES_ADMIN_LOGIN']
if (-not $oldPgFqdn) { throw "AZURE_POSTGRES_FQDN não encontrado no .env" }

Write-Step "Antigo PG: $oldPgFqdn / db=$oldPgDb"
Write-Step "Tenant antigo: $oldTenant · Sub antiga: $oldSub · Admin: $oldLogin"

Write-Step 'Garantindo az login no tenant ANTIGO'
az account set --subscription $oldSub | Out-Null
$current = az account show --query '{sub:id,tenant:tenantId,user:user.name}' -o json | ConvertFrom-Json
if ($current.tenant -ne $oldTenant) {
    Write-Warn2 "Você está logado no tenant $($current.tenant), mas o antigo é $oldTenant."
    Write-Host "Rode: az login --tenant $oldTenant   (e depois rode este script novamente)"
    exit 1
}
Write-Ok "Logado como $($current.user) no tenant antigo"

Write-Step 'Pegando access token para Postgres'
$token = az account get-access-token --resource-type oss-rdbms --query accessToken -o tsv
if (-not $token) { throw 'Falha ao obter token' }

# Libera teu IP no firewall do PG antigo (o Bicep só permite Azure services).
Write-Step 'Liberando teu IP no firewall do PG antigo (temporário)'
$myIp = (Invoke-RestMethod -Uri 'https://api.ipify.org')
$oldPgName = ($oldPgFqdn -split '\.')[0]
$oldRgGuess = 'rg-apex-dev'
$fwRule = "migrate-dump-$(Get-Date -Format yyyyMMdd)"
az postgres flexible-server firewall-rule create `
    --resource-group $oldRgGuess --name $oldPgName `
    --rule-name $fwRule `
    --start-ip-address $myIp --end-ip-address $myIp | Out-Null
Write-Ok "IP $myIp liberado em $oldPgName"

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$dumpDir = Join-Path $PSScriptRoot 'backups'
New-Item -ItemType Directory -Force -Path $dumpDir | Out-Null
$dumpFile = Join-Path $dumpDir "apex-$timestamp.dump"

Write-Step "Executando pg_dump -> $dumpFile"
$env:PGPASSWORD = $token
$env:PGSSLMODE  = 'require'
& pg_dump `
    --host=$oldPgFqdn `
    --port=5432 `
    --username=$oldLogin `
    --dbname=$oldPgDb `
    --no-owner --no-acl `
    --format=custom `
    --verbose `
    --file=$dumpFile
$rc = $LASTEXITCODE
$env:PGPASSWORD = $null
if ($rc -ne 0) { throw "pg_dump falhou (exit $rc)" }

$size = (Get-Item $dumpFile).Length
Write-Ok ("Dump criado: $dumpFile ({0:N0} bytes)" -f $size)

# Snapshot também de schema-only e dados em SQL (útil pra inspeção)
$env:PGPASSWORD = $token
$schemaSql = Join-Path $dumpDir "apex-$timestamp.schema.sql"
& pg_dump --host=$oldPgFqdn --username=$oldLogin --dbname=$oldPgDb --no-owner --no-acl --schema-only --file=$schemaSql
$env:PGPASSWORD = $null
Write-Ok "Schema SQL: $schemaSql"

Set-State @{
    dumpFile = $dumpFile
    dumpedAt = $timestamp
    oldSub   = $oldSub
    oldTenant= $oldTenant
    oldPgFqdn= $oldPgFqdn
    oldPgDb  = $oldPgDb
}

Write-Step 'Removendo regra de firewall temporária'
az postgres flexible-server firewall-rule delete `
    --resource-group $oldRgGuess --name $oldPgName `
    --rule-name $fwRule --yes 2>$null | Out-Null
Write-Ok 'Firewall limpo'

Write-Host ''
Write-Step 'Próximo passo'
Write-Host '  az logout    # opcional, deslogar do tenant antigo'
Write-Host '  az login --tenant <novo-tenant-id>'
Write-Host '  .\20-bootstrap-new.ps1'
