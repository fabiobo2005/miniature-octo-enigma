# Funções compartilhadas. Importe com: . "$PSScriptRoot\_lib.ps1"
$ErrorActionPreference = 'Stop'

$Script:RepoRoot = (Resolve-Path "$PSScriptRoot\..\..").Path
$Script:StateFile = Join-Path $PSScriptRoot '.migration-state.json'

# Garante que o PATH desta sessão inclui o bin do Postgres (psql/pg_dump).
$pgBins = @(
    'C:\Program Files\PostgreSQL\18\bin',
    'C:\Program Files\PostgreSQL\17\bin',
    'C:\Program Files\PostgreSQL\16\bin',
    'C:\Program Files\PostgreSQL\15\bin'
)
foreach ($b in $pgBins) {
    if ((Test-Path $b) -and ($env:PATH -notlike "*$b*")) {
        $env:PATH = "$b;$env:PATH"
    }
}

function Get-State {
    if (Test-Path $Script:StateFile) {
        return Get-Content $Script:StateFile -Raw | ConvertFrom-Json
    }
    return [pscustomobject]@{}
}

function Set-State {
    param([Parameter(Mandatory)][hashtable]$Patch)
    $current = Get-State
    $merged = @{}
    foreach ($p in $current.PSObject.Properties) { $merged[$p.Name] = $p.Value }
    foreach ($k in $Patch.Keys) { $merged[$k] = $Patch[$k] }
    $merged | ConvertTo-Json -Depth 5 | Set-Content -Path $Script:StateFile -Encoding UTF8
}

function Write-Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "OK  $msg" -ForegroundColor Green }
function Write-Warn2($msg){ Write-Host "!!  $msg" -ForegroundColor Yellow }

function Require-Cmd($name) {
    if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
        throw "Comando obrigatório não encontrado: $name"
    }
}

function Read-Default($prompt, $default) {
    if ($default) { $v = Read-Host "$prompt [$default]" } else { $v = Read-Host $prompt }
    if ([string]::IsNullOrWhiteSpace($v)) { return $default } else { return $v }
}
