param(
    [ValidateSet('dev', 'build', 'check')][string]$Command = 'dev',
    [switch]$Debug,
    [switch]$NoBundle
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$cargoBin = Join-Path $env:USERPROFILE '.cargo\bin'
if (Test-Path -LiteralPath $cargoBin) { $env:PATH = "$cargoBin;$env:PATH" }

# Cargo discovers standard Visual Studio installations automatically.
# An optional portable compiler lives outside the source repository.
$portableHome = if ($env:TELEMBRO_MSVC_DIR) { $env:TELEMBRO_MSVC_DIR } else { Join-Path $env:LOCALAPPDATA 'TelembroBuildTools\msvc' }
$portableRoot = Join-Path $portableHome 'VC\Tools\MSVC'
if (Test-Path -LiteralPath $portableRoot) {
    $toolchain = Get-ChildItem -LiteralPath $portableRoot -Directory | Sort-Object Name -Descending | Select-Object -First 1
    $sdkRoot = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10'
    $sdk = Get-ChildItem -LiteralPath (Join-Path $sdkRoot 'Lib') -Directory | Sort-Object Name -Descending | Select-Object -First 1
    $compilerBin = Join-Path $toolchain.FullName 'bin\Hostx64\x64'
    $env:PATH = "$compilerBin;$(Join-Path $sdkRoot "bin\$($sdk.Name)\x64");$env:PATH"
    $env:LIB = "$(Join-Path $toolchain.FullName 'lib\x64');$(Join-Path $sdk.FullName 'ucrt\x64');$(Join-Path $sdk.FullName 'um\x64')"
    $env:INCLUDE = "$(Join-Path $toolchain.FullName 'include');$(Join-Path $sdkRoot "Include\$($sdk.Name)\ucrt");$(Join-Path $sdkRoot "Include\$($sdk.Name)\shared");$(Join-Path $sdkRoot "Include\$($sdk.Name)\um")"
    $env:CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER = Join-Path $compilerBin 'link.exe'
    $env:CC = Join-Path $compilerBin 'cl.exe'
    $env:VCToolsInstallDir = $toolchain.FullName + '\'
    $env:WindowsSdkDir = $sdkRoot + '\'
    $env:WindowsSDKVersion = $sdk.Name + '\'
}
if ($Command -eq 'check') {
    & cargo $Command --manifest-path src-tauri/Cargo.toml
} else {
    $options = @($Command)
    if ($Debug) { $options += '--debug' }
    if ($NoBundle) { $options += '--no-bundle' }
    & npx.cmd tauri @options
}
$nativeExitCode = $LASTEXITCODE
if ($nativeExitCode -eq 0 -and $Command -eq 'build' -and -not $Debug) {
    $releaseDir = Join-Path $projectRoot 'release'
    New-Item -ItemType Directory -Path $releaseDir -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $projectRoot 'src-tauri\target\release\telembro.exe') -Destination (Join-Path $releaseDir 'Telembro.exe')
    if (-not $NoBundle) {
        $installer = Get-ChildItem -LiteralPath (Join-Path $projectRoot 'src-tauri\target\release\bundle\nsis') -Filter '*.exe' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($installer) { Copy-Item -LiteralPath $installer.FullName -Destination (Join-Path $releaseDir 'Telembro-Setup.exe') }
    }
}
exit $nativeExitCode
