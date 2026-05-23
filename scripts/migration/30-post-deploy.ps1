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

Write-Host ''
Write-Step 'Próximo passo'
Write-Host '  .\40-restore.ps1   (restaura o dump no novo PG)'
