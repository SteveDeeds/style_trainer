import './style.css';
import { createDemo, parseMidi } from './midi.js';
import { buildExercise, LAYERS, partOf, pitchName, practiceExercise, Progression, randomHarmony, styleTracks, targetGroupAt, TIMING_TOLERANCE_MS, trackIdOf } from './training.js';
import { AudioEngine, monitorNote } from './audio.js';
import { MidiController } from './controller.js';
import { Notation } from './notation.js';
import { Transport } from './transport.js';
import { sourceHarmony } from './yamaha.js';
import { assetUrl } from './assets.js';
import { clearSavedSounds, downloadSounds, readSavedSounds, saveSounds, validateStarter } from './soundfont-cache.js';

const icons = {
  play: '<path d="m8 5 11 7-11 7Z"/>',
  step: '<path d="M9 4v5m6-3v5M7 12h4v7H7zm6 2h4v7h-4z"/>',
  record: '<circle cx="12" cy="12" r="6"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  loop: '<path d="M19 8a8 8 0 0 0-13-2L3 9m0-5v5h5m-3 7a8 8 0 0 0 13 2l3-3m0 5v-5h-5"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name]}</svg>`;
document.querySelector('#app').innerHTML = `
  <header class="site-header">
    <a class="brand" href="./" aria-label="Style Trainer home"><span class="brand-mark">≋</span><span>style<span class="brand-light">trainer</span><small>FIND YOUR GROOVE</small></span></a>
    <div class="header-actions"><button id="open-style" class="header-button" aria-haspopup="dialog">Change style</button><button id="open-devices" class="header-button" aria-haspopup="dialog">Devices & audio <span id="device-summary" class="readiness"></span></button><button id="help" class="help-button" aria-label="Open practice guide">?</button></div>
  </header>
  <main>
    <section class="style-strip" aria-label="Exercise settings">
      <div class="style-title"><h2 id="style-name"></h2><label>Section <select id="section" aria-label="Style section"></select></label></div>
      <label class="focus-label">Track <select id="focus" aria-label="Practice track"></select></label>
      <div class="metric"><span id="key-label" class="field-label">KEY SIGNATURE</span><strong id="key"></strong><span id="meter" class="metric-sub"></span></div>
      <label class="metric"><span class="field-label">BASE TEMPO</span><span class="tempo-input"><input id="bpm" type="number" min="30" max="240" value="96" aria-label="Tempo in BPM"><small>BPM</small></span></label>
      <label class="metric"><span class="field-label">LENGTH</span><select id="bars" aria-label="Exercise length in bars">${Array.from({ length: 8 }, (_, i) => `<option value="${i + 1}" ${i === 3 ? 'selected' : ''}>${i + 1} ${i ? 'bars' : 'bar'}</option>`).join('')}</select></label>
    </section>
    <section class="practice-settings" aria-label="Practice drills">
      <label>Speed <select id="practice-speed" aria-label="Practice speed"><option value="100">100% · normal</option><option value="90">90%</option><option value="75">75%</option><option value="50">50%</option><option value="25">25%</option></select></label>
      <label>Range <select id="practice-bar" aria-label="Practice bar"><option value="">Full pattern</option></select></label>
      <label><input id="solo" type="checkbox"> Solo practice track</label>
      <label><input id="click" type="checkbox" checked> Click</label>
      <button id="open-harmony" class="small-button" popovertarget="harmony-popover" aria-controls="harmony-popover">Harmony: Original</button>
      <label><input id="show-keys" type="checkbox" aria-controls="keys-panel"> On-screen keys</label>
    </section>
    <section class="workspace">
      <section class="density-panel" aria-label="Difficulty progression">
        <div class="density-heading"><span class="level-badge" id="level-badge">LEVEL 1 / 4</span><strong id="density-name"></strong></div>
        <div id="layers" class="layer-progress"></div>
      </section>
      <div class="score-heading"><div class="mode-summary"><span class="status-dot" id="status-dot"></span><strong id="mode-label">Ready when you are</strong><span id="mode-description">Choose a mode below to begin</span></div><div class="measure-display"><span id="measure">BAR 01 / 04</span><span id="beat-dots" class="beat-dots"></span></div></div>
      <div class="progress-summary"><strong id="accuracy" aria-label="Latest loop accuracy">—<small>%</small></strong><span id="streak-label">90%+ for 3 loops to level up</span><div id="streak" class="streak"></div></div>
      <div id="practice-status" class="practice-status">Full pattern · eligible for level-up</div>
      <div id="notation" class="notation" aria-live="off"></div>
      <div class="timeline"><div id="timeline-fill"></div></div>
      <div class="score-footer"><span id="score-detail">Record a loop to see your accuracy.</span><span id="loop-count">Loop 1</span></div>
    </section>
    <div id="notice" class="notice" role="status">Start with Play, use Step to learn the notes, then Record to test your groove.</div>
    <div class="input-monitor"><p id="input-feedback" role="status">Match the exact MIDI pitches in the score.</p></div>
    <details class="results-details"><summary>Recent loops & scoring details</summary><p id="score-status">Your next personal best awaits</p><div id="score-history" class="score-history" aria-label="Recent loop scores"></div><p id="score-diagnostic" class="score-diagnostic">Pitch and timing feedback appears after each recorded loop.</p></details>
    <section id="keys-panel" class="controller-card" aria-label="On-screen playable keys" hidden>
        <div class="controller-top"><span id="target-hint">Target notes for the first step</span></div>
        <div id="practice-pads" class="practice-pads" aria-label="Playable target notes"></div>
        <p class="controller-tip">Hold chord notes together. Tap drum pads. Keyboard shortcuts appear on each pad.</p>
    </section>
  </main>
  <dialog id="style-dialog" class="setup-drawer" aria-labelledby="style-dialog-title">
    <div class="dialog-heading"><h2 id="style-dialog-title">Choose your style</h2><button data-close="style-dialog" aria-label="Close style library">×</button></div>
    <p class="drawer-notice" data-notice role="status"></p>
    <p>Choose a local arrangement, then load it when you are ready.</p>
    <label>Style library <select id="library-style" aria-label="Local style"><option value="">Choose a local style…</option></select></label>
    <button id="load-style" class="small-button" disabled>Load style</button>
    <p id="library-status">Loading local library…</p>
    <div class="drawer-actions"><label class="upload-button">${icon('upload')} Import style<input id="style-file" type="file" accept=".mid,.midi,.sty,.prs,.sst" class="file-input"></label><button id="demo" class="small-button" title="Restore the built-in demo">Restore demo</button></div>
    <p>Looking for styles? Visit <a href="https://www.jjazzlab.org/en/resources/" target="_blank" rel="noopener noreferrer">JJazzLab's style resources</a>. Check the source's terms, download and extract files on your device, then import an individual .sty, .prs or .sst here. Style Trainer does not distribute or automatically download that collection.</p>
  </dialog>
  <dialog id="devices-dialog" class="setup-drawer" aria-labelledby="devices-dialog-title">
    <div class="dialog-heading"><h2 id="devices-dialog-title">Devices & audio</h2><button data-close="devices-dialog" aria-label="Close devices and audio">×</button></div>
    <p class="drawer-notice" data-notice role="status"></p>
    <div class="controller-top"><span id="input-status" class="tiny-tag">NO MIDI INPUT</span><button id="connect-midi" class="small-button">Connect MIDI</button></div>
        <div class="device-selectors"><label>Input <select id="midi-input" aria-label="MIDI input"><option value="">On-screen only</option></select></label><label>LED output <select id="midi-output" aria-label="MIDI LED output"><option value="">Off</option></select></label></div>
    <section class="audio-strip" aria-label="Audio settings"><div><b id="audio-status">JJazzLab SoundFont</b><small id="audio-detail">Local GM sound · loads on first playback</small></div><button id="load-local-font" class="small-button">Load local SoundFont</button><label class="sf-upload">Load .sf2<input id="sf-file" type="file" accept=".sf2" class="file-input"></label><label class="preview-option"><input id="preview" type="checkbox"> Preview synth</label></section>
    <section id="starter-setup" hidden aria-label="Starter sound setup">
      <p id="starter-guide">Load starter sounds once (~31 MiB), then they can be saved in this browser. No file moving or folder setup is needed. Or select your own .sf2 from Downloads, or explicitly choose Preview synth (not GM-quality).</p>
      <progress id="sound-progress" hidden aria-label="Starter sound download progress"></progress>
      <button id="cancel-sounds" class="small-button" hidden>Cancel sound loading</button>
      <p id="cache-status" role="status">Starter sounds have not been saved in this browser.</p>
      <button id="clear-sounds" class="small-button">Remove saved starter sounds</button>
      <p><a href="https://www.schristiancollins.com/generaluser" target="_blank" rel="noopener noreferrer">About GeneralUser GS by S. Christian Collins</a> · <a id="sound-license" target="_blank" rel="noopener noreferrer">SoundFont license</a></p>
    </section>
    <label>Click sound <select id="click-sound" aria-label="Click sound"><option value="clave">Clave</option><option value="side-stick">Side stick</option></select></label>
    <details class="results-details"><summary>MIDI diagnostics & style metadata</summary>
        <div class="controller-top"><span>Launchpad LEDs: LPX MIDI / second Windows port, Lighting Custom mode. Channel 1 is steady.</span><button id="test-led" class="small-button">Test LED</button></div>
        <p id="received-note">No input notes received yet.</p><p id="target-description"></p>
    </details>
  </dialog>
  <section id="harmony-popover" class="harmony-popover" popover aria-labelledby="harmony-title">
    <div class="dialog-heading"><h2 id="harmony-title">Practice harmony</h2><button popovertarget="harmony-popover" popovertargetaction="hide" aria-label="Close harmony options">×</button></div>
    <p class="drawer-notice" data-notice role="status"></p>
    <label>Harmony key <select id="harmony-key" aria-label="Harmony key">${['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'Abm', 'Ebm', 'Bbm', 'Fm', 'Cm', 'Gm', 'Dm', 'Am', 'Em', 'Bm', 'F#m', 'C#m', 'G#m', 'D#m', 'A#m'].map(key => `<option value="${key}">${key.endsWith('m') ? key.slice(0, -1) + ' minor' : key + ' major'}</option>`).join('')}</select></label>
    <p id="harmony-summary">Original harmony</p>
    <div class="drawer-actions"><button id="randomize-chords" class="small-button">Randomize chords</button><button id="restore-chords" class="small-button" disabled>Restore harmony</button></div>
    <p>One chord per bar. Changing harmony resets the streak, not unlocked levels. Full-pattern randomized exercises qualify for speed and level advancement.</p>
  </section>
  <footer class="transport-shell"><div class="transport-inner"><span id="transport-caption" class="transport-caption">Start with a little listening.</span><nav class="transport" aria-label="Transport and practice modes"><button id="play" class="mode-button play-button" aria-pressed="false">${icon('play')}<span>PLAY<small>Listen</small></span></button><button id="step" class="mode-button" aria-pressed="false">${icon('step')}<span>STEP<small>Wait for notes</small></span></button><button id="record" class="mode-button record-button" aria-pressed="false">${icon('record')}<span>RECORD<small>Test yourself</small></span></button><button id="stop" class="mode-button stop-button" aria-pressed="true">${icon('stop')}<span>STOP<small>Reset</small></span></button><button id="loop" class="loop-button" aria-pressed="true">${icon('loop')}<span>LOOP: ON</span></button></nav><label class="volume-label">Volume <input id="volume" type="range" min="0" max="100" value="65" aria-label="Volume"></label></div></footer>
  <dialog id="help-dialog"><div class="dialog-heading"><h2>Find your groove.</h2><button id="close-help" aria-label="Close practice guide">×</button></div>
    <p><b>Play</b> loops the target arrangement and lights MIDI notes. <b>Step</b> freezes at each target onset until you play the pitches. Hold melodic shapes together; drum hits can be tapped in sequence. <b>Record</b> gives a one-bar count-in, mutes your target part, and scores each loop.</p>
    <p>Timing is measured within <b>±${TIMING_TOLERANCE_MS} ms</b> using MIDI event timestamps. Wrong and extra notes count against you. Score at least <b>90% on three consecutive full-pattern loops at normal tempo</b> to stop automatically, hear congratulations, and unlock the next layer. Press a transport button when ready to continue.</p>
    <p><b>Range</b> lets you drill any individual bar. At full-pattern settings and the original base BPM, <b>Speed</b> advances through 50% → 75% → 100% after three consecutive Record loops at 90%+. Each achievement stops and celebrates; start again when ready. At 100%, the same streak passes the density level. Single-bar drills, 25%/90% speeds and a lowered base BPM remain practice-only.</p>
    <p>The score emphasizes <b>note attacks</b>: short release rests can become a longer note, with a staccato dot for clearly short articulation. Meaningful rests remain. Ties are reserved for beat/bar boundaries; no automatic tenuto or legato is inferred. Audio and scoring retain source timing.</p>
    <p><b>Change style</b> opens the local library, import and demo controls. <b>Devices & audio</b> contains MIDI ports, SoundFont loading, Preview synth, click sound and diagnostics. <b>Harmony</b> offers key selection, randomization and restore. Enable <b>On-screen keys</b> for playable pads; MIDI works with them hidden. Click a level indicator while stopped to inspect any density.</p>
    <p>Files are processed locally. Yamaha CASM source chords and per-part rules guide transposition; ordinary MIDI uses inferred harmony. Full Yamaha Guitar/RTR behavior and proprietary voices are not implemented. Tempo is fixed to the selected BPM. Notation quantizes to sixteenths; scoring uses original timing.</p>
    <p>Use Chrome or Edge on localhost/HTTPS for MIDI. For Launchpad X LEDs, choose LPX MIDI (second Windows interface) and a compatible Lighting Custom layout. Channel 1 provides steady colour. No SysEx is sent. Generic MIDI keyboards may not support LEDs.</p>
    <p>The supplied JJazzLab SF2 is large (~340 MiB). The first load may take a few seconds. Use a smaller licensed GM SF2 or explicitly select Preview synth for lightweight practice. Preview audio is not GM-quality.</p>
  </dialog>
`;

const $ = id => document.getElementById(id);
const audio = new AudioEngine();
let style = createDemo();
let progression = new Progression(4);
let exercise;
let randomizedHarmony = null;
let busy = false;
let startRequest = 0;
let soundfontName = 'JJazzLab SoundFont';
let library = { styles: [], soundfonts: [] };
let localFontUrl = '/soundfonts/default.sf2';
let libraryReady;
let pendingMode = null;
let soundLoad = null;
let starterWarning = '';
let libraryFailure = null;
let savedStarterAvailable = false;
let history = [];
let lastPadKey = '';
const pressedKeys = new Map();
const pointerNotes = new Map();
const inputNotes = new Map();
const litCounts = new Map();
const shortcuts = 'asdfghjklqwertyui';
const notify = (message, error = false) => {
  $('notice').textContent = message;
  $('notice').classList.toggle('error', error);
  $('notice').setAttribute('role', error ? 'alert' : 'status');
  for (const surface of document.querySelectorAll('[data-notice]')) {
    surface.textContent = message;
    surface.classList.toggle('error', error);
    surface.setAttribute('role', error ? 'alert' : 'status');
  }
};
const reportError = error => { console.error(error); notify(error.message || String(error), true); };
const controller = new MidiController(handleInput, updateDevices, reportError);
const notation = new Notation($('notation'));
const transport = new Transport({
  noteOn: note => {
    audio.on(note);
    if (note.isTarget) {
      litCounts.set(note.pitch, (litCounts.get(note.pitch) ?? 0) + 1);
      controller.light(note.pitch, true);
    }
  },
  noteOff: note => {
    audio.off(note);
    if (note.isTarget) {
      const count = (litCounts.get(note.pitch) ?? 1) - 1;
      if (count <= 0) {
        litCounts.delete(note.pitch);
        if (!transport.waiting?.group.pitches.includes(note.pitch)) controller.light(note.pitch, false);
      }
      else litCounts.set(note.pitch, count);
    }
  },
  silence: () => { audio.silence(); inputNotes.clear(); litCounts.clear(); controller.clear(); },
  guide: pitches => controller.guide(pitches),
  onState: () => updateTransport(),
  onResult: (result, loop, scoredExercise, inputs) => {
    history.push({ ...result, loop, level: scoredExercise.level, inputs, practiceOnly: scoredExercise.practiceOnly, speed: scoredExercise.practiceSpeed, tempoEligible: scoredExercise.nextSpeed != null });
    history = history.slice(-6);
    const advancement = progression.submitExercise(result.score, scoredExercise);
    if (advancement) {
      const leveledUp = progression.level > scoredExercise.level;
      transport.stop();
      if (advancement.nextSpeed) $('practice-speed').value = String(advancement.nextSpeed);
      exercise = makeExercise();
      notation.render(exercise, notationKey());
      lastPadKey = '';
      updateDensity();
      updateExerciseDescription();
      audio.celebrate();
      notify(advancement.nextSpeed ? `Congratulations! Three consecutive loops at 90% or higher at ${scoredExercise.practiceSpeed}%. Speed increased to ${advancement.nextSpeed}% at level ${progression.level} — press Play, Step or Record when ready.` :
        leveledUp ? `Congratulations! Three consecutive loops at 90% or higher. Level ${progression.level} unlocked — press Play, Step or Record when ready.` :
        'Congratulations! Three consecutive loops at 90% or higher on the top level. Pattern mastered!');
    }
    updateProgress();
  },
  onLoop: cycle => {
    notation.clearFeedback();
    if (exercise !== transport.exercise) {
      exercise = transport.exercise;
      notation.render(exercise, notationKey());
      lastPadKey = '';
      updateDensity();
      updateExerciseDescription();
    }
    $('loop-count').textContent = `Loop ${cycle}`;
  },
  onError: reportError,
  onBeat: accent => audio.click(accent),
});

function makeExercise() {
  const section = Number($('section').value);
  const full = buildExercise(style, { section, bars: Number($('bars').value), trackId: $('focus').value, level: progression.level, harmony: randomizedHarmony });
  const normalBpm = Math.round(style.tempos.filter(t => t.tick <= style.sections[section].start).at(-1)?.bpm ?? 120);
  return practiceExercise(full, {
    bar: $('practice-bar').value === '' ? null : Number($('practice-bar').value),
    bpm: Number($('bpm').value), normalBpm, speed: Number($('practice-speed').value),
  });
}
function notationKey() {
  return randomizedHarmony ? $('harmony-key').value : style.key;
}
function sourcePolicy() {
  return style.sections[Number($('section').value)]?.channelPolicies?.[$('focus').value.split(':')[1]];
}
function updatePracticeBars() {
  const previous = $('practice-bar').value;
  $('practice-bar').replaceChildren(new Option('Full pattern', ''), ...Array.from({ length: Number($('bars').value) }, (_, i) => new Option(`Bar ${i + 1} only`, i)));
  if (previous !== '' && Number(previous) < Number($('bars').value)) $('practice-bar').value = previous;
}
function updateExerciseDescription() {
  $('target-description').textContent = `${exercise.groups.reduce((n, g) => n + g.pitches.length, 0)} target notes · ${exercise.meter.numerator}/${exercise.meter.denominator} · ${exercise.sourceBar ? `Pattern bar ${exercise.sourceBar} · ` : ''}${exercise.randomized ? 'Randomized harmony' : style.demo ? 'Demo arrangement' : 'Imported arrangement'}`;
  const policy = sourcePolicy();
  if (policy) {
    const rules = [...new Set(policy.ranges.map(range => `${['Root Trans', 'Root Fixed', 'Guitar'][range.ntr] ?? `NTR ${range.ntr}`} / ${range.ntt}`))];
    $('target-description').textContent += ` · Source ${sourceHarmony(policy).name} · ${rules.join(', ')}`;
  }
  $('practice-status').textContent = `${Math.round(exercise.playbackBpm * 10) / 10} BPM · ${exercise.nextSpeed != null ? `${exercise.practiceSpeed}% · eligible for speed-up to ${exercise.nextSpeed}%` : exercise.practiceOnly ? 'Practice only — no level-up credit' : 'Full pattern · eligible for level-up'}`;
  $('open-harmony').textContent = randomizedHarmony ? `Harmony: ${$('harmony-key').value} · Randomized` : 'Harmony: Original';
  $('harmony-summary').textContent = exercise.chords.filter(Boolean).join(' → ') || 'No source chord available';
}
function resetProgress() {
  progression = new Progression(trackLayers().length);
  history = [];
  updateProgress();
}
function rebuild() {
  transport.stop();
  exercise = makeExercise();
  notation.render(exercise, notationKey());
  $('style-name').textContent = style.name;
  const policy = sourcePolicy();
  const showSource = !randomizedHarmony && style.key === 'Unknown' && policy;
  $('key-label').textContent = showSource ? 'SOURCE CHORD' : 'KEY SIGNATURE';
  $('key').textContent = showSource ? sourceHarmony(policy).name : notationKey();
  $('meter').textContent = `${exercise.meter.numerator}/${exercise.meter.denominator} time`;
  $('loop-count').textContent = 'Loop 1';
  updateExerciseDescription();
  $('beat-dots').replaceChildren(...Array.from({ length: exercise.meter.numerator }, () => document.createElement('i')));
  lastPadKey = '';
  updateDensity();
  updatePads();
  for (const pad of $('practice-pads').children) {
    pad.classList.toggle('sounding', litCounts.has(Number(pad.dataset.pitch)));
    pad.classList.toggle('held', inputNotes.has(Number(pad.dataset.pitch)));
  }
  updateProgress();
}
function setStyle(next) {
  style = next;
  randomizedHarmony = null;
  $('section').replaceChildren(...style.sections.map((s, i) => new Option(s.name, i)));
  updateTracks('');
  $('harmony-key').value = style.key === 'Unknown' ? (sourcePolicy() ? sourceHarmony(sourcePolicy()).key : 'C') : style.key;
  const start = style.sections[0].start;
  $('bpm').value = Math.round(style.tempos.filter(t => t.tick <= start).at(-1)?.bpm ?? 120);
  $('practice-bar').value = '';
  $('practice-speed').value = '100';
  updatePracticeBars();
  resetProgress();
  rebuild();
}
function updateTracks(preferred = $('focus').value) {
  const section = style.sections[Number($('section').value)];
  const active = new Set(style.notes.filter(note => note.tick >= section.start && note.tick < section.end)
    .map(note => `${note.track}:${note.channel}`));
  const tracks = styleTracks(style);
  $('focus').replaceChildren(...tracks.map(track => new Option(`${track.name}${active.has(track.id) ? '' : ' — silent in this section'}`, track.id)));
  $('focus').value = tracks.find(track => track.id === preferred && active.has(track.id))?.id ??
    tracks.find(track => active.has(track.id))?.id ?? tracks[0].id;
}
function trackLayers() {
  const track = styleTracks(style).find(track => track.id === $('focus').value);
  if (!track) throw new Error('Select a playable track from this style.');
  return LAYERS[track.part];
}
function updateDensity() {
  const layers = trackLayers();
  $('level-badge').textContent = `LEVEL ${progression.level} / ${layers.length}`;
  $('density-name').textContent = layers[progression.level - 1];
  $('layers').replaceChildren(...layers.map((layer, i) => {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = `layer ${i + 1 <= progression.level ? 'unlocked' : ''} ${i + 1 === progression.level ? 'current' : ''}`;
    element.title = `Debug: select level ${i + 1} — ${layer}`;
    element.setAttribute('aria-label', `Select level ${i + 1}: ${layer}`);
    element.setAttribute('aria-pressed', String(i + 1 === progression.level));
    element.disabled = busy || transport.mode !== 'stop';
    element.addEventListener('click', () => {
      if (busy || transport.mode !== 'stop') return;
      try {
        progression.selectLevel(i + 1);
        history = [];
        rebuild();
        notify(`Debug: level ${i + 1} selected. Scores and qualifying streak reset.`);
      } catch (error) { reportError(error); }
    });
    element.innerHTML = `<span>${i + 1 < progression.level ? '✓' : String(i + 1).padStart(2, '0')}</span>`;
    const label = document.createElement('b');
    label.textContent = `Level ${i + 1}`;
    element.append(label);
    return element;
  }));
}
function updateProgress() {
  const result = history.at(-1);
  $('accuracy').innerHTML = result ? `${Math.round(result.score)}<small>%</small>` : '—<small>%</small>';
  $('score-status').textContent = result ? result.score >= 90 ? 'Right in the pocket.' : 'Every loop is a fresh start.' : 'Your next personal best awaits';
  $('score-detail').textContent = result ? `${result.hits} / ${result.total} notes · ${result.extra} extra · Loop ${result.loop}` : 'Record a loop to see your accuracy.';
  if (!result) {
    $('score-diagnostic').textContent = 'Pitch and timing feedback appears after each recorded loop.';
  } else if (!result.inputs.length) {
    $('score-diagnostic').textContent = 'No note-on input reached this loop. Check the MIDI input port and play after the count-in.';
  } else {
    const pitchMisses = result.inputs.filter(input => input.feedback.reason === 'pitch').length;
    const timingMisses = result.inputs.filter(input => input.feedback.reason === 'timing');
    const duplicates = result.inputs.filter(input => input.feedback.reason === 'duplicate').length;
    const pitches = [...new Set(result.inputs.map(input => input.pitch))].sort((a, b) => a - b);
    const details = [`Received ${result.inputs.length} presses (MIDI ${pitches.join(', ')})`];
    if (pitchMisses) details.push(`${pitchMisses} wrong-pitch presses — check your Launchpad layout/octave`);
    if (timingMisses.length) {
      const median = timingMisses.map(input => input.feedback.offsetMs).sort((a, b) => a - b)[Math.floor(timingMisses.length / 2)];
      details.push(`${timingMisses.length} outside ±${TIMING_TOLERANCE_MS} ms (median ${Math.round(Math.abs(median))} ms ${median < 0 ? 'early' : 'late'})`);
    }
    if (duplicates) details.push(`${duplicates} repeated presses`);
    $('score-diagnostic').textContent = details.join(' · ');
  }
  $('streak-label').textContent = exercise?.nextSpeed != null ? `${progression.streak} / 3 qualifying loops · 90% to increase speed to ${exercise.nextSpeed}%` :
    exercise?.practiceOnly ? 'Practice only — these scores do not count toward level-up' :
    `${progression.streak} / 3 qualifying loops · 90% to ${progression.level === progression.maxLevel ? 'master this pattern' : 'advance'}`;
  $('streak').replaceChildren(...Array.from({ length: 3 }, (_, i) => {
    const dot = document.createElement('i');
    dot.className = i < progression.streak ? 'filled' : '';
    return dot;
  }));
  $('score-history').replaceChildren(...history.map(r => {
    const span = document.createElement('span');
    span.textContent = `${Math.round(r.score)}%${r.tempoEligible ? ` · ${r.speed}% speed` : r.practiceOnly ? ' · drill' : ''}`;
    span.title = `Loop ${r.loop}: ${r.hits} of ${r.total}, ${r.extra} extra`;
    if (r.score >= 90) span.className = 'pass';
    return span;
  }));
}
function updateTransport() {
  const mode = transport.mode;
  for (const button of $('layers').children) button.disabled = busy || mode !== 'stop';
  if (mode === 'stop') $('loop-count').textContent = 'Loop 1';
  for (const name of ['play', 'step', 'record', 'stop']) {
    $(name).setAttribute('aria-pressed', String(mode === name));
    $(name).classList.toggle('active', mode === name);
  }
  $('status-dot').className = `status-dot ${mode}`;
  const labels = { stop: 'Ready when you are', play: 'Listen mode', step: 'Step mode', record: 'Record mode' };
  $('mode-label').textContent = labels[mode];
  $('mode-description').textContent = transport.waiting ? 'Waiting for your notes' :
    mode === 'record' ? `Target muted · ±${TIMING_TOLERANCE_MS} ms timing window` :
    mode === 'play' ? 'Listen to the target and follow the score' :
    mode === 'step' ? 'Your notes move the music forward' : 'Choose a mode below to begin';
  if (transport.solo) $('mode-description').textContent += ' · Solo: backing muted';
  $('solo').disabled = busy || mode !== 'stop';
  $('restore-chords').disabled = busy || mode !== 'stop' || randomizedHarmony === null;
  $('transport-caption').textContent = { stop: 'Start with a little listening.', play: 'Get to know the groove.', step: 'Take it one shape at a time.', record: 'You have the lead now.' }[mode];
  for (const id of ['focus', 'bars', 'section', 'bpm', 'style-file', 'demo', 'sf-file', 'preview', 'practice-bar', 'practice-speed', 'library-style', 'load-local-font', 'click', 'click-sound', 'harmony-key', 'randomize-chords']) $(id).disabled = busy || mode !== 'stop';
  $('load-style').disabled = busy || mode !== 'stop' || !$('library-style').value;
  $('test-led').disabled = busy || mode !== 'stop';
  $('connect-midi').disabled = busy;
  $('midi-input').disabled = busy;
  $('clear-sounds').disabled = busy || mode !== 'stop';
}
function updateDevices() {
  for (const [id, ports, current, placeholder] of [
    ['midi-input', controller.access?.inputs, controller.input, 'On-screen only'],
    ['midi-output', controller.access?.outputs, controller.output, 'Off'],
  ]) {
    $(id).replaceChildren(new Option(placeholder, ''), ...[...(ports?.values() ?? [])]
      .filter(p => p.state === 'connected').map(p => new Option(p.name || 'MIDI device', p.id)));
    $(id).value = current?.id ?? '';
  }
  $('input-status').textContent = controller.input ? 'MIDI CONNECTED' : 'NO MIDI INPUT';
  $('connect-midi').textContent = controller.access ? 'Refresh MIDI' : 'Connect MIDI';
}
function currentGroup() {
  if (!exercise) return null;
  if (transport.waiting) return transport.waiting.group;
  if (transport.mode === 'stop') return exercise.groups[0];
  const tick = Math.max(0, (performance.now() - transport.origin - transport.cycle * transport.duration) / transport.msPerTick);
  return targetGroupAt(exercise.groups, tick, TIMING_TOLERANCE_MS / transport.msPerTick);
}
function updatePads() {
  const group = currentGroup();
  const key = group ? `${group.pitches.join(',')}:${group.notes.map(n => n.part).join(',')}` : '';
  $('target-hint').textContent = transport.waiting ? 'Your turn — play this shape' :
    transport.mode === 'record' && performance.now() < transport.origin ? 'Count-in — get ready' : 'Upcoming target shape';
  if (key === lastPadKey && $('practice-pads').childElementCount) return;
  // Never replace a held button: its release must still reach the original pitch.
  if (pointerNotes.size || pressedKeys.size) return;
  lastPadKey = key;
  $('practice-pads').replaceChildren(...(group?.pitches ?? []).map((pitch, i) => {
    const button = document.createElement('button');
    button.className = 'note-pad';
    button.dataset.pitch = pitch;
    button.setAttribute('aria-label', `Play ${pitchName(pitch)}, MIDI note ${pitch}`);
    const drum = group.notes.some(n => n.pitch === pitch && n.part === 'drums');
    const drumName = { 35: 'Kick', 36: 'Kick', 38: 'Snare', 40: 'Snare', 42: 'Hi-hat', 44: 'Hi-hat', 46: 'Open hat' }[pitch];
    button.innerHTML = `<b>${drum ? drumName ?? 'Drum' : pitchName(pitch)}</b><small>MIDI ${pitch}</small><kbd>${shortcuts[i] ?? '·'}</kbd>`;
    button.addEventListener('pointerdown', e => {
      e.preventDefault();
      button.setPointerCapture(e.pointerId);
      pointerNotes.set(e.pointerId, pitch);
      void playInput(pitch, true);
    });
    const release = e => {
      const held = pointerNotes.get(e.pointerId);
      if (held !== undefined) { pointerNotes.delete(e.pointerId); handleInput(held, false); }
    };
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('lostpointercapture', release);
    button.addEventListener('keydown', e => {
      if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
        e.preventDefault();
        pressedKeys.set(e.code, pitch);
        void playInput(pitch, true);
      }
    });
    button.addEventListener('keyup', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pressedKeys.delete(e.code); handleInput(pitch, false); }
    });
    return button;
  }));
}
async function playInput(pitch, on) {
  try {
    const ready = audio.resume();
    handleInput(pitch, on);
    await ready;
    if (audio.soundfont === null && !audio.preview) notify('Press Play to load your SoundFont, or choose Preview synth to hear the on-screen pads.');
  }
  catch (error) { reportError(error); }
}
function handleInput(pitch, on, velocity = 90, timestamp = performance.now()) {
  if (pitch === null) {
    for (const note of inputNotes.values()) audio.off(note);
    inputNotes.clear();
    transport.held.clear();
    $('received-note').textContent = 'Input port changed. Waiting for a note…';
    $('input-feedback').textContent = 'Match the exact MIDI note numbers shown on the target pads.';
    return;
  }
  if (on && !audio.context) {
    void audio.resume().catch(reportError);
  } else if (on && audio.context.state === 'suspended') {
    void audio.resume().catch(reportError);
  }
  const group = currentGroup();
  const result = transport.input(pitch, on, timestamp);
  if (on && result !== null) {
    const tick = transport.mode === 'record' && result === true ? transport.feedback.targetTick :
      transport.mode === 'step' ? group?.tick ?? transport.position :
        ((timestamp - transport.origin) % transport.duration + transport.duration) % transport.duration / transport.msPerTick;
    notation.feedback(pitch, tick, result === true);
  }
  if (on) {
    $('received-note').textContent = `Received ${pitchName(pitch)} · MIDI ${pitch} · velocity ${velocity}`;
    const feedback = transport.mode === 'record' ? transport.feedback : null;
    const expected = feedback?.expectedPitches.length ? feedback.expectedPitches : group?.pitches ?? [];
    const shape = expected.map(p => `${pitchName(p)} (${p})`).join(' + ');
    $('input-feedback').classList.toggle('input-miss', result === false);
    if (feedback?.reason === 'hit') {
      $('input-feedback').textContent = `Matched · ${Math.round(Math.abs(feedback.offsetMs))} ms ${feedback.offsetMs < 0 ? 'early' : 'late'}`;
    } else if (feedback?.reason === 'timing') {
      $('input-feedback').textContent = `Correct pitch, but ${Math.round(Math.abs(feedback.offsetMs))} ms ${feedback.offsetMs < 0 ? 'early' : 'late'} · required ±${TIMING_TOLERANCE_MS} ms`;
    } else if (feedback?.reason === 'duplicate') {
      $('input-feedback').textContent = 'This note was already matched. Repeated presses count as extra notes.';
    } else if (feedback?.reason === 'count-in') {
      $('input-feedback').textContent = 'Count-in — this press is not scored yet.';
    } else {
      $('input-feedback').textContent = `${expected.includes(pitch) ? 'Pitch is in the target shape' : 'Different pitch'} · target ${shape || 'none'}`;
    }
  }
  if (on && !inputNotes.has(pitch)) {
    const selected = style.sections[Number($('section').value)];
    const source = group?.notes[0] ?? style.notes.find(n => trackIdOf(n) === $('focus').value && selected && n.tick >= selected.start && n.tick < selected.end) ??
      style.notes.find(n => trackIdOf(n) === $('focus').value);
    const note = monitorNote(pitch, velocity, source ? { ...source, part: source.part ?? partOf(source) } : null);
    if (audio.soundfont !== null || audio.preview) {
      inputNotes.set(pitch, note);
      audio.on(note);
    } else {
      $('input-feedback').textContent += ' · No sounds loaded: open Devices & audio to load sounds or choose Preview synth.';
    }
  } else if (!on) {
    const note = inputNotes.get(pitch);
    if (note) audio.off(note);
    inputNotes.delete(pitch);
  }
  for (const pad of $('practice-pads').children) {
    if (Number(pad.dataset.pitch) === pitch) {
      pad.classList.toggle('held', on);
      pad.classList.toggle('incorrect', on && result === false);
    }
  }
}
async function ensureAudio() {
  await libraryReady;
  if (libraryFailure && audio.soundfont === null && !$('preview').checked) throw libraryFailure;
  await audio.resume();
  audio.preview = $('preview').checked;
  if (!$('preview').checked && audio.soundfont === null) {
    await loadLocalFont();
  }
}
async function loadLocalFont() {
  await libraryReady;
  if (libraryFailure) throw libraryFailure;
  if (library.edition === 'public') return await loadStarterFont();
  $('audio-detail').textContent = 'Loading local SoundFont (~340 MiB)…';
  notify('Loading your local JJazzLab SoundFont. The first load may take a few seconds.');
  try {
    const response = await fetch(assetUrl(localFontUrl));
    if (!response.ok) throw new Error(`Local SoundFont could not be loaded (HTTP ${response.status}). Load your own .sf2 or choose Preview synth.`);
    await audio.loadSoundfont(await response.arrayBuffer());
    soundfontName = library.soundfonts[0]?.name ?? 'JJazzLab SoundFont';
    $('preview').checked = false;
    audio.preview = false;
    $('audio-status').textContent = soundfontName;
    $('audio-detail').textContent = 'FluidSynth / WebAssembly · General MIDI';
  } catch (error) {
    $('audio-detail').textContent = 'Local SoundFont load failed — retry or load a .sf2 file.';
    throw error;
  }
}

async function loadStarterFont() {
  const font = library.soundfonts[0];
  if (!font?.sha256 || !font.version) throw new Error('The starter SoundFont catalog is incomplete.');
  const controller = new AbortController();
  soundLoad = controller;
  const { signal } = controller;
  $('cancel-sounds').hidden = false;
  $('sound-progress').hidden = false;
  $('sound-progress').removeAttribute('value');
  let warning = '';
  try {
    let buffer;
    try { buffer = await readSavedSounds(font); }
    catch (error) { console.warn(error); warning = `Browser storage unavailable: ${error.message}. Sounds will work for this session only.`; }
    signal.throwIfAborted();
    if (buffer) {
      try { await validateStarter(buffer, font); }
      catch (error) {
        console.warn(error);
        notify('Saved starter sounds failed validation. Downloading a fresh copy.', true);
        buffer = null;
        savedStarterAvailable = false;
        try { await clearSavedSounds(); }
        catch (storageError) { console.warn(storageError); warning = `Could not remove corrupt saved sounds: ${storageError.message}`; }
      }
    }
    const cached = Boolean(buffer);
    if (!buffer) {
      $('audio-detail').textContent = 'Downloading starter sounds (~31 MiB)…';
      buffer = await downloadSounds(assetUrl(font.url), signal, (bytes, total) => {
        $('sound-progress').max = total || 32319396;
        $('sound-progress').value = bytes;
        $('audio-detail').textContent = `Downloading starter sounds: ${(bytes / 1048576).toFixed(1)} MiB${total ? ` / ${(total / 1048576).toFixed(1)} MiB` : ''}`;
      });
      await validateStarter(buffer, font);
    }
    signal.throwIfAborted();
    $('audio-detail').textContent = 'Starting FluidSynth…';
    await audio.loadSoundfont(buffer);
    soundfontName = font.name;
    audio.preview = false;
    $('preview').checked = false;
    $('audio-status').textContent = soundfontName;
    $('audio-detail').textContent = 'FluidSynth / WebAssembly · General MIDI';
    signal.throwIfAborted();
    if (!cached && !warning) {
      try { await saveSounds(font, buffer); savedStarterAvailable = true; }
      catch (error) { console.warn(error); warning = `Sounds loaded, but could not be saved in this browser: ${error.message}. They will need loading again next visit.`; }
    }
    $('cache-status').textContent = warning || 'Starter sounds saved in this browser. Browser settings or storage cleanup may remove them.';
    starterWarning = warning;
    return warning;
  } catch (error) {
    $('audio-detail').textContent = audio.soundfont !== null ? 'Previously loaded sounds remain ready.' :
      error.name === 'AbortError' ? 'Sound loading cancelled. Retry, load your own .sf2, or choose Preview synth.' :
        'Starter sound loading failed. Retry, load your own .sf2, or choose Preview synth.';
    throw error;
  } finally {
    if (soundLoad === controller) soundLoad = null;
    $('cancel-sounds').hidden = true;
    $('sound-progress').hidden = true;
  }
}

function showSoundSetup(mode) {
  pendingMode = mode;
  $('starter-guide').textContent = `Choose sounds ${mode ? `to begin ${mode.toUpperCase()}` : 'to hear your MIDI controller'}. Load starter sounds (~31 MiB) once and save them in this browser, load your own .sf2, or explicitly choose Preview synth. No files need moving.`;
  if (!$('devices-dialog').open) $('open-devices').click();
  $('load-local-font').focus();
  notify('Choose starter sounds, your own .sf2, or Preview synth to begin.');
}

function resumePendingMode() {
  const mode = pendingMode;
  pendingMode = null;
  if (mode) {
    if ($('devices-dialog').open) $('devices-dialog').close();
    void start(mode);
  }
}

async function loadLibrary() {
  try {
    const response = await fetch(assetUrl('library.json'));
    if (!response.ok) throw new Error(`Local library unavailable (HTTP ${response.status}). Run scripts\\copy-library.ps1 to populate it.`);
    const catalog = await response.json();
    if (!Array.isArray(catalog.styles) || !Array.isArray(catalog.soundfonts)) throw new Error('Invalid local library manifest.');
    if (catalog.edition === 'public' && (!catalog.soundfonts[0]?.version ||
        !/^[a-f0-9]{64}$/i.test(catalog.soundfonts[0]?.sha256) || !catalog.soundfonts[0]?.name)) {
      throw new Error('Invalid starter SoundFont catalog.');
    }
    catalog.soundfonts.forEach(font => assetUrl(font.url));
    catalog.styles.forEach(entry => assetUrl(entry.url));
    library = catalog;
    const groups = new Map();
    library.styles.forEach((entry, index) => {
      if (!groups.has(entry.category)) {
        const group = document.createElement('optgroup');
        group.label = entry.category;
        groups.set(entry.category, group);
      }
      groups.get(entry.category).append(new Option(entry.name, index));
    });
    $('library-style').replaceChildren(new Option('Choose a local style…', ''), ...groups.values());
    if (library.soundfonts.length) localFontUrl = library.soundfonts[0].url;
    const publicEdition = library.edition === 'public';
    $('library-status').textContent = publicEdition ? 'Built-in demo ready. Import your own .sty or MIDI file; no private Yamaha styles are distributed.' : `${library.styles.length} local styles · grouped by category`;
    $('library-style').closest('label').hidden = publicEdition;
    $('load-style').hidden = publicEdition;
    $('starter-setup').hidden = !publicEdition;
    if (publicEdition) {
      soundfontName = 'GeneralUser GS (not loaded)';
      $('audio-status').textContent = soundfontName;
      $('audio-detail').textContent = 'Load starter sounds (~31 MiB), your own .sf2, or choose Preview synth.';
      $('load-local-font').textContent = 'Load starter sounds';
      $('sound-license').href = assetUrl('licenses/GeneralUser-GS-LICENSE.txt');
      $('help-dialog').querySelectorAll('p').forEach(paragraph => {
        if (paragraph.textContent.includes('supplied JJazzLab')) paragraph.textContent = 'Starter audio uses GeneralUser GS (~31 MiB). Load it once and save it in this browser, or select your own licensed SF2. Preview synth is an explicit lightweight alternative, not GM-quality. Imported files stay on your device.';
      });
      try {
        const saved = await readSavedSounds(library.soundfonts[0]);
        savedStarterAvailable = Boolean(saved);
        $('cache-status').textContent = saved ? 'Starter sounds are saved in this browser; they will be validated when loaded.' : 'Starter sounds have not been saved in this browser.';
      } catch (error) {
        console.warn(error);
        $('cache-status').textContent = `Browser storage unavailable: ${error.message}. Starter sounds can still play for this session.`;
      }
    }
    updateTransport();
  } catch (error) {
    libraryFailure = error;
    $('library-status').textContent = 'Local library unavailable';
    reportError(error);
  }
}
async function start(mode) {
  if (busy) return;
  if (!exercise.target.length) { notify('No target notes in this track at the current density. Select another track or section.', true); return; }
  const request = ++startRequest;
  try {
    transport.stop();
    busy = true;
    updateTransport();
    for (const id of ['play', 'step', 'record']) $(id).disabled = true;
    await libraryReady;
    if (libraryFailure && audio.soundfont === null && !$('preview').checked) throw libraryFailure;
    if (request !== startRequest) return;
    if (library.edition === 'public' && audio.soundfont === null && !$('preview').checked && !savedStarterAvailable) {
      busy = false;
      updateTransport();
      showSoundSetup(mode);
      return;
    }
    await ensureAudio();
    if (request !== startRequest) return;
    busy = false;
    const bpm = Number($('bpm').value);
    if (!Number.isFinite(bpm) || bpm < 30 || bpm > 240) throw new Error('Tempo must be between 30 and 240 BPM.');
    // Preserve unlocked layers across transport changes, but require consecutive quiz loops.
    progression.streak = 0;
    $('loop-count').textContent = 'Loop 1';
    updateProgress();
    exercise = makeExercise();
    notation.render(exercise, notationKey());
    updateDensity();
    transport.start(mode, exercise, exercise.playbackBpm);
    const message = mode === 'record' ? 'One-bar count-in, then your turn. Target part muted; play to the steady clock.' :
      mode === 'step' ? 'Play the highlighted pitches. Hold melodic notes together to complete a shape.' : 'Listen closely. The score and controller follow your target notes.';
    notify(`${message}${starterWarning ? ` ${starterWarning}` : ''}`, Boolean(starterWarning));
  } catch (error) { if (error.name === 'AbortError') notify('Sound loading cancelled.'); else reportError(error); }
  finally {
    busy = false;
    for (const id of ['play', 'step', 'record']) $(id).disabled = false;
    updateTransport();
  }
}

for (const mode of ['play', 'step', 'record']) $(mode).addEventListener('click', () => void start(mode));
$('stop').addEventListener('click', () => {
  startRequest++;
  pendingMode = null;
  soundLoad?.abort();
  transport.stop();
  progression.streak = 0;
  updateProgress();
  notify('Stopped. Loop position reset — ready for another round.');
});
$('loop').addEventListener('click', () => {
  transport.setLoop(!transport.loop);
  $('loop').setAttribute('aria-pressed', String(transport.loop));
  $('loop').querySelector('span').textContent = `LOOP: ${transport.loop ? 'ON' : 'OFF'}`;
});
$('solo').addEventListener('change', () => {
  transport.solo = $('solo').checked;
  updateTransport();
  notify(transport.solo ? 'Solo enabled: hear only the target notes in Play/Step. Record keeps the target muted with count-in and metronome.' :
    'Solo disabled: other style tracks return as backing.');
});
$('click').addEventListener('change', () => {
  transport.clickEnabled = $('click').checked;
  notify(transport.clickEnabled ? 'Steady click enabled in all modes; Step pauses it while waiting.' : 'Steady click off. Record still has its one-bar count-in.');
});
$('click-sound').addEventListener('change', () => { audio.clickSound = $('click-sound').value; });
function changeHarmony(next) {
  const previous = randomizedHarmony;
  randomizedHarmony = next;
  try {
    makeExercise();
  } catch (error) {
    randomizedHarmony = previous;
    throw error;
  }
  progression.streak = 0;
  history = [];
  rebuild();
  updateTransport();
}
$('randomize-chords').addEventListener('click', () => {
  if (busy || transport.mode !== 'stop') return;
  try {
    const key = $('harmony-key').value;
    changeHarmony(randomHarmony(key, Number($('bars').value)));
    notify(`New ${key} progression: ${randomizedHarmony.map(chord => chord.name).join(' → ')}. One chord per bar; all pitched parts move together. Full-pattern, normal-speed scores count toward level-up.`);
  } catch (error) { reportError(error); }
});
$('restore-chords').addEventListener('click', () => {
  if (busy || transport.mode !== 'stop') return;
  try { changeHarmony(null); notify('Original style harmony restored. Qualifying streak reset.'); }
  catch (error) { reportError(error); }
});
$('harmony-key').addEventListener('change', () => {
  try {
    changeHarmony(null);
    notify('Harmony key selected. Press Randomize chords to generate a progression in this key.');
  } catch (error) { reportError(error); }
});
for (const id of ['focus', 'bars', 'section', 'bpm']) $(id).addEventListener('change', () => {
  try {
    if (!$('bpm').checkValidity()) throw new Error('Tempo must be between 30 and 240 BPM.');
    if (id === 'bars' || id === 'section') randomizedHarmony = null;
    if (id === 'section') {
      const start = style.sections[Number($('section').value)].start;
      $('bpm').value = Math.round(style.tempos.filter(t => t.tick <= start).at(-1)?.bpm ?? 120);
      updateTracks();
    }
    if (id === 'bars') updatePracticeBars();
    if (id === 'bpm') { progression.streak = 0; history = []; }
    else resetProgress();
    rebuild();
    updateProgress();
  } catch (error) { reportError(error); }
});
for (const id of ['practice-bar', 'practice-speed']) $(id).addEventListener('change', () => {
  try {
    progression.streak = 0;
    history = [];
    rebuild();
    updateProgress();
    notify(exercise.nextSpeed != null ? `Speed ladder selected: three consecutive Record loops at 90% or higher advance from ${exercise.practiceSpeed}% to ${exercise.nextSpeed}%.` :
      exercise.practiceOnly ? 'Practice drill selected. Scores are feedback only; return to the full pattern at normal tempo for level-up.' : 'Full pattern restored. Record three consecutive qualifying loops to advance.');
  } catch (error) { reportError(error); }
});
$('demo').addEventListener('click', () => { setStyle(createDemo()); notify('Demo restored. Welcome back to Midnight Pocket.'); });
$('library-style').addEventListener('change', updateTransport);
$('load-style').addEventListener('click', async () => {
  const entry = library.styles[Number($('library-style').value)];
  if (!entry || busy || transport.mode !== 'stop') return;
  busy = true;
  updateTransport();
  try {
    const response = await fetch(assetUrl(entry.url));
    if (!response.ok) throw new Error(`Style could not be loaded (HTTP ${response.status}): ${entry.name}`);
    const next = parseMidi(await response.arrayBuffer(), `${entry.name}.sty`);
    buildExercise(next);
    setStyle(next);
    notify(`Loaded ${entry.category} / ${entry.name}. Select a practice track and section.`);
  } catch (error) { reportError(error); }
  finally { busy = false; updateTransport(); }
});
$('load-local-font').addEventListener('click', async () => {
  if (busy || transport.mode !== 'stop') return;
  busy = true;
  updateTransport();
  let loaded = false;
  try {
    const warning = await loadLocalFont();
    notify(warning || 'SoundFont loaded. Your band is ready.', Boolean(warning));
    loaded = true;
  } catch (error) {
    if (error.name === 'AbortError') notify('Sound loading cancelled.');
    else reportError(error);
  } finally {
    busy = false;
    updateTransport();
    if (loaded) resumePendingMode();
  }
});
$('cancel-sounds').addEventListener('click', () => {
  pendingMode = null;
  startRequest++;
  soundLoad?.abort();
});
$('clear-sounds').addEventListener('click', async () => {
  busy = true;
  updateTransport();
  try {
    await clearSavedSounds();
    savedStarterAvailable = false;
    $('cache-status').textContent = 'Saved starter sounds removed. Already loaded sounds remain usable until this tab closes.';
    notify('Saved starter sounds removed from this browser.');
  } catch (error) { reportError(error); }
  finally { busy = false; updateTransport(); }
});
$('style-file').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 32 * 1024 * 1024) throw new Error('Choose a MIDI/style file smaller than 32 MiB.');
    const next = parseMidi(await file.arrayBuffer(), file.name);
    // Validate before replacing the currently working exercise.
    buildExercise(next);
    setStyle(next);
    notify(`Loaded ${file.name}. ${next.casm.length ? 'Yamaha source chords and transposition policies loaded' : 'MIDI arrangement with inferred chords'}; fixed practice tempo.`);
  } catch (error) { reportError(error); }
  finally { event.target.value = ''; }
});
$('sf-file').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;
  busy = true;
  let loaded = false;
  updateTransport();
  try {
    notify(`Loading ${file.name} locally…`);
    const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    if (String.fromCharCode(...header.slice(0, 4)) !== 'RIFF' || String.fromCharCode(...header.slice(8, 12)) !== 'sfbk') throw new Error('Choose a valid .sf2 SoundFont file.');
    await audio.loadSoundfont(await file.arrayBuffer());
    soundfontName = file.name;
    starterWarning = '';
    $('preview').checked = false;
    audio.preview = false;
    $('audio-status').textContent = soundfontName;
    $('audio-detail').textContent = 'FluidSynth / WebAssembly · General MIDI';
    notify('SoundFont loaded. Your band is ready.');
    loaded = true;
  } catch (error) { reportError(error); }
  finally { busy = false; event.target.value = ''; updateTransport(); if (loaded) resumePendingMode(); }
});
$('preview').addEventListener('change', () => {
  audio.preview = $('preview').checked;
  $('audio-status').textContent = $('preview').checked ? 'Preview synth (not GM)' : soundfontName;
  $('audio-detail').textContent = $('preview').checked ? 'Lightweight oscillator audio · load SF2 for authentic playback' :
    audio.soundfont !== null ? 'FluidSynth / WebAssembly · General MIDI' : library.edition === 'public' ? 'Load starter sounds or your own .sf2.' : 'Local GM sound · loads on first playback';
  if (audio.preview) resumePendingMode();
});
$('volume').addEventListener('input', e => audio.setVolume(Number(e.target.value) / 100));
async function prepareMidiSounds() {
  await audio.resume();
  await libraryReady;
  if (!controller.input) { notify('MIDI access granted. Connect a device, or use the on-screen keys.'); return; }
  if (audio.soundfont === null && !audio.preview) {
    if (library.edition === 'public') { busy = false; updateTransport(); showSoundSetup(null); return; }
    busy = true;
    updateTransport();
    await ensureAudio();
  }
  notify('MIDI connected. Play any note, even while stopped. Check your LED output port and note layout.');
}
$('connect-midi').addEventListener('click', async () => {
  busy = true;
  updateTransport();
  try {
    await audio.resume();
    await controller.connect();
    await prepareMidiSounds();
  }
  catch (error) { reportError(error); }
  finally { busy = false; updateTransport(); }
});
$('midi-input').addEventListener('change', async e => {
  busy = true;
  updateTransport();
  controller.setInput(e.target.value);
  try { await prepareMidiSounds(); }
  catch (error) { reportError(error); }
  finally { busy = false; updateTransport(); }
});
$('midi-output').addEventListener('change', e => controller.setOutput(e.target.value));
$('test-led').addEventListener('click', async () => {
  $('test-led').disabled = true;
  try {
    await controller.testLight();
    notify('Sent channel-1 LED on/off to your last pad note. If it stayed dark, check LPX MIDI output and use Lighting Custom mode 3/4 or Programmer mode.');
  } catch (error) { reportError(error); }
  finally { updateTransport(); }
});
$('help').addEventListener('click', () => {
  releaseInputs();
  $('help-dialog').showModal();
});
$('close-help').addEventListener('click', () => $('help-dialog').close());
$('help-dialog').addEventListener('keydown', event => {
  if (event.key === 'Escape') { event.preventDefault(); $('help-dialog').close(); }
});
$('help-dialog').addEventListener('close', () => $('help').focus());
for (const [triggerId, dialogId] of [['open-style', 'style-dialog'], ['open-devices', 'devices-dialog']]) {
  const trigger = $(triggerId);
  const dialog = $(dialogId);
  trigger.setAttribute('aria-controls', dialogId);
  trigger.setAttribute('aria-expanded', 'false');
  trigger.addEventListener('click', () => {
    if (dialog.open) { dialog.close(); return; }
    for (const other of document.querySelectorAll('.setup-drawer[open]')) other.close();
    if ($('harmony-popover').matches(':popover-open')) $('harmony-popover').hidePopover();
    releaseInputs();
    dialog.show();
    trigger.setAttribute('aria-expanded', 'true');
    dialog.querySelector('[data-close]').focus();
  });
  dialog.addEventListener('close', () => {
    if (dialogId === 'devices-dialog') pendingMode = null;
    trigger.setAttribute('aria-expanded', 'false');
    if (!document.querySelector('.setup-drawer[open]') && !$('harmony-popover').matches(':popover-open')) trigger.focus();
  });
  dialog.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); dialog.close(); }
  });
}
for (const button of document.querySelectorAll('[data-close]')) {
  button.addEventListener('click', () => $(button.dataset.close).close());
}
$('harmony-popover').addEventListener('beforetoggle', event => {
  if (event.newState === 'open') {
    for (const dialog of document.querySelectorAll('.setup-drawer[open]')) dialog.close();
    releaseInputs();
  }
});
$('harmony-popover').addEventListener('toggle', event => {
  $('open-harmony').setAttribute('aria-expanded', String(event.newState === 'open'));
});
$('show-keys').addEventListener('change', () => {
  releaseInputs();
  $('keys-panel').hidden = !$('show-keys').checked;
});
const updateReadiness = () => {
  const midi = controller.input ? 'MIDI connected' : 'No MIDI input';
  const sound = audio.preview ? 'Preview audio' : audio.soundfont !== null ? 'SF2 ready' : 'SF2 not loaded';
  $('device-summary').textContent = `${midi} · ${sound}`;
  $('open-devices').setAttribute('aria-label', `Devices & audio: ${midi}, ${sound}`);
};
new MutationObserver(updateReadiness).observe($('audio-status'), { childList: true, subtree: true });
new MutationObserver(updateReadiness).observe($('input-status'), { childList: true, subtree: true });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const drawer = document.querySelector('.setup-drawer[open]');
    if (drawer) { e.preventDefault(); drawer.close(); }
    else if ($('harmony-popover').matches(':popover-open')) {
      e.preventDefault();
      $('harmony-popover').hidePopover();
      $('open-harmony').focus();
    }
    return;
  }
  if ($('keys-panel').hidden || e.target.closest('input, select, textarea, dialog, button, a, summary, [popover]') || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
  const i = shortcuts.indexOf(e.key.toLowerCase());
  const pitch = currentGroup()?.pitches[i];
  if (i < 0 || pitch === undefined) return;
  e.preventDefault();
  pressedKeys.set(e.code, pitch);
  void playInput(pitch, true);
});
document.addEventListener('keyup', e => {
  const pitch = pressedKeys.get(e.code);
  if (pitch === undefined) return;
  pressedKeys.delete(e.code);
  handleInput(pitch, false);
});
const releaseInputs = () => {
  for (const pitch of new Set([...pressedKeys.values(), ...pointerNotes.values()])) handleInput(pitch, false);
  pressedKeys.clear();
  pointerNotes.clear();
};
window.addEventListener('blur', releaseInputs);
document.addEventListener('visibilitychange', () => {
  if (document.hidden && transport.mode !== 'stop') {
    releaseInputs();
    transport.stop();
    notify('Playback stopped while the tab was hidden to keep training timing reliable.');
  }
});
window.addEventListener('pagehide', () => transport.stop());
let resizeTimer;
new ResizeObserver(() => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    try { if (exercise) notation.render(exercise, notationKey()); }
    catch (error) { reportError(error); }
  }, 100);
}).observe($('notation'));
function animate() {
  if (exercise) {
    const tick = transport.position;
    const bar = Math.min(exercise.bars, Math.floor(tick / exercise.barTicks) + 1);
    $('measure').textContent = exercise.sourceBar ? `PATTERN BAR ${String(exercise.sourceBar).padStart(2, '0')} · DRILL` :
      `BAR ${String(bar).padStart(2, '0')} / ${String(exercise.bars).padStart(2, '0')}`;
    $('timeline-fill').style.width = `${100 * tick / exercise.durationTicks}%`;
    notation.update(tick, exercise.barTicks);
    const beat = Math.floor(tick / (exercise.ppq * 4 / exercise.meter.denominator)) % exercise.meter.numerator;
    [...$('beat-dots').children].forEach((dot, i) => dot.classList.toggle('active', beat === i && transport.mode !== 'stop'));
    if (transport.mode === 'record' && performance.now() < transport.origin) {
      const remaining = Math.ceil((transport.origin - performance.now()) / transport.beatMs);
      $('mode-description').textContent = `Count-in · ${remaining}`;
      const countBeat = (exercise.meter.numerator - remaining) % exercise.meter.numerator;
      [...$('beat-dots').children].forEach((dot, i) => dot.classList.toggle('active', countBeat === i));
    } else if (transport.mode === 'record') $('mode-description').textContent = `Target muted · ±${TIMING_TOLERANCE_MS} ms timing window`;
    updatePads();
  }
  requestAnimationFrame(animate);
}
setStyle(style);
libraryReady = loadLibrary();
updateDevices();
animate();
