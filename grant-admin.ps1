param([Parameter(Mandatory=$true)][string]$Username)
$ErrorActionPreference = 'Stop'
Push-Location "$PSScriptRoot/backend"
try {
    if (Test-Path './target/debug/scaraim.exe') {
        & './target/debug/scaraim.exe' --set-admin $Username
    } else {
        . "$PSScriptRoot/scripts/rust-env.ps1"
        & cargo run --locked -- --set-admin $Username
    }
    if ($LASTEXITCODE -ne 0) { throw 'Administrator initialization failed. Register the username first.' }
} finally { Pop-Location }
