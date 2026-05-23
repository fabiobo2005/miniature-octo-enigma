# 99 — Derruba o ambiente ANTIGO. RODE APENAS APÓS VALIDAR O NOVO.
. "$PSScriptRoot\_lib.ps1"

$s = Get-State
if (-not $s.oldSub) { throw 'Estado vazio. Use az/gh diretamente.' }

Write-Warn2 'Este script vai DELETAR recursos da subscription antiga.'
Write-Host "  Sub antiga:    $($s.oldSub)"
Write-Host "  Tenant antigo: $($s.oldTenant)"
$confirm = Read-Host 'Digite "DELETE" para confirmar'
if ($confirm -ne 'DELETE') { Write-Host 'Abortado.'; exit 0 }

Write-Step 'Trocando contexto Azure para o tenant antigo'
az login --tenant $s.oldTenant | Out-Null
az account set --subscription $s.oldSub

$oldRg = 'rg-apex-dev'
Write-Step "Deletando RG $oldRg (async)"
az group delete --name $oldRg --yes --no-wait
Write-Ok 'Delete iniciado (acompanhe em https://portal.azure.com)'

Write-Step 'Lembretes manuais finais'
Write-Host '  - Remover app registration "apex-github-oidc" antigo no tenant antigo:'
Write-Host '      az ad app delete --id <appId-antigo>   (no contexto antigo)'
Write-Host '  - Apagar pastas .azure/*.bak-* se não precisar mais do estado azd antigo'
Write-Host '  - Voltar para o novo tenant:  az login --tenant ' $s.newTenant
