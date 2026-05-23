# 20 — Bootstrap do novo ambiente: cria azd env limpo na NOVA conta e roda `azd up`.
# Pré-requisito: 'az login --tenant <novo-tenant>' já feito.
. "$PSScriptRoot\_lib.ps1"

Push-Location $Script:RepoRoot
try {
    Write-Step 'Conta Azure atual'
    $acct = az account show --query '{sub:id,tenant:tenantId,user:user.name}' -o json | ConvertFrom-Json
    if (-not $acct) { throw 'Rode "az login --tenant <novo-tenant>" primeiro.' }
    Write-Host "  Sub:    $($acct.sub)"
    Write-Host "  Tenant: $($acct.tenant)"
    Write-Host "  User:   $($acct.user)"
    $ok = Read-Default 'Esta é a NOVA conta? (s/n)' 's'
    if ($ok -ne 's') { exit 1 }

    Write-Step 'Coletando identidade Entra do usuário atual'
    $me = az ad signed-in-user show --query '{id:id,upn:userPrincipalName,mail:mail}' -o json | ConvertFrom-Json
    $deployerObjectId = $me.id
    $deployerUpn = if ($me.upn) { $me.upn } else { $me.mail }
    Write-Host "  ObjectId: $deployerObjectId"
    Write-Host "  UPN:      $deployerUpn"

    $envName  = Read-Default 'Nome do azd env' 'apex-dev'
    $location = Read-Default 'Região Azure (centralus / brazilsouth)' 'centralus'

    $existingState = Get-State
    $defaultSecret = if ($existingState.adminSecret) { $existingState.adminSecret } else { -join ((48..57 + 97..102) | Get-Random -Count 32 | ForEach-Object { [char]$_ }) }
    $adminSecret = Read-Default 'ADMIN_SECRET (enter pra gerar/reusar)' $defaultSecret

    # Limpa estado azd antigo (mas mantém um backup do .env antigo)
    $azdDir = Join-Path $Script:RepoRoot ".azure\$envName"
    if (Test-Path $azdDir) {
        $backup = "$azdDir.bak-$(Get-Date -Format yyyyMMddHHmmss)"
        Write-Step "Renomeando $azdDir -> $backup"
        Rename-Item $azdDir $backup
    }

    Write-Step "azd env new $envName"
    azd env new $envName --location $location --subscription $acct.sub
    if ($LASTEXITCODE -ne 0) { throw 'azd env new falhou' }

    Write-Step 'Setando variáveis do env azd'
    azd env set AZURE_LOCATION             $location
    azd env set AZURE_SUBSCRIPTION_ID      $acct.sub
    azd env set AZURE_TENANT_ID            $acct.tenant
    azd env set POSTGRES_ADMIN_OBJECT_ID   $deployerObjectId
    azd env set POSTGRES_ADMIN_LOGIN       $deployerUpn
    azd env set POSTGRES_ADMIN_TYPE        'User'
    azd env set DEPLOYER_OBJECT_ID         $deployerObjectId
    azd env set DEPLOYER_PRINCIPAL_TYPE    'User'
    azd env set ADMIN_SECRET               $adminSecret

    Write-Step 'Rodando azd up (provision + deploy). Demora 8-15 min.'
    azd up --no-prompt
    if ($LASTEXITCODE -ne 0) { throw 'azd up falhou — veja o log acima' }

    # Captura outputs
    Write-Step 'Capturando outputs do novo ambiente'
    $values = azd env get-values --output json | ConvertFrom-Json
    Set-State @{
        newEnvName  = $envName
        newSub      = $acct.sub
        newTenant   = $acct.tenant
        newLocation = $location
        newRg       = $values.AZURE_RESOURCE_GROUP
        newPgFqdn   = $values.AZURE_POSTGRES_FQDN
        newPgDb     = $values.AZURE_POSTGRES_DATABASE
        newAcaApi   = $values.AZURE_CONTAINER_APP_API_NAME
        newAcaWeb   = $values.AZURE_CONTAINER_APP_WEB_NAME
        newAcrName  = $values.AZURE_CONTAINER_REGISTRY_NAME
        newWebUrl   = $values.WEB_URL
        deployerObjectId = $deployerObjectId
        deployerUpn      = $deployerUpn
        adminSecret      = $adminSecret
    }
    Write-Ok "Novo PG: $($values.AZURE_POSTGRES_FQDN)"
    Write-Ok "Novo Web: $($values.WEB_URL)"
}
finally { Pop-Location }

Write-Host ''
Write-Step 'Próximo passo'
Write-Host '  .\30-post-deploy.ps1   (promove você como Entra admin do novo PG)'
