$ErrorActionPreference = 'Stop'
$cargoBin = Join-Path $env:USERPROFILE '.cargo/bin'
if (Test-Path $cargoBin) { $env:Path = "$cargoBin;$env:Path" }
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
if (Test-Path $vswhere) {
    $vs = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    if ($vs) {
        $dev = Join-Path $vs 'Common7/Tools/VsDevCmd.bat'
        & $env:ComSpec /d /s /c "`"$dev`" -no_logo -arch=x64 >nul && set" | ForEach-Object {
            if ($_ -match '^([^=]+)=(.*)$') { [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process') }
        }
    }
}
if (-not (Get-Command link.exe -ErrorAction SilentlyContinue)) {
    # Some portable Build Tools installs have binaries but no component registration.
    if (-not (Test-Path $vswhere)) { throw 'Install Visual Studio C++ Build Tools and Windows SDK first.' }
    $vs = & $vswhere -latest -products '*' -property installationPath
    if (-not $vs) { throw 'Visual Studio C++ Build Tools installation not found.' }
    $msvc = Get-ChildItem (Join-Path $vs 'VC/Tools/MSVC') -Directory | Where-Object { Test-Path (Join-Path $_.FullName 'bin/HostX64/x64/link.exe') } | Sort-Object Name -Descending | Select-Object -First 1
    $kits = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits/10'
    $sdk = Get-ChildItem "$kits/Lib" -Directory | Sort-Object Name -Descending | Select-Object -First 1
    if ($msvc -and $sdk) {
        $env:Path = "$($msvc.FullName)/bin/HostX64/x64;$kits/bin/$($sdk.Name)/x64;$env:Path"
        $env:LIB = "$($msvc.FullName)/lib/x64;$kits/Lib/$($sdk.Name)/ucrt/x64;$kits/Lib/$($sdk.Name)/um/x64"
        $env:INCLUDE = "$($msvc.FullName)/include;$kits/Include/$($sdk.Name)/ucrt;$kits/Include/$($sdk.Name)/um;$kits/Include/$($sdk.Name)/shared"
    }
}
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) { throw 'Please install Rust from https://rust-lang.org/tools/install/' }
if (-not (Get-Command link.exe -ErrorAction SilentlyContinue)) { throw 'Please install Visual Studio C++ Build Tools with MSVC and Windows SDK.' }

