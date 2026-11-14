$ErrorActionPreference = 'Stop'

& (Join-Path $PSScriptRoot 'scripts\run.ps1') dev
exit $LASTEXITCODE
