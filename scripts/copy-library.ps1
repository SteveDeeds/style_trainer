param(
  [string]$StylesPath = 'C:\Users\steve\JJazzLab\Rhythms',
  [string]$SoundFontPath = 'C:\Users\steve\Documents\GitHub\Virtual_Musician\soundfonts\JJazzLab-SoundFont.sf2'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$source = (Resolve-Path $StylesPath).Path.TrimEnd('\')
$destination = Join-Path $root 'public\styles'
New-Item -ItemType Directory -Force $destination | Out-Null
$styles = @(Get-ChildItem $source -Recurse -File -Filter '*.sty' | Sort-Object FullName | ForEach-Object {
  $relative = $_.FullName.Substring($source.Length + 1)
  $target = Join-Path $destination $relative
  New-Item -ItemType Directory -Force (Split-Path $target -Parent) | Out-Null
  Copy-Item -LiteralPath $_.FullName -Destination $target
  $segments = $relative.Split('\')
  @{
    name = $_.BaseName
    category = if ($segments.Length -gt 1) { $segments[0] } else { 'Styles' }
    # Vite's public-file lookup decodes spaces but leaves encoded ampersands intact.
    url = '/styles/' + (($segments | ForEach-Object { [Uri]::EscapeDataString($_).Replace('%26', '&') }) -join '/')
  }
})
if (!$styles.Count) { throw 'No .sty files found in the source folder.' }
$fontDirectory = Join-Path $root 'public\soundfonts'
New-Item -ItemType Directory -Force $fontDirectory | Out-Null
$fontTarget = Join-Path $fontDirectory 'default.sf2'
if (!(Test-Path $fontTarget) -or (Get-FileHash $SoundFontPath).Hash -ne (Get-FileHash $fontTarget).Hash) {
  Copy-Item -LiteralPath $SoundFontPath -Destination $fontTarget
}
$manifest = @{
  styles = $styles
  soundfonts = @(@{ name = 'JJazzLab SoundFont'; url = '/soundfonts/default.sf2' })
}
$json = $manifest | ConvertTo-Json -Depth 5
[IO.File]::WriteAllText((Join-Path $root 'public\library.json'), $json, [Text.UTF8Encoding]::new($false))
Write-Output "Copied $($styles.Count) styles; local SoundFont and library manifest ready."
