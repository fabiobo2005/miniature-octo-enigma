# 40 — Restaura o dump (10-dump-old) no novo Postgres.
# Estratégia: drop+create do db 'apex' não é necessário (já criado pelo Bicep).
# Usa pg_restore com --clean --if-exists para idempotência.
. "$PSScriptRoot\_lib.ps1"

$s = Get-State
if (-not $s.dumpFile)  { throw 'dumpFile ausente. Rode 10-dump-old.ps1 antes.' }
if (-not $s.newPgFqdn) { throw 'newPgFqdn ausente. Rode 20-bootstrap-new.ps1 antes.' }
if (-not (Test-Path $s.dumpFile)) { throw "Dump não encontrado em $($s.dumpFile)" }

Write-Step 'Verificando conta Azure (precisa estar no NOVO tenant)'
$acct = az account show --query tenantId -o tsv
if ($acct -ne $s.newTenant) {
    throw "Tenant atual ($acct) != novo ($($s.newTenant)). Rode: az login --tenant $($s.newTenant)"
}

Write-Step 'Obtendo access token AAD para Postgres'
$token = az account get-access-token --resource-type oss-rdbms --query accessToken -o tsv
if (-not $token) { throw 'Falha ao obter token' }

# IP local precisa estar liberado no firewall (Bicep só permite Azure services).
Write-Step 'Liberando teu IP no firewall do PG (temporário)'
$myIp = (Invoke-RestMethod -Uri 'https://api.ipify.org')
$pgName = ($s.newPgFqdn -split '\.')[0]
az postgres flexible-server firewall-rule create `
    --resource-group $s.newRg --name $pgName `
    --rule-name "migrate-$(Get-Date -Format yyyyMMdd)" `
    --start-ip-address $myIp --end-ip-address $myIp | Out-Null
Write-Ok "IP $myIp liberado"

Write-Step "pg_restore -> $($s.newPgFqdn)/$($s.newPgDb)"
$env:PGPASSWORD = $token
$env:PGSSLMODE  = 'require'
& pg_restore `
    --host=$s.newPgFqdn `
    --port=5432 `
    --username=$s.deployerUpn `
    --dbname=$s.newPgDb `
    --no-owner --no-acl `
    --clean --if-exists `
    --verbose `
    $s.dumpFile
$rc = $LASTEXITCODE
$env:PGPASSWORD = $null

if ($rc -ne 0) { Write-Warn2 "pg_restore exit=$rc (alguns warnings são esperados em --clean)" }
else { Write-Ok 'Restore concluído sem erros' }

Write-Step "Removendo regra de firewall temporária"
az postgres flexible-server firewall-rule delete `
    --resource-group $s.newRg --name $pgName `
    --rule-name "migrate-$(Get-Date -Format yyyyMMdd)" --yes | Out-Null

Write-Step "Smoke test: contagem de tabelas"
$env:PGPASSWORD = (az account get-access-token --resource-type oss-rdbms --query accessToken -o tsv)
& psql "host=$($s.newPgFqdn) port=5432 dbname=$($s.newPgDb) user=$($s.deployerUpn) sslmode=require" `
    -c "SELECT schemaname, count(*) FROM pg_tables WHERE schemaname IN ('app','saude','dieta','treinos') GROUP BY schemaname ORDER BY 1;"
$env:PGPASSWORD = $null

Write-Host ''
Write-Step 'Próximo passo'
Write-Host '  .\50-github-oidc.ps1   (cria app registration nova + federated credential + secrets)'
