# Style Trainer

A local-first music practice app built with vanilla JavaScript, VexFlow, Web MIDI,
and FluidSynth WebAssembly (`js-synthesizer` AudioWorklet).

## Hosted app and first visit

The public edition is designed for
[GitHub Pages](https://stevedeeds.github.io/style_trainer/) with source at
[SteveDeeds/style_trainer](https://github.com/SteveDeeds/style_trainer).

1. Start with the built-in **Midnight Pocket** demo.
2. Press **Play**, **Step** or **Record**, then choose **Load starter sounds**.
   GeneralUser GS is approximately 31 MiB and loads directly into the app.
   There is no ZIP extraction, file moving or download-folder setup.
3. Validated starter sounds are saved in this browser when storage is available.
   Later visits reuse those bytes after a playback gesture. Devices & audio
   shows the cache state and **Remove saved starter sounds** clears the saved
   copy without stopping already loaded sounds.
4. Alternatively, select an existing licensed `.sf2` from Downloads using
   **Load .sf2**, or explicitly enable **Preview synth** (not GM-quality).
5. **Change style → Open style folder** lists your extracted collection,
   grouped by subfolder, with preview on selection and **Load style** to practice.
   **Import style** still loads a single file. Copied private Yamaha styles
   are not included in the public edition.

On desktop Chrome/Edge, folder browsing requests **read-only** access to the
folder you explicitly choose. The app remembers a folder handle in local
IndexedDB storage (not cookies or uploaded file contents). On later visits
the list returns if permission remains granted; otherwise click **Open
remembered folder** and approve access. **Forget folder** removes the stored
reference and folder list, without deleting files or changing the loaded
exercise. Moving/deleting the folder or clearing browser storage can require
selecting it again. Other browsers use a session-only folder import.

A single imported file does not expose its parent directory or allow the
app to discover sibling files. Choose the collection folder explicitly.
Supported files are `.sty`, `.prs`, `.sst`, `.mid` and `.midi`; subfolders are
included and file contents are read only when previewing/loading a style.

The style drawer links to [JJazzLab's resources](https://www.jjazzlab.org/en/resources/).
Its user-style ZIP is described as free to download, but no redistribution
license was found in the archive. We do not mirror it. Check the source's terms,
extract a downloaded collection on your device, and import individual `.sty`,
`.prs` or `.sst` files. ZIP and `.bcs` import are not currently supported.

Downloads can be cancelled or retried. Storage errors are reported; audio can
still work for the current session without saved bytes. Browser storage can be
cleared or evicted and is not shared between browsers/devices. The app does not
silently install files under a user folder, upload imported files, or promise
offline application operation. Only the hosted starter bank is cached;
uploaded styles and SoundFonts are not copied into storage. Remembered folder
handles allow styles to be read again from the chosen directory with permission.

Use current desktop Chrome or Edge for Web MIDI and a connected controller.
GitHub Pages provides HTTPS; MIDI permission and a user gesture for audio are
still required. On-screen keys are available without a MIDI device.
Once sounds are loaded (or Preview is explicitly enabled), MIDI notes are
audible in every mode, including Stop. Correct and incorrect pitches both use
the selected practice track's instrument; accuracy changes notation/feedback,
not the instrument. With no identifiable instrument, monitoring defaults to
GM acoustic piano. Connecting MIDI without sounds opens sound setup in the
public edition; MIDI input alone cannot download audio without a user choice.

In **Choose your style**, selecting a library entry auditions its Main A
section once over four bars of **C - G - Am - F**, with all parts at full
density. Importing a style or restoring the demo in that menu also auditions
it. Library selection previews without replacing the exercise; **Load style**
applies the selection. Closing the menu, selecting another style, starting
practice, or pressing **Stop** ends the preview.

Click a notation notehead (or focus it and press Enter/Space) to hear that
individual note with its source instrument and sounding pitch. Bass notes
sound one octave below their written pitch; drums retain their assigned
sound. These auditions do not score input or advance a level. Load sounds or
enable Preview synth first; if sound setup opens, repeat the selection/click
after choosing sounds.

GeneralUser GS by S. Christian Collins has its own
[license](public-release/licenses/GeneralUser-GS-LICENSE.txt), not the app's MIT
license. See the [author's page](https://www.schristiancollins.com/generaluser)
and [third-party notices](THIRD-PARTY-NOTICES.md). We serve our own authorized
copy rather than hotlinking the author's downloads. The license notes
uncertainty about the historical origins of some samples; preserve that notice.

## Run

Requires Node.js 22 (or a supported Node.js 20 release).

**This Windows workspace is ready to run:** a private portable Node.js 22 runtime
is installed under `.tools\node` (ignored by Git), along with the npm dependencies
and the supplied SoundFont. Launch using **Tasks: Run Task → Style Trainer: dev**
in VS Code, or:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\run.ps1 dev
```

The same launcher accepts `test`, `build`, `publish`, `preview`, and `install`. It uses the
local runtime when available, otherwise Node on PATH. For a fresh checkout with
Node already installed:

```powershell
npm install
npm run dev
```

Open the localhost URL printed by Vite in Chrome or Edge. No backend, account,
or cloud upload is required. Uploaded MIDI and SoundFont data stays in the browser.
The UI font is fetched from Google Fonts; system sans-serif fonts work offline.

```powershell
npm test
npm run build
npm run preview
```

The install script copies the FluidSynth and synthesizer worklet assets into
`public/synth`. These generated files are ignored by Git and included in builds.
Local development uses the web server root. The public build supports the
GitHub Pages project prefix, including library and AudioWorklet assets.

## Safe publication

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\run.ps1 publish
```

Or run `npm run build:public`. The publication build uses an explicit separate
public asset directory and checks its output. It never includes local
`public\styles`, `public\library.json` or `public\soundfonts\default.sf2`, even
when those ignored files are present locally. The normal `build` command is
for local/private use and **must not** be uploaded as the public site.

The public asset manifest intentionally has an empty style library and names
only the pinned starter SF2. `PAGES_BASE` defaults to `/style_trainer/`; set it
explicitly if publishing under another project name.

The Pages workflow installs locked dependencies with `npm ci`, runs tests,
builds the audited public artifact, and deploys through GitHub Actions from
`main`. Select **GitHub Actions** as the repository's Pages publishing source.
No access token belongs in source or the workflow.

GitHub Pages has a 1 GB site limit and a 100 GB/month soft bandwidth limit.
The ~31 MiB starter bank fits; repeated downloads still consume bandwidth.
Private styles are excluded because redistribution permission is unknown,
not because of file size. The private ~340 MiB bank also exceeds GitHub's
ordinary 100 MiB individual-file limit.

Original code is MIT-licensed. Third-party synth binaries and SoundFont data
retain their own licenses and source-distribution requirements. Preserve the
published notices and corresponding-source materials when redistributing.

## SoundFont

The local setup uses a private copy of the supplied
`Virtual_Musician\soundfonts\JJazzLab-SoundFont.sf2` at
`public\soundfonts\default.sf2`. In local development it loads on the first playback gesture. This
~340 MiB bank may take several seconds to initialize and uses substantial memory.
Use **Load local SoundFont** to load the copied bank explicitly before playback.
You can load another licensed GM `.sf2` with **Load .sf2**, or explicitly choose
**Preview synth** before playback for lightweight oscillator audio (not GM-quality).

For a fresh checkout, load your own `.sf2` through the UI or copy one locally:

```powershell
New-Item -ItemType Directory -Force public\soundfonts
Copy-Item "C:\path\to\your\licensed-bank.sf2" public\soundfonts\default.sf2
```

SoundFonts are ignored by Git. **Do not distribute the bank or a build containing
it without checking its separate redistribution license.** `npm run build`
includes any files placed in `public`. The other project's MIT license does not
automatically grant rights to third-party SoundFonts.

## Local style library

This workspace contains **105 `.sty` files** copied from
`C:\Users\steve\JJazzLab\Rhythms` into `public\styles`, preserving their category
folders. Choose a title in **Style library**, then click **Load style**. The
library is served locally; imports from other locations still work.
Only `.sty` files were copied, not the `.prs`, `.sst`, `.bcs`, or `.mid` files.

To rebuild this private library and copy/verify the SoundFont:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\copy-library.ps1
```

The script accepts `-StylesPath` and `-SoundFontPath` overrides. It generates
`public\library.json` with URL-encoded category paths. The copied styles and
manifest are ignored by Git but included in production builds. Check the
styles' redistribution rights before sharing these assets or a build.
Missing library assets produce an explicit error; file import remains available.
Validation of the supplied library found invalid MIDI data bytes in
`CoolBand.S053.sty`, `J-PopHit1_TyPrems.S851.sty`, and
`JazzBluesSimple.S740.sty`. These copies are preserved unchanged; loading them
reports the invalid byte's file offset instead of silently altering the data.
The other 102 styles parse successfully.

## Practice

Bars share continuous staff lines within each row. The playhead and red input
markers follow the engraved note spacing, including unequal rhythmic spacing.

- **Debug level selection:** while stopped, click any density level tile to
  inspect/practice that layer without earning it first. This resets recent scores
  and the qualifying streak. Tiles are disabled during playback or asset loading.
- **Style section:** the dropdown beneath the active style name selects parsed
  Yamaha sections such as Main A, Intro B, Fill, or Ending. The demo only contains
  Main A; available sections depend on the loaded file.
- **Play**: hear the reduced target arrangement plus non-target backing parts.
  Native MIDI note-on/off messages light the target notes on the selected output.
- **Solo practice track**: while stopped, toggle this to mute all other style
  tracks. Play/Step use only the selected density's target notes. Record still
  mutes the target and keeps its count-in/metronome; your input remains audible.
  Solo does not change scoring, level-up eligibility or the source arrangement.
- **Click**: enables the steady beat in Play/Step/Record (default on). Choose
  **Clave** or **Side stick**. These are independent synthesized percussion
  timbres, so they do not replace or reprogram any style track's SoundFont kit.
  Step pauses the click while waiting for input. Record always has an audible
  one-bar count-in, even with Click off. Controls can be changed while stopped.
- **Randomize chords**: generates one diatonic seventh chord per parent exercise
  bar in the selected **Harmony key**, major/natural-minor (maj7, m7, 7, m7b5).
  Yamaha parts use their section/source-channel CASM source chord and
  transposition policies, not a chord guessed from the other instruments.
  Root Trans Bass/Melody uses a key-aware diatonic shift: RocknRoll's
  C-E-G-A bass becomes A-C-E-F over Am7 in C major. Root Fixed Chord parts
  (e.g. its piano and organ) use nearest destination chord tones in their
  original register. Drums and Bypass parts do not transpose.
  High Key and per-part note limits apply; out-of-range notes move by octaves.
  Source onsets, durations, velocities and instrument programs remain unchanged.
  Ordinary MIDI without Yamaha policies retains heuristic reharmonization.
  Harmony key defaults to the file's key when present, otherwise the selected
  part's source chord tonic/quality, or explicitly C major if neither exists.
  A missing SMF key signature is not confused with a missing Yamaha source
  chord: the header shows **Source chord**, e.g. Cmaj7, when available.
  The progression stays fixed over
  loops and density/track changes; press the button again for a new one.
  Changing style, section or parent bar count restores original harmony.
  **Restore harmony** also returns to the untouched source.
  Randomized exercises count toward level-up at full-pattern, normal-speed
  settings. Changing harmony resets the qualifying streak while preserving
  unlocked levels. One-bar drills remain practice-only; reduced-speed full
  patterns can advance through the speed ladder described below.
  One-bar drills use that original pattern bar's
  generated chord. Harmony controls can be changed while stopped.
- **Step**: the clock freezes at each target onset. Melodic chord notes must be
  held together; simultaneous drum targets can be tapped sequentially.
- **Record**: audible one-bar count-in and a steady metronome, continuous real-time
  loops, target part muted.
  MIDI note-on timestamps are matched one-to-one against target pitches within
  **±100 ms**, including hits just before or after a loop boundary. Note-offs are
  not scored. Duplicate same-pitch targets at one onset are one required input.
  Accuracy is `hits / (expected notes + extra inputs) × 100`.
  Recent six loops' scores and raw note-on timestamps/timing offsets are held in
  browser memory; they are not uploaded or saved as MIDI files.
- **Stop** resets the position and silences audio and LED feedback.
- **Loop** defaults to on; switching it off finishes the current pass, including
  the quiz's final 100 ms scoring grace window.
- Three consecutive eligible loops with **≥90%** stop automatically after scoring
  the third loop (including its 100 ms grace window), play a congratulations
  chime, and unlock the next density layer. The next level is shown while stopped;
  start Play, Step, or Record when ready. At the top level the same streak stops
  and celebrates mastery without exceeding the maximum level.
  Failed loops reset the streak. Changing style, track, or pattern length resets
  progression; stopping or switching modes breaks the streak.
- **Loop range** selects any one bar of the current 1–8-bar pattern, including
  the last bar. Notes and backing are clipped to that bar and repeated. Notes
  sustained across its starting boundary begin at the drill's start.
- **Practice speed** selects 25%, 50%, 75%, 90%, or 100% of the header BPM.
  At full-pattern settings with the header BPM at least the section's original
  BPM, **50% → 75% → 100%** is a speed ladder. Three consecutive Record loops
  at **≥90%** stop and celebrate, select the next speed, and keep the same
  density level. Press Record to start a fresh three-loop streak at that speed.
  At 100%, three qualifying loops pass the density level (or celebrate mastery)
  exactly as when starting directly at 100%. The next density stays at 100%;
  select a slower speed manually to work up again.
  Single-bar drills, a lowered header BPM, and manual 25%/90% speeds remain
  practice-only with no automatic advancement. Failed loops reset the streak.
  Tempo and drill changes preserve unlocked levels and reset the streak;
  practice controls can be changed while stopped. Randomized harmony is also
  eligible for the speed ladder.
- Optional on-screen note pads support touch, mouse, and the keyboard shortcut printed
  on each pad. Hold keys together for a chord. Pad shortcuts follow the next
  target shape and are a learning aid, not blind sight-reading assessment.

Connect your MIDI device with **Connect MIDI**, then select the input and LED
output ports. Web MIDI requires localhost/HTTPS and browser permission. No SysEx
is requested. Launchpad X must already use a compatible native note layout; the
app does not enter Programmer mode or remap pads. Other keyboards may have no
LED support. Selecting a normal synthesizer as LED output can produce extra audio.
The app stops when the tab is hidden rather than silently scoring throttled timing.

### Launchpad X LED setup

Novation documents native LED messages in **Lighting Custom Modes and Programmer
mode** via **LPX MIDI In/Out (second interface on Windows)**, not the LPX DAW port.
Factory Custom 3 and Custom 4 are lighting layouts. Channel 1 (`0x90`) sets a
steady palette colour; channel 2 flashes and channel 3 pulses. Note-off (`0x80`)
turns it off. The app already uses channel 1, without SysEx.

Port selection prefers a named Launchpad MIDI/second interface rather than DAW.
Verify the output manually if Windows uses ambiguous names. While stopped,
press a pad, then **Test LED**: the app echoes that note for 800 ms. This confirms
only that the message was sent; visually check whether the pad lights.

In Programmer mode note numbers are physical pad addresses (bottom-left = 11),
not a chromatic musical layout. Do not switch into it and expect the same bass
note mappings. Use a compatible Lighting Custom layout for practice and ensure
the selected layout contains the musical MIDI pitches being trained. Switching
channels alone does not resolve a port, layout, or unavailable-note mismatch.
The app does not change the device's mode automatically.

Sources: [Novation MIDI on Launchpad X](https://userguides.novationmusic.com/hc/en-gb/articles/24001489325330-MIDI-on-Launchpad-X)
and [Controlling the Launchpad X surface](https://userguides.novationmusic.com/hc/en-gb/articles/24001475492498-Controlling-the-Launchpad-X-surface).

### Troubleshooting zero accuracy

The workspace shows live input feedback; **Devices & audio → MIDI diagnostics
& style metadata** shows each received pitch and its MIDI note number.
**Recent loops & scoring details** distinguishes no received
notes, pitches absent from the exercise, timing outside ±100 ms, and duplicate
presses. Hearing a sound confirms input but does not mean its pitch matched.
Launchpad layouts/octave settings must send the exact target MIDI note numbers:
for example a kick on MIDI 36 is not interchangeable with melodic C4 on MIDI 60.
The app does not silently remap notes or relax timing. Use Step to verify pitch
matching first, then Record to check timing against the metronome. The target
pads retain the current shape throughout its valid ±100 ms scoring window.

## Notation-first workspace

The main screen prioritizes the score rather than setup cards. The compact
header contains style, section, practice track, key/source chord, base tempo
and pattern length. The practice toolbar keeps speed, range, Solo and Click
visible. Click the density indicators while stopped to inspect any level.
Accuracy, qualifying streak, next achievement and effective BPM sit above the
notation. Play/Step/Record/Stop/Loop and volume remain in the fixed bottom bar.

- **Change style** opens the categorized library, explicit Load button,
  Import style and Restore demo. Merely opening it does not load anything.
- **Devices & audio** contains MIDI input/LED output, Connect MIDI, SoundFont
  loading, Preview synth and click timbre. Expand MIDI diagnostics & style
  metadata for received pitches, LED tests and authored transposition rules.
  The header always reports MIDI/audio readiness.
- **Harmony** opens key selection, Randomize/Restore and the current chord
  progression; its trigger shows whether the harmony is original or randomized.
- **On-screen keys** is off initially for controller-first practice. Enable it
  to see playable pads and use their keyboard shortcuts. Hiding it releases
  held on-screen inputs without disabling MIDI or changing scoring.
- **Recent loops & scoring details** discloses score history and detailed
  rejection diagnostics. Current accuracy, input feedback, achievements and
  errors remain visible without opening it.

Setup drawers are non-modal so Stop remains available. Close with their close
button or Escape; focus returns to the opener. Harmony also supports Escape
and outside-click dismissal. The Help guide is a modal dialog. Opening setup
does not stop playback, reset progress or request MIDI permission; existing
restrictions on actual setting changes still apply. Narrow layouts wrap
controls and preserve horizontal scrolling within the notation, not the page.

For browser UI regression checks, open a fresh **dev-server** page at desktop
size, then run in its browser console:

```js
await import('/tests/ui.browser.js').then(module => module.verifyUI())
await import('/tests/ui.browser.js').then(module => module.verifyNotationLayout())
```

This checks real DOM controls, disclosure focus, hidden keys, harmony summaries,
practice eligibility, unique IDs and laptop score placement. It deliberately
changes practice settings, so use a test page rather than an active session.
The notation checks cover joined barlines, playhead alignment and red input
markers across bass, grand staff and drums at narrow and desktop widths.
The existing `test` command still runs the musical/transport regression suite.
On a disposable browser profile, `verifySavedSounds()` from the same module
checks IndexedDB save/read, version isolation, integrity and clearing. It
replaces that browser origin's starter cache; do not run it during practice.

## Import and density rules

Imports beat-based format-0/1 SMF `.mid`/`.midi` and MIDI-compatible Yamaha
`.sty`/`.prs`/`.sst`. Yamaha section markers select Main, Intro, Fill, Ending and
Break ranges. Short sections repeat to fill the requested 1–8 bars.

GM channel 10 and Yamaha percussion bank MSBs 126/127 identify drums; GM bass
programs 33–40 (one-based), or a track
name containing "bass", identify bass. Other pitched tracks are harmonic parts.
All levels are cumulative filters of the actual source notes, not generated
practice patterns. Pitches, onset times, durations, and velocities are preserved
(durations are clipped at section/exercise boundaries).

| Level | Drums | Bass and chords |
|---|---|---|
| 1 | All kicks (33/35/36), on or off the beat | Root notes on the main beats |
| 2 | Add snares and side stick (31/37/38/40), on or off the beat | Add root notes off the beat |
| 3 | Add hi-hats (GM 42/44/46) | Add other notes on the main beats |
| 4 | Everything else, including snare rolls, rimshots, cymbals, toms and fills | All remaining source notes |

These categories affect training density and staff placement only. Playback
keeps each source MIDI pitch, kit program and velocity; side stick 37 is not
remapped to snare 38, and soft kick 33 is not remapped to kick 36.

In 4/4, main beats are the four quarter-note beats. Other meters use the
time-signature denominator's beat unit. Onsets within 6% of that unit are treated
as on-beat to accommodate humanized MIDI; they are never moved onto the grid.
Roots match by pitch class in any octave. Yamaha parts use their authored CASM
source roots when not randomized, and the generated chord roots when randomized.
For ordinary MIDI without Yamaha policies, chord roots are inferred from sounding
harmonic notes, following chord changes and sustaining the established harmony
through single-note passing tones. Where there is no multi-note harmonic voicing,
the bar's harmonic notes are used; bass-only material falls back to the first
on-beat bass pitch (or its first bass note). This is heuristic, not an authored
chord chart. Empty lower layers are valid: no missing roots or beats are invented.

### Yamaha metadata and transposition

The parser reads trailing CASM/CSEG/Sdec blocks, associates comma-separated
section names with Ctab source-channel entries, and reads source root/chord,
destination channel, NTR, NTT, High Key, note limits and RTR from documented
offsets. Cntt overrides and Ctb2 low/middle/high pitch-range policies are also
decoded. Destination Rhythm/Bass roles inform part classification without
changing source MIDI programs or channel identities. The score footer shows
the selected part's source chord and transposition rules. Malformed CASM chunks
are rejected explicitly rather than silently discarded.

Reharmonization implements the practice rules above and the degree changes of
the melodic/harmonic/natural-minor and Dorian table families. It is not a
bit-exact implementation of Yamaha's proprietary conversion tables. SFF2 Guitar
NTR and unknown tables produce an explicit error during randomization, leaving
the previous exercise intact; their original patterns remain loadable.
Decoded RTR values do not yet retune/retrigger notes held across chord changes:
notes retain the chord transformation from their source attack. Chord/note
mute masks, on-bass/slash chord recognition and Yamaha XF chord meta-events are
not currently applied. No source attacks are invented for these features.

Format references:
[Yamaha CASM settings](http://www.jososoft.dk/yamaha/articles/style2_2.htm),
[Ctab/Cntt format](http://www.jososoft.dk/yamaha/articles/casm_1.htm) and
[Ctb2 format](http://www.jososoft.dk/yamaha/articles/casm_2.htm).

**Practice track** lists the loaded style's playable MIDI tracks, with the source
track number and MIDI channel. There is no Full Style option. Format-0 Yamaha
files often put every part in one SMF track, so each track/channel pair is a
separate selection. Only the selected track is simplified, displayed, scored,
and muted in Record; all other tracks, including others of the same instrument
type, remain in the backing. The existing drum/bass/harmonic density progression
applies to the selected track. A track may be silent in some sections or at its
lowest layer; choose another track or section if no targets are present.

The practice BPM is fixed: embedded tempo changes are not followed. Meter is read
at the section start; exercises crossing meter changes are rejected explicitly.
Notation is **attack-focused**, rather than an exact transcription of MIDI
note-off times. Onsets are quantized to sixteenths. A trailing silent gap up to
an eighth note is absorbed when a clean plain or dotted note fills that space:
This also applies before a longer rest: a dotted eighth on beat 2 followed by
a sixteenth rest and a quarter rest becomes a quarter note, then a quarter rest.
Plain beat-aligned values are preferred over dotted notes plus tiny rests.

| Source rhythm | Simplified display |
|---|---|
| Eighth tied to sixteenth, then sixteenth rest | Quarter |
| Dotted quarter, then eighth rest | Half |
| Eighth, then eighth rest | Staccato quarter |
| Sixteenth, then sixteenth rest | Staccato eighth |

Longer gaps and leading rests remain visible; no new attack is removed or moved
to fit a longer note. A note sounding for about half or less of its displayed
length gets staccato (55% threshold for humanization). Three-quarter-length
notes get no extra mark. Automatic tenuto and inferred legato slurs are not used.
Clean dotted values remain when helpful. Off-beat sustain may use a minimal tie
to show a beat boundary, and notes sustained across barlines remain tied, without
adding a new attack or scoring target. Chords use their longest release to avoid
a rest while another chord tone is still sounding; staccato applies only when
all notes in the shape are short. Independent overlapping voices on one staff
are still simplified into attack groups.
This display-only approximation does not change the source notes.
**Scoring and playback
retain the original MIDI onset times** at every density level. The current score shows the target parts,
not every backing track. Pitched parts use a grand staff and drums use a separate
percussion staff. Bass guitar has its own bass staff, written one octave higher
than its sounding MIDI pitches. A small **8 below the bass clef** (8vb) indicates
that the part sounds one octave lower than written. This applies to bass tracks;
chord staves remain at concert pitch. Audio, target pad labels,
and MIDI scoring always use the original sounding pitches.
Accidentals follow the key signature and reset each bar; naturals are only shown
when cancelling an alteration. Dense bars wrap onto additional systems based on
VexFlow's measured engraving width rather than MIDI onset count, with reduced
padding. Exercises with two or more bars always show at least two bars per row;
an odd final row may contain one remaining bar. On narrow screens the row
scrolls horizontally rather than squeezing or switching to one-bar rows.
Correct input in Step/Record paints the matching target notehead green.
Rejected input adds a red eighth-note glyph at the played pitch and time
(including mistimed/duplicate presses). Feedback clears at each loop/re-render.

This is a **GM arrangement trainer**, not a full Yamaha arranger emulator:
Full Yamaha phrase fitting/RTR behavior and proprietary Yamaha voices (melodic banks are mapped to
GM bank 0, percussion to SoundFont bank 128), automatic accompaniment chord
recognition, continuous-controller automation and pitch-bend are not implemented.
SMPTE and asynchronous format-2 files are rejected. ±100 ms is the scoring criterion,
not a guarantee about USB/device latency; browser audio and MIDI hardware latency
can affect perceived timing. The scheduler polls at 5 ms; keep this tab active.

## Credits

- VexFlow 4.2.5: MIT license.
- js-synthesizer 1.11.0: BSD-3-Clause; its bundled FluidSynth: LGPL-2.1.
  Refer to the corresponding installed package notices before redistribution.
- The supplied Virtual_Musician resources informed SoundFont selection and Yamaha
  section handling. This app's parser and training logic are independently written;
  no Python implementation or model data was copied.
