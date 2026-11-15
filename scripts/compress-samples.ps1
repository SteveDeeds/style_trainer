param([string]$Ffmpeg = 'ffmpeg')

$ErrorActionPreference = 'Stop'
$encoder = (Get-Command $Ffmpeg -ErrorAction Stop).Source
$root = Split-Path $PSScriptRoot -Parent
$source = Join-Path $root 'audio-source\band-leader-cleaned'
$output = Join-Path $root 'public\samples'
$files = @(Get-ChildItem -LiteralPath $source -Filter '*.wav' -File)
if ($files.Count -eq 0) { throw "No cleaned WAV samples found in $source." }
New-Item -ItemType Directory -Path $output -Force | Out-Null

foreach ($file in $files) {
    $destination = Join-Path $output ($file.BaseName + '.mp3')
    & $encoder -hide_banner -loglevel error -nostdin -y -i $file.FullName `
        -map_metadata -1 -ac 1 -ar 44100 -c:a libmp3lame -b:a 64k `
        -write_xing 1 -id3v2_version 0 -write_id3v1 0 $destination
    if ($LASTEXITCODE -ne 0) { throw "MP3 conversion failed for $($file.Name)." }
}
Write-Host "Converted $($files.Count) samples to mono 64 kbps MP3 in $output."
