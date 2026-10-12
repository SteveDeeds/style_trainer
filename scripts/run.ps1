param(
    [ValidateSet('dev', 'build', 'publish', 'preview', 'test', 'install')]
    [string]$Action = 'dev'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$localNode = Join-Path $root '.tools\node'
if (Test-Path (Join-Path $localNode 'node.exe')) {
    $env:Path = "$localNode;$env:Path"
}
$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npm) {
    throw 'Node.js is not installed. Install a supported Node.js 22 release, then retry.'
}

Push-Location $root
try {
    if ($Action -eq 'install') {
        & $npm.Source install
    } elseif ($Action -eq 'publish') {
        & $npm.Source run build:public
    } else {
        & $npm.Source run $Action
    }
    $result = $LASTEXITCODE
} finally {
    Pop-Location
}
exit $result
