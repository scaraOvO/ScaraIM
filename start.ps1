param([switch]$Tui)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/scripts/rust-env.ps1"
Push-Location "$PSScriptRoot/frontend"
try {
    if (-not (Test-Path node_modules)) { & npm.cmd ci; if ($LASTEXITCODE -ne 0) { throw 'Frontend dependency installation failed' } }
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed' }
} finally { Pop-Location }
Push-Location "$PSScriptRoot/backend"
try { if ($Tui) { & cargo run --locked -- --tui } else { & cargo run --locked }; if ($LASTEXITCODE -ne 0) { throw 'Backend failed to start' } } finally { Pop-Location }
