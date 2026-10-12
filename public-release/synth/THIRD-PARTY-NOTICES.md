# Third-party notices

The original Style Trainer application code is copyright SteveDeeds and
licensed under the MIT License; see `LICENSE`.

## GeneralUser GS

GeneralUser GS version 2.0.3 is supplied as a local starter SoundFont at
`soundfonts/generaluser-gs.sf2`. It is from
[mrbumpy409/GeneralUser-GS](https://github.com/mrbumpy409/GeneralUser-GS), commit
`684543d5e5efaef08d02be50dcda8d552478fa60`. Its SHA-256 is
`9575028C7A1F589F5770FCCC8CFF2734566AF40CD26ED836944E9A5152688CFE`.
The author's complete license text is `licenses/GeneralUser-GS-LICENSE.txt`.
The license permits inclusion in software projects and requests that websites
host their own copy rather than hotlink the author's download; this release
hosts the file locally.
The separate provenance record, including the pinned source revision, size,
and checksum, is `licenses/GeneralUser-GS-ATTRIBUTION.txt`.

## Runtime libraries

- **VexFlow 4.2.5** — MIT License; full notice in `licenses/LICENSE-VexFlow.txt`.
- **js-synthesizer 1.11.0** — BSD 3-Clause License; full notice in
  `synth/LICENSE.js-synthesizer.txt`.
- **FluidSynth 2.4.6 / fluidsynth-emscripten** — GNU LGPL version 2.1; full
  license in `synth/LICENSE.fluidsynth.txt`. The public `synth/fluid.js`
  is our source rebuild with libinstpatch/libsndfile explicitly disabled.
  Only Windows build-command compatibility changes were made to upstream
  CMake; the synthesis C/C++ code is unchanged. Corresponding
  pinned source archives and build instructions are included under
  `licenses/source/` and in `licenses/FLUIDSYNTH-SOURCE-AND-BUILD.md`.
- **Emscripten 3.1.10 runtime support** — MIT License; see
  `licenses/LICENSE-Emscripten.txt`.

## Build tooling

**Vite 6.4.4** is used only to build this site and is not included as a runtime
bundle; its license is retained in `licenses/LICENSE-Vite.txt`.
