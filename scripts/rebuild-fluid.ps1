param(
  [string]$SdkPath = '.tools\rebuild\emsdk-main',
  [string]$SourcePath = '.tools\rebuild\fluidsynth-emscripten-2.4.6-em-2',
  [string]$NinjaPath = '.tools\ninja\ninja.exe',
  [string]$VcVarsPath = 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
$sdk = (Resolve-Path $SdkPath).Path
$source = (Resolve-Path $SourcePath).Path
$ninja = (Resolve-Path $NinjaPath).Path
$build = Join-Path $source 'build-public'
$cmakePath = Join-Path $source 'CMakeLists.txt'
$cmakeSource = [IO.File]::ReadAllText($cmakePath)
$originalExports = '-s EXPORTED_FUNCTIONS=''[${EMSCRIPTEN_EXPORTS_OPTIONS}]'''
$replacementExports = '-s EXPORTED_FUNCTIONS=@${CMAKE_BINARY_DIR}/emscripten-exports.json'
if ($cmakeSource.Contains($originalExports)) {
  $cmakeSource = $cmakeSource.Replace(
    '    SET( CMAKE_EXE_LINKER_FLAGS "${CMAKE_EXE_LINKER_FLAGS} --post-js',
    '    FILE( WRITE "${CMAKE_BINARY_DIR}/emscripten-exports.json" "[${EMSCRIPTEN_EXPORTS_OPTIONS}]" )' + "`n" + '    SET( CMAKE_EXE_LINKER_FLAGS "${CMAKE_EXE_LINKER_FLAGS} --post-js'
  )
  $cmakeSource = $cmakeSource.Replace($originalExports, $replacementExports)
  $cmakeSource = $cmakeSource.Replace(' -s MIN_NODE_VERSION=120000', '')
  $cmakeSource = $cmakeSource.Replace(
    '-s ''EXPORTED_RUNTIME_METHODS=[\"ccall\", \"cwrap\", \"FS\",\"addFunction\",\"removeFunction\",\"addOnPreRun\",\"addOnInit\",\"addOnPostRun\",\"MEMFS\",\"lengthBytesUTF8\",\"UTF8ArrayToString\",\"UTF8ToString\",\"stringToUTF8Array\",\"stringToUTF8\"]''',
    '-s EXPORTED_RUNTIME_METHODS=ccall,cwrap,FS,addFunction,removeFunction,addOnPreRun,addOnInit,addOnPostRun,MEMFS,lengthBytesUTF8,UTF8ArrayToString,UTF8ToString,stringToUTF8Array,stringToUTF8'
  )
  [IO.File]::WriteAllText($cmakePath, $cmakeSource, [Text.UTF8Encoding]::new($false))
}
$configure = 'emcmake cmake -S "' + $source + '" -B "' + $build + '" -G Ninja -DCMAKE_MAKE_PROGRAM="' + $ninja + '" -DCMAKE_NINJA_FORCE_RESPONSE_FILE=ON -DCMAKE_BUILD_TYPE=Release -DCMAKE_POLICY_VERSION_MINIMUM=3.5 -Denable-oss=off -Denable-libsndfile=off -Denable-libinstpatch=off -Dosal=embedded -Denable-dbus=off -Denable-jack=off -Denable-ladspa=off -Denable-alsa=off -Denable-aufile=off -Denable-network=off -Denable-readline=off -Denable-threads=off -Denable-openmp=off -Denable-sdl2=off -Denable-sdl3=off -Denable-pulseaudio=off -Denable-pipewire=off -Denable-portaudio=off -Denable-midishare=off -Denable-systemd=off'
$env:PATH = (Split-Path $ninja -Parent) + ';' + $env:PATH
$command = 'call "' + $VcVarsPath + '" >nul && call "' + (Join-Path $sdk 'emsdk_env.bat') + '" >nul && set "CC_FOR_BUILD=cl" && ' + $configure + ' && cmake --build "' + $build + '" --target libfluidsynth --parallel 4'
$savedPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
& $env:ComSpec /c $command
$ErrorActionPreference = $savedPreference
if ($LASTEXITCODE -ne 0) { throw "FluidSynth rebuild failed ($LASTEXITCODE)." }
$output = Join-Path $root 'public-release\synth\fluid.js'
Copy-Item -LiteralPath (Join-Path $build 'src\libfluidsynth-2.4.6.js') -Destination $output -Force
Get-FileHash $output -Algorithm SHA256
