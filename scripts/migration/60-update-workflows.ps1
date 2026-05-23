# 60 — Atualiza referências hardcoded (PG name, URL pública) nos workflows e docs.
. "$PSScriptRoot\_lib.ps1"

$s = Get-State
if (-not $s.newPgFqdn) { throw 'Rode 20-bootstrap-new.ps1 antes.' }

# Tokens antigos (valores do ambiente quebrado — buscados via grep).
$oldPgToken  = 'psql-apex-ydcoajutfl3he'
$oldWebHost  = 'ca-apex-web.jollyglacier-b0e801ab.centralus.azurecontainerapps.io'
$oldRg       = 'rg-apex-dev'

$newPgToken  = ($s.newPgFqdn -split '\.')[0]
$newWebHost  = ($s.newWebUrl -replace '^https?://','').TrimEnd('/')
$newRg       = $s.newRg

Write-Step "PG:  $oldPgToken -> $newPgToken"
Write-Step "Web: $oldWebHost -> $newWebHost"
Write-Step "RG:  $oldRg -> $newRg"

$targets = @(
    '.github\workflows\cost-schedule-start.yml',
    '.github\workflows\cost-schedule-stop.yml',
    'README.md',
    'docs\cost-schedule.md',
    'CHANGELOG.md',
    'src\api\scripts\smoke.ts'
) | ForEach-Object { Join-Path $Script:RepoRoot $_ } | Where-Object { Test-Path $_ }

foreach ($f in $targets) {
    $content = Get-Content $f -Raw
    $orig = $content
    $content = $content.Replace($oldPgToken, $newPgToken)
    $content = $content.Replace($oldWebHost, $newWebHost)
    if ($oldRg -ne $newRg) { $content = $content.Replace($oldRg, $newRg) }
    if ($content -ne $orig) {
        Set-Content -Path $f -Value $content -Encoding UTF8 -NoNewline
        Write-Ok "Atualizado: $f"
    } else {
        Write-Host "(sem mudanças) $f"
    }
}

Write-Step 'Diff vs git (revisar manualmente antes de commitar):'
Push-Location $Script:RepoRoot
git --no-pager diff --stat
Pop-Location

Write-Host ''
Write-Step 'Próximo passo'
Write-Host '  Revise o diff, commit/push, e teste:'
Write-Host '    gh workflow run "Cost · Stop (20:00 BRT, Mon-Fri)"'
Write-Host '    gh workflow run "Cost · Start (08:00 BRT, Mon-Fri)"'
Write-Host '  Quando validar tudo OK no novo, rode .\99-cleanup-old.ps1'


Write-Step 'Diff vs git (revisar manualmente antes de commitar):'
Push-Location $Script:RepoRoot
git --no-pager diff --stat
Pop-Location

Write-Host ''
Write-Step 'Próximo passo'
Write-Host '  Revise o diff, commit/push, e teste:'
Write-Host '    gh workflow run "Cost · Stop (20:00 BRT, Mon-Fri)"'
Write-Host '    gh workflow run "Cost · Start (08:00 BRT, Mon-Fri)"'
Write-Host '  Quando validar tudo OK no novo, rode .\99-cleanup-old.ps1'
