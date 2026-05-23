# 30 — Pós-deploy: promove o usuário como Entra admin do PG novo (não feito no Bicep).
. "$PSScriptRoot\_lib.ps1"

$s = Get-State
if (-not $s.newRg) { throw 'Estado de migração não tem newRg. Rode 20-bootstrap-new.ps1 antes.' }

$pgName = ($s.newPgFqdn -split '\.')[0]
Write-Step "Promovendo $($s.deployerUpn) como Entra admin de $pgName"
az postgres flexible-server microsoft-entra-admin create `
    --resource-group $s.newRg `
    --server-name $pgName `
    --object-id $s.deployerObjectId `
    --display-name $s.deployerUpn `
    --type User
if ($LASTEXITCODE -ne 0) { throw 'Falha ao criar Entra admin' }
Write-Ok 'Entra admin criado'

# Reinicia API pra ela aplicar o db/init.sql (que cria role da managed identity)
Write-Step "Reiniciando ACA API ($($s.newAcaApi)) para aplicar schema/init.sql"
az containerapp revision restart `
    --resource-group $s.newRg `
    --name $s.newAcaApi `
    --revision (az containerapp revision list -g $s.newRg -n $s.newAcaApi --query '[0].name' -o tsv) 2>$null
Write-Ok 'API reiniciada (ver logs com: az containerapp logs show -g $rg -n ca-apex-api --follow)'

# IMPORTANTE: a managed identity da API precisa ser criada como role AAD no PG
# (o Bicep não faz isso). Sem este passo, a API loga "password authentication failed".
Write-Step 'Criando role AAD para a managed identity da API'
$pgName  = ($s.newPgFqdn -split '\.')[0]
$uaiName = "id-apex-$($pgName -replace '^psql-apex-','')"
$myIp = (Invoke-RestMethod -Uri 'https://api.ipify.org')
$fwRule = "uai-grant-$(Get-Date -Format yyyyMMdd)"
az postgres flexible-server firewall-rule create `
    --resource-group $s.newRg --name $pgName `
    --rule-name $fwRule `
    --start-ip-address $myIp --end-ip-address $myIp | Out-Null

$env:PGSSLMODE='require'
$env:PGPASSWORD = (az account get-access-token --resource-type oss-rdbms --query accessToken -o tsv)
& psql "host=$($s.newPgFqdn) port=5432 dbname=postgres user=$($s.deployerUpn) sslmode=require" `
    -c "SELECT pgaadauth_create_principal('$uaiName'::text, false, false);" 2>&1 | Out-Host
& psql "host=$($s.newPgFqdn) port=5432 dbname=$($s.newPgDb) user=$($s.deployerUpn) sslmode=require" `
    -c "GRANT CONNECT ON DATABASE $($s.newPgDb) TO `"$uaiName`"; GRANT CREATE ON DATABASE $($s.newPgDb) TO `"$uaiName`"; GRANT CREATE ON SCHEMA public TO `"$uaiName`";" 2>&1 | Out-Host
$env:PGPASSWORD=$null

az postgres flexible-server firewall-rule delete `
    --resource-group $s.newRg --name $pgName --rule-name $fwRule --yes 2>$null | Out-Null
Write-Ok "Role AAD criada: $uaiName"

# Reinicia novamente para a API conectar com a role recém-criada
az containerapp revision restart `
    --resource-group $s.newRg --name $s.newAcaApi `
    --revision (az containerapp revision list -g $s.newRg -n $s.newAcaApi --query '[0].name' -o tsv) 2>$null
Write-Ok 'API reiniciada (deve aplicar schema agora)'

Write-Host ''
Write-Step 'Próximo passo'
Write-Host '  .\40-restore.ps1   (restaura o dump no novo PG)'
