# FluidSynth public-runtime corresponding source and build

The public `synth/fluid.js` is our rebuilt FluidSynth 2.4.6, not the opaque
prebuilt npm binary. The js-synthesizer 1.11.0 worklet remains unmodified.
The build explicitly disables libinstpatch and libsndfile, removing the
previous uncertainty about those dependencies in the npm runtime.

## Locally hosted source and provenance

- Base project: [fluidsynth-emscripten v2.4.6-em-2](https://github.com/jet2jet/fluidsynth-emscripten/tree/v2.4.6-em-2),
  commit `99bf7094cf517095b7a944ccf5f74072436bfa3f`.
- Original source archive: `licenses/source/fluidsynth-emscripten-v2.4.6-em-2.zip`,
  SHA-256 `63A090960B027FCF492314393D73C53073C1BB46A1E8FD7A01BCC9329DFDE510`.
- **Exact derivative source used for this build**, including the modified
  CMake file and our PowerShell build script:
  `licenses/source/fluidsynth-emscripten-public-2.4.6.zip` (1,983,517 bytes),
  SHA-256 `C0FDC9842CD2B296C876C1551482454C6485D7E292CFD65D4E20747A04A9DDDC`.
- Resulting `synth/fluid.js`: 582,989 bytes,
  SHA-256 `8EDC335DA1728DBE6B8BB9978852300C35DDDD8EFDA2003AA85141533E4BB5EF`.
- Wrapper source: `licenses/source/js-synthesizer-v1.11.0.zip`,
  SHA-256 `875ABF3285EB8295CDA2570F50164F17DE5FA86D6BE5BED7DFE9216EBE92CD6B`.

The source archives preserve upstream GNU copyright/license headers, the
LGPL license, FluidSynth C/C++ source and headers, Emscripten glue, export list,
table generator, and CMake build files. The sole Git submodule is
`test/manual`, upstream test fixtures, not library build source; it is not
needed for the library build and is not populated in the ZIP.

## Build tools and exact feature selection

Built on Windows using Emscripten **3.1.10** (SDK release
`8bd05c7221b4ce34d4bedec40b672d94e681a765`), CMake **4.4.3**, Ninja **1.12.1**,
and MSVC **19.44.35229** only for the host `make_tables.exe` table generator.
The target C/C++ code is compiled by the Emscripten SDK Clang.
SDK installation is isolated under `.tools/`; no compiler/system installation
is needed when those tools are already available.

The corresponding repository script is `scripts/rebuild-fluid.ps1`. It takes
`-SdkPath`, `-SourcePath`, `-NinjaPath`, and `-VcVarsPath` parameters. Extract the
original or derivative archive and install/activate Emscripten 3.1.10, then run
the script from the repository; it configures Ninja, builds `libfluidsynth`,
and copies the embedded-JS output to `public-release/synth/fluid.js`.

The script contains the complete flags. Feature-affecting selections are:

```text
CMAKE_BUILD_TYPE=Release
osal=embedded
enable-oss=off
enable-libsndfile=off
enable-libinstpatch=off
enable-dbus=off
enable-jack=off
enable-ladspa=off
enable-alsa=off
enable-aufile=off
enable-network=off
enable-readline=off
enable-threads=off
enable-openmp=off
enable-sdl2=off
enable-sdl3=off
enable-pulseaudio=off
enable-pipewire=off
enable-portaudio=off
enable-midishare=off
enable-systemd=off
```

The completed CMake feature report confirmed SF3/libsndfile **no**,
DLS/libinstpatch **no**, OS abstraction **embedded**, LADSPA **no**, all device
drivers **no**, and threaded/OpenMP rendering **no**. Thus no external GLib,
libinstpatch, libsndfile or codec libraries are linked. Only the normal
compiler runtime, C/C++ standard libraries and math/system support accompany
the FluidSynth source. The compiler/SDK themselves are normal build tools,
not additional project source. The Emscripten runtime notice is supplied at
`licenses/LICENSE-Emscripten.txt`.

## Changes made on 2026-10-11

No synthesis C/C++ or JavaScript worklet source was changed. For Windows
command-line compatibility, the CMake link command writes the unchanged
exported-function list to a JSON response file and uses Emscripten's
`EXPORTED_FUNCTIONS=@file` option. Runtime export names use a comma-separated
setting instead of shell-specific single quotes. The unsupported
`MIN_NODE_VERSION=120000` setting is omitted for Emscripten 3.1.10. Ninja is
configured to use response files for object arguments. These changes are in
the derivative archive, and the build script can apply them to the original.
The single-file WebAssembly configuration and AudioWorklet `wasmModule`
interface are preserved.
The script was also tested against a fresh extraction of the original
archive; it successfully generated the same feature configuration. Builds
under different source-directory paths can differ in bytes because embedded
source-path strings differ; the checksum above identifies the committed
artifact, not a promise of path-independent bit-for-bit reproducibility.

The public build and postinstall scripts preserve the committed rebuilt
runtime rather than overwrite it with npm's external binary. Private local
`public/synth/fluid.js` continues to use the original npm runtime.

## Replacement and LGPL rights

The LGPL library is a separate script, not merged into the application
bundle. Users can rebuild the supplied source (including modifications),
replace `synth/fluid.js` in their local copy, and use the unmodified worklet.
Keep the source archives, this build information, and
`synth/LICENSE.fluidsynth.txt` accessible alongside distributed binaries.
The application MIT license does not restrict modification or reverse
engineering for debugging changes to this LGPL library.
