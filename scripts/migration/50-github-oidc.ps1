# 50 — Cria app registration nova para OIDC do GitHub Actions e seta secrets no repo.
. "$PSScriptRoot\_lib.ps1"

$s = Get-State
if (-not $s.newSub) { throw 'Rode 20-bootstrap-new.ps1 antes.' }

Require-Cmd gh
$repo = & gh repo view --json nameWithOwner -q .nameWithOwner
if (-not $repo) { throw 'Não foi possível detectar repo (rode dentro do clone e com gh autenticado).' }
Write-Step "Repo GitHub: $repo"

$appName = Read-Default 'Nome do app registration' 'apex-github-oidc'

Write-Step "Criando/atualizando app registration: $appName"
$appId = az ad app list --display-name $appName --query '[0].appId' -o tsv
if (-not $appId) {
    $appId = az ad app create --display-name $appName --query appId -o tsv
    Write-Ok "App criado: $appId"
} else {
    Write-Ok "App já existe: $appId"
}

$spId = az ad sp list --filter "appId eq '$appId'" --query '[0].id' -o tsv
if (-not $spId) {
    $spId = az ad sp create --id $appId --query id -o tsv
    Write-Ok "Service principal criado: $spId"
} else { Write-Ok "Service principal: $spId" }

Write-Step "Atribuindo Contributor em rg $($s.newRg)"
az role assignment create `
    --assignee $appId `
    --role Contributor `
    --scope "/subscriptions/$($s.newSub)/resourceGroups/$($s.newRg)" 2>$null | Out-Null
Write-Ok 'Role assignment OK'

Write-Step 'Criando federated credential (branch main)'
$fcName = 'github-main'
$existingFc = az ad app federated-credential list --id $appId --query "[?name=='$fcName'].name" -o tsv
if ($existingFc) { Write-Warn2 "Federated credential '$fcName' já existe — pulando" }
else {
    $fcJson = @{
        name      = $fcName
        issuer    = 'https://token.actions.githubusercontent.com'
        subject   = "repo:$($repo):ref:refs/heads/main"
        audiences = @('api://AzureADTokenExchange')
    } | ConvertTo-Json -Compress
    $tmp = New-TemporaryFile
    $fcJson | Set-Content -Path $tmp -Encoding UTF8
    az ad app federated-credential create --id $appId --parameters "@$tmp" | Out-Null
    Remove-Item $tmp
    Write-Ok "Federated credential criada para repo:$repo:ref:refs/heads/main"
}

Write-Step 'Setando GitHub secrets'
gh secret set AZURE_CLIENT_ID       --body $appId
gh secret set AZURE_TENANT_ID       --body $s.newTenant
gh secret set AZURE_SUBSCRIPTION_ID --body $s.newSub
Write-Ok 'Secrets AZURE_CLIENT_ID, AZURE_TENANT_ID, AZURE_SUBSCRIPTION_ID setados'

Set-State @{ githubAppId = $appId; githubRepo = $repo }

Write-Host ''
Write-Step 'Próximo passo'
Write-Host '  .\60-update-workflows.ps1   (atualiza nome do PG hardcoded nos workflows)'
