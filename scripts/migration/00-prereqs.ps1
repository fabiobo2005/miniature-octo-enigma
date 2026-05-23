# 00 — Verifica ferramentas necessárias e conectividade
. "$PSScriptRoot\_lib.ps1"

Write-Step 'Checando ferramentas instaladas'
Require-Cmd az
Require-Cmd azd
Require-Cmd gh
Require-Cmd psql
Require-Cmd pg_dump
Write-Ok 'CLIs obrigatórias presentes (az, azd, gh, psql, pg_dump)'

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Warn2 'docker não encontrado — OK porque azure.yaml usa remoteBuild=true (ACR builda na nuvem).'
}

Write-Step 'Versões'
az version --output table 2>$null | Out-Host
azd version | Out-Host
gh --version | Select-Object -First 1 | Out-Host
psql --version | Out-Host


Write-Step 'Próximo passo'
Write-Host '  .\10-dump-old.ps1   (dump do Postgres antigo enquanto a conta antiga ainda funciona)'
