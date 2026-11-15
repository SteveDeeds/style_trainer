import { Notation } from '../src/notation.js';
import { createDemo, parseMidi } from '../src/midi.js';
import { initialMasteryState, leafKey, registerStyleCatalog, saveMastery } from '../src/mastery.js';
import { analyzeDifficulty, DIFFICULTY_VERSION } from '../src/difficulty.js';
import { DRUM_NOTATION, drumNotation } from '../src/drum-notation.js';
import { buildExercise, masteryFanfarePitches, styleTracks } from '../src/training.js';
import { clearSavedSounds, readSavedSounds, saveSounds, validateStarter } from '../src/soundfont-cache.js';
import { AudioEngine } from '../src/audio.js';
import { assetUrl, ENCOURAGEMENT_SAMPLES } from '../src/assets.js';
import { Transport } from '../src/transport.js';
import { MidiController } from '../src/controller.js';
import { PianoKeyboard } from '../src/piano.js';
import { forgetLastStyle, forgetStyleAnalysis, forgetStyleFolder, readLastStyle, readStyleFolder, saveLastStyle, saveStyleAnalysis, saveStyleFolder } from '../src/style-folder.js';

export async function verifyMidiInputAudio({ expectSetup = false, blocked = false } = {}) {
  const $ = id => document.getElementById(id);
  const checks = [];
  const check = (condition, message) => {
    if (!condition) throw new Error(message);
    checks.push(message);
  };
  const waitFor = async predicate => {
    const limit = performance.now() + 5000;
    while (!predicate()) {
      if (performance.now() > limit) throw new Error('MIDI audio preparation timed out.');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  };
  const original = {
    resume: AudioEngine.prototype.resume, load: AudioEngine.prototype.loadSoundfont,
    on: AudioEngine.prototype.on, off: AudioEngine.prototype.off,
    output: MidiController.prototype.setOutput, fetch: globalThis.fetch,
  };
  let controller;
  let audio;
  let previousContext;
  let unlock;
  let finishLoad;
  let failNext = false;
  let loads = 0;
  let requests = 0;
  const played = [];
  const released = [];
  MidiController.prototype.setOutput = function() { controller = this; };
  AudioEngine.prototype.resume = function() {
    if (!audio) {
      audio = this;
      previousContext = this.context;
      this.context = { state: blocked ? 'suspended' : 'running' };
      check(this.soundfont === null, 'Test starts with no loaded SoundFont');
    }
    if (blocked && !unlock) return new Promise(resolve => {
      unlock = () => { this.context.state = 'running'; resolve(); };
    });
    if (unlock) unlock();
    return Promise.resolve();
  };
  AudioEngine.prototype.loadSoundfont = async function() {
    loads++;
    if (failNext) throw new Error('Test SoundFont load failed');
    await new Promise(resolve => { finishLoad = resolve; });
    this.soundfont = 1;
  };
  AudioEngine.prototype.on = function(note) { played.push(note); };
  AudioEngine.prototype.off = function(note) { released.push(note); };
  globalThis.fetch = async (...args) => {
    if (/\.sf2(?:[?#]|$)/.test(String(args[0]))) {
      requests++;
      return new Response(new TextEncoder().encode('RIFF0000sfbk'));
    }
    return original.fetch(...args);
  };
  try {
    $('stop').click();
    $('preview').checked = false;
    $('preview').dispatchEvent(new Event('change'));
    $('midi-output').dispatchEvent(new Event('change'));
    check(Boolean(controller), 'Uses the same input callback as a remembered MIDI port');
    controller.onInput(60, true, 90);
    controller.onInput(61, true, 95);
    controller.onInput(60, false);
    check(played.length === 0, 'Notes do not sound before audio is ready');
    if (blocked) {
      check($('notice').textContent.includes('Click or tap'), 'Browser activation requirements are clearly shown');
      check(requests === 0, 'No SoundFont download starts while audio activation is blocked');
      document.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    }
    if (expectSetup) {
      await waitFor(() => $('devices-dialog').open);
      check(requests === 0 && loads === 0, 'Unsaved public starter sounds still require an explicit choice');
      $('preview').checked = true;
      $('preview').dispatchEvent(new Event('change'));
      await waitFor(() => played.length === 1);
      check(played[0].pitch === 61 && requests === 0, 'Explicit Preview synth resumes only the held MIDI note without downloading');
      controller.onInput(61, false);
      return checks;
    }
    await waitFor(() => loads === 1);
    check(requests === 1, 'First MIDI notes automatically request the local SoundFont exactly once');
    finishLoad();
    await waitFor(() => played.length === 1);
    check(played[0].pitch === 61, 'Only the still-held note sounds after loading; released notes are not replayed');
    check($('stop').getAttribute('aria-pressed') === 'true', 'Audio preparation does not start the practice transport');
    controller.onInput(61, false);
    check(released.some(note => note.pitch === 61), 'A held note releases normally after delayed preparation');
    controller.onInput(62, true, 80);
    controller.onInput(62, false);
    check(played.at(-1).pitch === 62 && requests === 1, 'Later notes sound immediately without reloading');

    await waitFor(() => !$('load-local-font').disabled);
    audio.soundfont = null;
    $('load-local-font').click();
    await waitFor(() => loads === 2);
    controller.onInput(63, true, 90);
    await new Promise(resolve => setTimeout(resolve, 30));
    check(loads === 2 && requests === 2, 'Manual loading and MIDI preparation share one in-flight SoundFont load');
    finishLoad();
    await waitFor(() => played.some(note => note.pitch === 63));
    controller.onInput(63, false);
    check(played.filter(note => note.pitch === 63).length === 1, 'A held note is not sounded twice after a shared load');

    await waitFor(() => !$('load-local-font').disabled);
    audio.soundfont = null;
    failNext = true;
    controller.onInput(64, true, 90);
    await waitFor(() => $('notice').getAttribute('role') === 'alert');
    check($('notice').textContent.includes('Test SoundFont load failed'), 'Automatic loading errors are explicit');
    controller.onInput(64, false);
    failNext = false;
    await waitFor(() => !$('load-local-font').disabled);
    controller.onInput(65, true, 90);
    await waitFor(() => loads === 4);
    finishLoad();
    await waitFor(() => played.some(note => note.pitch === 65));
    check(!played.some(note => note.pitch === 64), 'Failed preparation can retry without playing an old released note');
    controller.onInput(65, false);
    return checks;
  } finally {
    if (audio) {
      controller.onInput(null, false);
      audio.soundfont = null;
      audio.context = previousContext;
    }
    $('preview').checked = false;
    if (audio) audio.preview = false;
    $('stop').click();
    if ($('devices-dialog').open) $('devices-dialog').close();
    AudioEngine.prototype.resume = original.resume;
    AudioEngine.prototype.loadSoundfont = original.load;
    AudioEngine.prototype.on = original.on;
    AudioEngine.prototype.off = original.off;
    MidiController.prototype.setOutput = original.output;
    globalThis.fetch = original.fetch;
  }
}

export async function verifySfxSettings() {
  const $ = id => document.getElementById(id);
  const key = 'style-trainer-sfx-type';
  const saved = localStorage.getItem(key);
  const setSfxType = AudioEngine.prototype.setSfxType;
  let audio;
  const checks = [];
  const check = (condition, message) => {
    if (!condition) throw new Error(message);
    checks.push(message);
  };
  AudioEngine.prototype.setSfxType = function(type) {
    audio = this;
    return setSfxType.call(this, type);
  };
  const select = value => {
    $('sfx-type').value = value;
    $('sfx-type').dispatchEvent(new Event('change'));
  };
  try {
    $('stop').click();
    $('open-devices').click();
    check([...$('sfx-type').options].map(option => option.textContent).join(',') === 'Band leader,Video game,None', 'Settings offers all three SFX types');
    select('video-game');
    check(audio.sfxType === 'video-game' && localStorage.getItem(key) === 'video-game', 'Video game selection applies and persists');
    await audio.resume();
    audio.encourage('qualifying');
    check(audio.celebrationVoices.size === 2, 'Video game mode plays synthesized encouragement');
    audio.click(true);
    select('none');
    check(audio.celebrationVoices.size === 0 && audio.clickVoices.size === 1, 'None stops SFX without muting the metronome');
    audio.encourage('advance');
    audio.tempoChange('down');
    check(audio.celebrationVoices.size === 0, 'None suppresses achievement and tempo-change cues');
    select('band-leader');
    await audio.loadEncouragement();
    audio.encourage('qualifying');
    check(ENCOURAGEMENT_SAMPLES.qualifying.includes(audio.lastEncouragement.get('qualifying')), 'Band leader restores spoken samples');
    check(Object.values(ENCOURAGEMENT_SAMPLES).flat().every(file => audio.encouragementBuffers.get(file)?.numberOfChannels === 1), 'Every MP3 decodes successfully as mono audio');
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function(name, value) {
      if (name === key) throw new DOMException('Storage denied', 'SecurityError');
      return setItem.call(this, name, value);
    };
    try {
      select('none');
      check(audio.sfxType === 'none' && $('notice').getAttribute('role') === 'alert' &&
        $('notice').textContent.includes('could not be remembered'), 'Storage failure is reported while the selected mode still works');
    } finally { Storage.prototype.setItem = setItem; }
    return checks;
  } finally {
    if (audio) {
      audio.stopEncouragement();
      setSfxType.call(audio, saved ?? 'band-leader');
      $('sfx-type').value = audio.sfxType;
    }
    AudioEngine.prototype.setSfxType = setSfxType;
    if (saved === null) localStorage.removeItem(key);
    else localStorage.setItem(key, saved);
    $('devices-dialog').close();
  }
}

export async function verifyStyleSnapshotStorage() {
  const previous = await readLastStyle();
  const checks = [];
  const check = (condition, message) => {
    if (!condition) throw new Error(message);
    checks.push(message);
  };
  try {
    const first = createDemo();
    first.name = 'Saved style test';
    await saveLastStyle(first);
    const pitch = first.notes[0].pitch;
    first.notes[0].pitch++;
    const saved = await readLastStyle();
    check(saved.name === 'Saved style test' && saved.notes[0].pitch === pitch, 'Last style is a persisted copy, not a live reference');
    const replacement = createDemo();
    replacement.name = 'Replacement style test';
    await saveLastStyle(replacement);
    check((await readLastStyle()).name === replacement.name, 'Loading a new style replaces the remembered style');
    await forgetLastStyle();
    check(!await readLastStyle(), 'Remembered style can be removed without clearing other browser data');
    const open = indexedDB.open;
    indexedDB.open = () => { throw new DOMException('Storage denied', 'SecurityError'); };
    try {
      let failed = false;
      try { await saveLastStyle(replacement); }
      catch (error) { failed = error.name === 'SecurityError'; }
      check(failed, 'Style storage failures propagate to the caller');
    } finally { indexedDB.open = open; }
    return checks;
  } finally {
    if (previous) await saveLastStyle(previous);
    else await forgetLastStyle();
  }
}

export async function verifyContinuousGameplay({ preserveMastery = false } = {}) {
  const $ = id => document.getElementById(id);
  const checks = [];
  const check = (condition, message) => {
    if (!condition) throw new Error(message);
    checks.push(message);
  };
  const savedMastery = localStorage.getItem('style-trainer-mastery-v2');
  const start = Transport.prototype.start;
  const cue = AudioEngine.prototype.tempoChange;
  const encourage = AudioEngine.prototype.encourage;
  const fanfare = AudioEngine.prototype.masteryFanfare;
  const directions = [];
  const encouragements = [];
  const fanfares = [];
  let audio;
  let transport;
  let now = performance.now();
  Transport.prototype.start = function(...args) {
    transport = this;
    this.now = () => now;
    start.apply(this, args);
    clearInterval(this.timer);
  };
  AudioEngine.prototype.tempoChange = function(direction) {
    directions.push(direction);
    cue.call(this, direction);
  };
  AudioEngine.prototype.encourage = function(kind) {
    encourage.call(this, kind);
    encouragements.push({ kind, file: this.lastEncouragement.get(kind) });
  };
  AudioEngine.prototype.masteryFanfare = function(pitches) {
    audio = this;
    fanfares.push(pitches);
    fanfare.call(this, pitches);
  };
  const advance = time => { now = time; transport.tick(); };
  const completeLoop = (perfect, closeFirst = false) => {
    const score = transport.scores.get(transport.cycle);
    const count = typeof perfect === 'number' ? Math.floor(score.expected.length * perfect) : perfect ? score.expected.length : 0;
    for (const [index, note] of score.expected.slice(0, count).entries()) {
      const offset = closeFirst && index === 0 ? (score.perfectTolerance + score.halfTolerance) / 2 : 0;
      transport.input(note.pitch, true, note.time + transport.latencyMs + offset);
    }
    advance(score.endTime + 1);
    advance(score.endTime + score.halfTolerance + transport.latencyMs + 1);
  };
  const waitForRecord = async () => {
    const limit = performance.now() + 5000;
    while (transport?.mode !== 'record') {
      if (performance.now() > limit) throw new Error('Record did not start.');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  };
  try {
    $('open-devices').click();
    $('preview').checked = true;
    $('preview').dispatchEvent(new Event('change'));
    $('devices-dialog').close();
    $('bpm').value = '120';
    $('bpm').dispatchEvent(new Event('change'));
    $('layers').children[0].click();
    $('practice-speed').value = '50';
    $('practice-speed').dispatchEvent(new Event('change'));
    $('record').click();
    await waitForRecord();
    for (const speed of [75, 100]) {
      if (speed === 75) {
        completeLoop(.85);
        check(encouragements.at(-1)?.kind === 'qualifying', 'A qualifying non-perfect loop plays a short encouragement');
        check(ENCOURAGEMENT_SAMPLES.qualifying.includes(encouragements.at(-1).file), 'Qualifying loops use the expanded short-reaction selection');
        const shortCount = encouragements.length;
        completeLoop(.75);
        check(encouragements.length === shortCount, 'A below-80% loop does not play an achievement sample');
        check($('streak-label').textContent.startsWith('1/3 loops at 80%+'), 'A lower score preserves the first qualifying loop');
        check($('streak').querySelectorAll('.filled.pass').length === 1, 'Qualifying progress dots survive a lower score');
        completeLoop(true, true);
        check(!transport.pending, 'A high average does not replace three individually qualifying loops');
        completeLoop(.75);
        check($('streak-label').textContent.startsWith('2/3 loops at 80%+'), 'Separated successes accumulate toward advancement');
        completeLoop(true);
      } else {
        for (let i = 0; i < 3; i++) completeLoop(true);
      }
      check($('streak').querySelectorAll('.filled.pass').length === 3, 'All three LEDs stay lit until advancement applies');
      check(encouragements.at(-1)?.kind === 'advance', 'The third qualifying loop uses a longer achievement phrase');
      check(ENCOURAGEMENT_SAMPLES.advance.includes(encouragements.at(-1).file), 'Achievement phrases contain multiple syllables');
      check(transport.pending?.practiceSpeed === speed, `${speed}% speed queued after three qualifying loops`);
      completeLoop(true);
      check(transport.exercise.practiceSpeed === speed, `${speed}% speed applied at boundary`);
      check($('streak').querySelectorAll('.filled.pass').length === 0, 'LEDs reset for the new tempo');
      check($('record').getAttribute('aria-pressed') === 'true', 'Record stays active through speed increase');
    }
    for (let i = 0; i < 3; i++) completeLoop(true);
    check(transport.pending?.level === 2, 'Next density queued without stopping');
    check($('streak').querySelectorAll('.filled.pass').length === 3 && encouragements.at(-1)?.kind === 'advance', 'Density level-up lights the third LED and plays a longer phrase');
    completeLoop(true);
    check(transport.exercise.level === 2 && $('level-badge').textContent.includes('LEVEL 2'), 'Notation and density UI follow the new exercise');
    for (let i = 0; i < 3; i++) completeLoop(false);
    check(transport.pending?.practiceSpeed === 75, 'Struggling queues a slower tempo');
    completeLoop(false);
    check(transport.exercise.practiceSpeed === 75 && transport.exercise.level === 2, 'Slowdown preserves unlocked density');
    check(directions.join(',') === 'up,up,down', 'Spoken tempo cues match speed changes, not density changes');
    check(encouragements.some(cue => cue.kind === 'qualifying'), 'Qualifying four-bar patterns play encouragement samples');
    check(encouragements.filter(cue => cue.kind === 'up').every(cue => ENCOURAGEMENT_SAMPLES.up.includes(cue.file)), 'Speed increases use only the assigned spoken samples');
    check(encouragements.filter(cue => cue.kind === 'down').every(cue => ENCOURAGEMENT_SAMPLES.down.includes(cue.file)), 'Slowdowns use only drop or lay back samples');
    check($('practice-status').textContent.includes('90 BPM'), 'Displayed BPM matches the slowed transport');
    check($('record').getAttribute('aria-pressed') === 'true', 'Record stays active after slowdown');
    for (let i = 0; i < 3; i++) completeLoop(false);
    check(transport.pending?.practiceSpeed === 50, 'Further struggle queues the 50% floor');
    $('stop').click();
    check(transport.mode === 'stop', 'Explicit Stop still ends recording');
    check($('practice-status').textContent.includes('60 BPM'), 'Stopping with a queued change keeps settings and notation in sync');
    check(directions.length === 3, 'Explicit Stop does not play an extra cue');

    $('layers').children[0].click();
    $('practice-speed').value = '125';
    $('practice-speed').dispatchEvent(new Event('change'));
    check($('practice-status').textContent.includes('125% bonus speed'), '125% bonus speed can be selected at level 1 without unlocking it');
    $('record').click();
    await waitForRecord();
    check(transport.exercise.playbackBpm === 150 && transport.exercise.level === 1, 'Manual bonus speed plays at 125% of the header tempo');
    $('stop').click();
    $('practice-speed').value = '100';
    $('practice-speed').dispatchEvent(new Event('change'));
    $('harmony-key').value = 'Dm';
    $('harmony-key').dispatchEvent(new Event('change'));
    $('randomize-chords').click();
    $('layers').children[3].click();
    $('record').click();
    await waitForRecord();
    for (let i = 0; i < 3; i++) completeLoop(true);
    check($('layers').children[3].textContent.includes('✓'), 'Mastering level 4 immediately checks its own tile');
    check($('layers').children[3].getAttribute('aria-label').includes('mastered'), 'The level 4 checkmark has an accessible mastered label');
    check($('streak').querySelectorAll('.filled.pass').length === 3, 'Mastery keeps all three LEDs lit until bonus speed applies');
    check(transport.pending?.practiceSpeed === 125 && transport.pending?.level === 4, 'Level 4 mastery queues bonus speed at the same density');
    check(JSON.stringify(fanfares.at(-1)) === JSON.stringify(masteryFanfarePitches('Dm')), 'Mastery fanfare follows the selected minor key');
    check(audio.celebrationVoices.size === 8, 'Mastery plays the special brass fanfare instead of the ordinary phrase');
    const directionsBeforeBonus = directions.length;
    completeLoop(true);
    check(transport.exercise.practiceSpeed === 125 && transport.exercise.playbackBpm === 150, 'Bonus tempo applies at the next boundary');
    check(transport.mode === 'record' && directions.length === directionsBeforeBonus, 'Bonus transition continues recording without replacing the fanfare with an ordinary tempo cue');
    check($('streak').querySelectorAll('.filled.pass').length === 0, 'Bonus speed starts a fresh LED count');
    for (let i = 0; i < 3; i++) completeLoop(true);
    check(transport.exercise.practiceSpeed === 125 && !transport.pending && transport.mode === 'record', 'Further mastery continues looping at the 125% cap');
    for (let i = 0; i < 3; i++) completeLoop(false);
    check(transport.pending?.practiceSpeed === 100, 'Struggling at bonus speed queues a slowdown to 100%');
    completeLoop(false);
    check(transport.exercise.practiceSpeed === 100 && $('layers').children[3].textContent.includes('✓'), 'Slowing from bonus speed preserves the level 4 checkmark');
    $('stop').click();
    check(audio.celebrationVoices.size === 0, 'Explicit Stop cancels all remaining mastery sounds');
    const beforeDrill = encouragements.length;
    $('practice-bar').value = '0';
    $('practice-bar').dispatchEvent(new Event('change'));
    $('record').click();
    await waitForRecord();
    completeLoop(true);
    check(encouragements.length === beforeDrill, 'A perfect one-bar drill does not trigger four-bar encouragement');
    $('stop').click();
    return checks;
  } finally {
    $('stop').click();
    Transport.prototype.start = start;
    AudioEngine.prototype.tempoChange = cue;
    AudioEngine.prototype.encourage = encourage;
    AudioEngine.prototype.masteryFanfare = fanfare;
    if (transport) transport.now = () => performance.now();
    if (!preserveMastery) {
      if (savedMastery === null) localStorage.removeItem('style-trainer-mastery-v2');
      else localStorage.setItem('style-trainer-mastery-v2', savedMastery);
    }
  }
}

export async function verifyEarlyLoopHit({ close = false } = {}) {
  const $ = id => document.getElementById(id);
  const start = Transport.prototype.start;
  const input = Transport.prototype.input;
  let transport;
  let now = performance.now();
  Transport.prototype.start = function(...args) {
    transport = this;
    this.now = () => now;
    start.apply(this, args);
    clearInterval(this.timer);
  };
  Transport.prototype.input = function(pitch, on) { return input.call(this, pitch, on, now); };
  try {
    $('open-devices').click();
    $('preview').checked = true;
    $('preview').dispatchEvent(new Event('change'));
    $('devices-dialog').close();
    $('record').click();
    const limit = performance.now() + 5000;
    while (transport?.mode !== 'record') {
      if (performance.now() > limit) throw new Error('Record did not start.');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    const next = transport.scores.get(1);
    const first = next.expected[0];
    if (first.time !== next.startTime) throw new Error('This check needs a downbeat target.');
    const offset = close ? (next.perfectTolerance + next.halfTolerance) / 2 : next.perfectTolerance / 2;
    now = next.startTime - offset + transport.latencyMs;
    transport.tick();
    const pad = [...$('practice-pads').children].find(pad => Number(pad.dataset.pitch) === first.pitch);
    if (!pad) throw new Error('The first target pad is unavailable.');
    pad.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter' }));
    pad.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter' }));
    if (!first.hit || first.credit !== (close ? .5 : 1)) throw new Error('Early downbeat was not credited to the next loop.');
    now = next.startTime + transport.latencyMs + 1;
    transport.tick();
    const head = $('notation').querySelector(`[aria-label="Play MIDI note ${first.pitch}"]`);
    if (!head || getComputedStyle(head).fill !== (close ? 'rgb(36, 121, 201)' : 'rgb(0, 141, 66)')) {
      throw new Error('Early downbeat lost its correct-note highlight at the loop boundary.');
    }
    return [close ? 'Close downbeat earns half credit and stays blue across the loop boundary' :
      'Perfect downbeat earns full credit and stays green across the loop boundary'];
  } finally {
    $('stop').click();
    Transport.prototype.start = start;
    Transport.prototype.input = input;
    if (transport) transport.now = () => performance.now();
  }
}

const masteryLoadingMidi = new Uint8Array([
  77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 1, 224,
  77, 84, 114, 107, 0, 0, 0, 13,
  0, 144, 60, 100, 131, 96, 128, 60, 0, 0, 255, 47, 0,
]);

// Seed an isolated browser profile, then reload before running the loading checks.
export async function prepareMasteryStyleLoading() {
  const fixture = parseMidi(masteryLoadingMidi.buffer, 'MasteryLoad.mid');
  const track = styleTracks(fixture)[0];
  const leaf = {
    sectionIndex: 0, sectionName: fixture.sections[0].name,
    trackId: track.id, trackName: track.name, family: track.part, maxLevel: 4,
  };
  const state = initialMasteryState();
  const detailed = registerStyleCatalog(state, { styleName: fixture.name, leaves: [leaf] });
  detailed.progress[leafKey(leaf)] = { highestLevel: 3, bestScore: 95, bestBpm: 120 };
  for (const name of ['MasteryLoad', 'Shared', 'MissingSource', 'Broken']) {
    state.styles[name] = { bestScore: 95 };
  }
  state.styles[createDemo().name] = { category: 'Demo Style', bestScore: 95 };
  const response = await fetch(assetUrl('library.json'));
  if (!response.ok) throw new Error(`Could not read the test style library (HTTP ${response.status}).`);
  const builtin = (await response.json()).styles[0];
  if (builtin) state.styles[builtin.name] = { category: builtin.category, bestScore: 95 };
  if (!saveMastery(state)) throw new Error('Could not seed mastery loading tests.');
  await saveLastStyle(createDemo());
}

export async function verifyMasteryStyleLoading() {
  const $ = id => document.getElementById(id);
  const checks = [];
  const check = (condition, message) => {
    if (!condition) throw new Error(`Mastery loading: ${message}`);
    checks.push(message);
  };
  const until = async predicate => {
    const limit = performance.now() + 5000;
    while (!predicate()) {
      if (performance.now() > limit) throw new Error('Mastery loading check timed out.');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  };
  const card = name => {
    const item = [...$('mastery-styles-list').children]
      .find(item => item.querySelector('.style-item-title').firstChild.textContent === name);
    if (!item) throw new Error(`Mastery style is missing: ${name}`);
    item.open = true;
    return item;
  };
  const button = name => card(name).querySelector('.mastery-load-style');
  const builtinName = $('library-style').options[1]?.dataset.styleName;
  const files = new DataTransfer();
  for (const path of ['MasteryLoad.mid', 'A/Shared.mid', 'B/Shared.mid', 'Broken.mid']) {
    const file = new File([path === 'Broken.mid' ? new Uint8Array([0]) : masteryLoadingMidi], path.split('/').at(-1));
    Object.defineProperty(file, 'webkitRelativePath', { value: path });
    files.items.add(file);
  }
  const originalFiles = [...files.files];
  $('style-folder-files').files = files.files;
  $('style-folder-files').dispatchEvent(new Event('change'));
  await until(() => $('folder-status').textContent.includes('session only'));
  $('open-mastery').click();
  check(button('MissingSource').disabled && card('MissingSource').textContent.includes('Source unavailable'), 'Missing files are explicitly unavailable');
  const choice = card('Shared').querySelector('select');
  check(choice.options.length === 3 && choice.value === '' && button('Shared').disabled, 'Duplicate names require an explicit source choice');
  choice.value = '1';
  choice.dispatchEvent(new Event('change'));
  check(!button('Shared').disabled, 'Choosing a duplicate source enables loading');

  const getFile = File.prototype.arrayBuffer;
  let release;
  File.prototype.arrayBuffer = function() {
    if (this.name !== 'MasteryLoad.mid') return getFile.call(this);
    return new Promise(resolve => { release = () => resolve(getFile.call(this)); });
  };
  try {
    button('MasteryLoad').click();
    check($('mastery-dialog').open && button('MasteryLoad').disabled && button('Shared').disabled && choice.disabled, 'Loading keeps the showcase open and gates all style actions');
    check($('style-name').textContent === 'Midnight Pocket', 'Pending loading preserves the existing exercise');
    release();
    await until(() => !$('mastery-dialog').open);
  } finally { File.prototype.arrayBuffer = getFile; }
  check($('style-name').textContent === 'MasteryLoad', 'Style Mastery loads the selected file');
  check($('stop').getAttribute('aria-pressed') === 'true', 'Style loading does not start playback');
  check($('level-badge').textContent.startsWith('LEVEL 3'), 'Loading resumes saved density progress');
  await until(() => !$('open-style-folder').disabled);
  const savedLimit = performance.now() + 5000;
  while ((await readLastStyle())?.name !== 'MasteryLoad') {
    if (performance.now() > savedLimit) throw new Error('Loaded style was not remembered.');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  check((await readLastStyle()).name === 'MasteryLoad', 'Loaded styles are remembered for the next visit');
  $('open-mastery').click();
  const notation = $('notation').querySelector('svg').getAttribute('aria-label');
  button('MasteryLoad').click();
  check(!$('mastery-dialog').open && $('notation').querySelector('svg').getAttribute('aria-label') === notation, 'Returning to the current style does not rebuild or reset it');
  $('open-mastery').click();
  button('Broken').click();
  await until(() => $('notice').getAttribute('role') === 'alert' && !$('open-style-folder').disabled);
  check($('mastery-dialog').open && $('style-name').textContent === 'MasteryLoad', 'Failed loading reports the error and preserves the current style and showcase');
  check(button('Broken').disabled, 'Broken sources are excluded from further mastery loading');
  const shared = card('Shared').querySelector('select');
  shared.value = '1';
  shared.dispatchEvent(new Event('change'));
  button('Shared').click();
  await until(() => !$('mastery-dialog').open);
  check($('style-name').textContent === 'Shared', 'The explicitly chosen duplicate source loads');
  $('open-mastery').click();
  button('Midnight Pocket').click();
  check($('style-name').textContent === 'Midnight Pocket' && !$('mastery-dialog').open, 'The built-in demo can be restored from mastery without a file');
  if (builtinName) {
    $('open-mastery').click();
    button(builtinName).click();
    await until(() => !$('mastery-dialog').open);
    check($('style-name').textContent === builtinName && $('stop').getAttribute('aria-pressed') === 'true', 'Published library styles load directly from mastery without autoplay');
    $('open-mastery').click();
    button('Midnight Pocket').click();
  }
  $('preview').checked = true;
  $('preview').dispatchEvent(new Event('change'));
  $('play').click();
  await until(() => $('play').getAttribute('aria-pressed') === 'true');
  $('open-mastery').click();
  check([...document.querySelectorAll('.mastery-load-style')].every(control => control.disabled) &&
    card('Shared').querySelector('select').disabled, 'Playback gates mastery loading and source selection');
  $('stop').click();
  check(!button('MasteryLoad').disabled && !card('Shared').querySelector('select').disabled, 'Stopping re-enables available styles without reopening the showcase');
  const replacement = new DataTransfer();
  replacement.items.add(new File([masteryLoadingMidi], 'Replacement.mid'));
  $('style-folder-files').files = replacement.files;
  $('style-folder-files').dispatchEvent(new Event('change'));
  await until(() => button('MasteryLoad').disabled);
  check(card('MasteryLoad').textContent.includes('Source unavailable'), 'Losing a source refreshes an already-open showcase');
  const reconnected = new DataTransfer();
  originalFiles.forEach(file => reconnected.items.add(file));
  $('style-folder-files').files = reconnected.files;
  $('style-folder-files').dispatchEvent(new Event('change'));
  await until(() => !button('MasteryLoad').disabled);
  check(!card('Shared').querySelector('select').disabled, 'Reconnecting sources refreshes loading actions in the open showcase');
  $('mastery-dialog').close();
  return checks;
}

function browserStyleBytes(bpm, numerator) {
  const microseconds = Math.round(60000000 / bpm);
  const body = [
    0, 255, 81, 3, microseconds >> 16 & 255, microseconds >> 8 & 255, microseconds & 255,
    0, 255, 88, 4, numerator, 2, 24, 8,
    ...masteryLoadingMidi.slice(22),
  ];
  return new Uint8Array([...masteryLoadingMidi.slice(0, 18), 0, 0, 0, body.length, ...body]);
}

export async function prepareStyleBrowserCache() {
  const bytes = browserStyleBytes(70, 4);
  const profile = analyzeDifficulty(parseMidi(bytes.buffer, 'Cached Ballad.mid'));
  profile.sections[0].tracks[0].details.push('Persistent cache reused');
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.buffer))]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
  await saveStyleAnalysis(`${DIFFICULTY_VERSION}:${hash}:Cached Ballad.mid`, profile);
  const oldBytes = browserStyleBytes(100, 4);
  const oldHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', oldBytes.buffer))]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
  const stale = analyzeDifficulty(parseMidi(oldBytes.buffer, 'Walking Groove.mid'));
  stale.sections[0].tracks[0].details.push('Obsolete rating version');
  await saveStyleAnalysis(`${DIFFICULTY_VERSION - 1}:${oldHash}:Walking Groove.mid`, stale);
  await saveLastStyle(createDemo());
}

export async function cleanupStyleBrowserCache() {
  for (const [bpm, name, version] of [
    [70, 'Cached Ballad.mid', DIFFICULTY_VERSION],
    [100, 'Walking Groove.mid', DIFFICULTY_VERSION - 1],
  ]) {
    const bytes = browserStyleBytes(bpm, 4);
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.buffer))]
      .map(byte => byte.toString(16).padStart(2, '0')).join('');
    await forgetStyleAnalysis(`${version}:${hash}:${name}`);
  }
}

export async function verifyStyleBrowserCache() {
  const $ = id => document.getElementById(id);
  const checks = [];
  const check = (condition, message) => {
    if (!condition) throw new Error(`Style browser: ${message}`);
    checks.push(message);
  };
  const until = async predicate => {
    const limit = performance.now() + 10000;
    while (!predicate()) {
      if (performance.now() > limit) throw new Error('Style browser check timed out.');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  };
  const files = new DataTransfer();
  const add = (name, bpm, meter, path) => {
    const file = new File([browserStyleBytes(bpm, meter)], name);
    Object.defineProperty(file, 'webkitRelativePath', { value: path });
    files.items.add(file);
  };
  add('Cached Ballad.mid', 70, 4, 'Pop/Cached Ballad.mid');
  add('Quick Waltz.mid', 140, 3, 'Jazz/Quick Waltz.mid');
  add('Walking Groove.mid', 100, 4, 'Jazz/Walking Groove.mid');
  $('preview').checked = true;
  $('preview').dispatchEvent(new Event('change'));
  $('open-style').click();
  $('style-folder-files').files = files.files;
  $('style-folder-files').dispatchEvent(new Event('change'));
  await until(() => [...$('style-results').children].some(row =>
    row.textContent.includes('Cached Ballad') && row.dataset.ready === 'true'));
  await until(() => [...$('style-results').children].some(row =>
    row.textContent.includes('Walking Groove') && row.dataset.ready === 'true'));
  const search = value => {
    $('style-search').value = value;
    $('style-search').dispatchEvent(new Event('input'));
  };
  search('cached ballad');
  check($('style-results').children.length === 1, 'Search matches style names');
  $('style-results').children[0].click();
  await until(() => $('library-difficulty').textContent.includes('Persistent cache reused'));
  check(true, 'Versioned analysis from a previous visit is reused rather than recalculated');
  const toggle = (id, value) => [...$(id).children].find(button => button.dataset.value === value).click();
  search('');
  toggle('style-folder-filters', 'Folder · Jazz');
  check($('style-results').children.length === 2, 'Folder buttons filter results');
  toggle('style-tempo-filters', 'andante');
  check($('style-results').children.length === 1 && $('style-results').textContent.includes('Walking Groove'), 'Folder and tempo filters combine');
  toggle('style-tempo-filters', 'allegro');
  check($('style-results').children.length === 2, 'Multiple tempo toggles match either range');
  toggle('style-meter-filters', '3/4');
  check($('style-results').children.length === 1 && $('style-results').textContent.includes('Quick Waltz'), 'Meter filters use source metadata');
  toggle('style-level-filters', '2');
  check($('style-results').textContent.includes('No styles match'), 'Difficulty filters show an explicit empty result');
  $('style-reset-filters').click();
  search('folder jazz');
  $('style-sort').value = 'tempo';
  $('style-sort').dispatchEvent(new Event('change'));
  check($('style-results').children[0].textContent.includes('Walking Groove'), 'Tempo sorting uses numeric BPM');
  $('style-results').children[0].click();
  await until(() => $('library-difficulty').querySelector('h3')?.textContent.includes('Walking Groove'));
  check(!$('library-difficulty').textContent.includes('Obsolete rating version'), 'Changed rating rules ignore older cache versions');
  check([...$('style-tempo-filters').children].every(button => button.textContent.includes('BPM')), 'Tempo buttons display their numeric bands');
  const bounds = $('style-dialog').getBoundingClientRect();
  check(bounds.width > Math.min(innerWidth - 40, 700) && !$('stop').closest('[inert]'), 'Expanded chooser covers the workspace without making Stop inert');
  $('style-dialog').close();
  $('open-style').click();
  search('cached ballad');
  $('style-results').children[0].click();
  await until(() => $('library-difficulty').textContent.includes('Persistent cache reused'));
  check(true, 'Reopening the chooser keeps cached ratings');
  const changed = new DataTransfer();
  const file = new File([browserStyleBytes(100, 4)], 'Cached Ballad.mid');
  Object.defineProperty(file, 'webkitRelativePath', { value: 'Pop/Cached Ballad.mid' });
  changed.items.add(file);
  $('style-folder-files').files = changed.files;
  $('style-folder-files').dispatchEvent(new Event('change'));
  await until(() => $('style-results').children[0]?.dataset.ready === 'true' &&
    $('style-results').children[0].textContent.includes('100 BPM'));
  $('style-results').children[0].click();
  await until(() => $('library-difficulty').querySelector('h3')?.textContent.includes('Cached Ballad'));
  check(!$('library-difficulty').textContent.includes('Persistent cache reused'), 'Changing source bytes invalidates a previous analysis cache');
  $('style-reset-filters').click();
  search('cached ballad');
  $('style-results').children[0].click();
  await until(() => !$('load-style').disabled);
  const previousRecent = localStorage.getItem('style-trainer-recent-styles-v1');
  $('style-recent').click();
  check($('style-recent').getAttribute('aria-pressed') === 'true' &&
    localStorage.getItem('style-trainer-recent-styles-v1') === previousRecent,
  'Recent is a toggle and previewing does not modify load history');
  $('style-recent').click();
  $('load-style').click();
  await until(() => $('style-name').textContent === 'Cached Ballad' && !$('open-style-folder').disabled);
  $('style-recent').click();
  check($('style-results').textContent.includes('Cached Ballad') && $('style-result-count').textContent.startsWith('1 of'),
    'Loading a style adds it to Recent and combines with search');
  check(JSON.parse(localStorage.getItem('style-trainer-recent-styles-v1')).some(key => key.includes('Cached Ballad')),
    'Recent load history is persisted');
  $('style-reset-filters').click();
  check($('style-recent').getAttribute('aria-pressed') === 'false', 'Clear filters resets Recent');
  $('style-dialog').close();
  return checks;
}

export async function prepareDifficultyUI() {
  const style = createDemo();
  style.name = 'Difficulty UI';
  style.sections = [
    { name: 'Main Easy', start: 0, end: 1920 },
    { name: 'Main Medium', start: 1920, end: 3840 },
    { name: 'Silent', start: 3840, end: 5760 },
  ];
  style.notes = [];
  const add = (start, gap, channel, program) => {
    for (let tick = start; tick < start + 1920; tick += gap) {
      style.notes.push({ tick, pitch: channel === 9 ? 36 : 60, duration: 1,
        channel, track: channel, trackName: '', program, bank: 0, velocity: 90 });
    }
  };
  add(0, 240, 1, 33);
  add(0, 240, 2, 0);
  add(1920, 120, 2, 0);
  add(1920, 240, 9, 0);
  style.maxTick = 5760;
  await saveLastStyle(style);
}

export async function verifyDifficultyUI() {
  const $ = id => document.getElementById(id);
  const checks = [];
  const check = (condition, message) => {
    if (!condition) throw new Error(`Difficulty UI: ${message}`);
    checks.push(message);
  };
  const until = async predicate => {
    const limit = performance.now() + 10000;
    while (!predicate()) {
      if (performance.now() > limit) throw new Error('Difficulty UI check timed out.');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  };
  const change = (id, value) => {
    $(id).value = value;
    $(id).dispatchEvent(new Event('change'));
  };
  check($('style-difficulty').textContent === 'Medium', 'Overall style uses the hardest section');
  check($('section').options[0].textContent.includes('Easy') &&
    $('section').options[1].textContent.includes('Medium'), 'Section selector shows section difficulty');
  check($('section').options[2].disabled && $('section').options[2].textContent.includes('N/A'), 'Entirely silent sections are explicit and disabled');
  check($('focus').options.length === 2 && ![...$('focus').options].some(option => option.textContent.includes('Drums') || option.textContent.includes('silent')), 'Silent tracks are omitted rather than tagged');
  change('focus', '2:2');
  change('section', '1');
  check($('focus').value === '2:2', 'Section changes preserve a still-playable track');
  check($('focus').options.length === 2 && ![...$('focus').options].some(option => option.textContent.includes('Bass')), 'New section hides the previously playable bass');
  check($('track-difficulty').textContent.includes('Medium') && $('track-difficulty').textContent.includes('96 BPM'), 'Track difficulty includes original-tempo context');
  change('section', '0');
  change('focus', '1:1');
  change('section', '1');
  check($('focus').value === '2:2', 'A track that becomes silent falls back to a playable track');
  change('practice-speed', '50');
  check($('style-difficulty').textContent === 'Medium' && $('focus').selectedOptions[0].textContent.includes('Medium'), 'Practice speed does not change source difficulty');
  $('preview').checked = true;
  $('preview').dispatchEvent(new Event('change'));
  $('open-style').click();
  check($('library-difficulty').querySelector('h3').textContent.includes('Medium'), 'Choose your style shows current style difficulty');
  const details = [...$('library-difficulty').querySelectorAll('details')];
  check(details.length === 3 && details[1].textContent.includes('Chord: Medium') &&
    details[1].querySelectorAll('.difficulty-track').length === 2, 'Chooser breaks down sections, grouped parts and playable tracks');
  const files = new DataTransfer();
  files.items.add(new File([masteryLoadingMidi], 'DifficultyFile.mid'));
  files.items.add(new File([new Uint8Array([0])], 'InvalidDifficulty.mid'));
  $('style-folder-files').files = files.files;
  $('style-folder-files').dispatchEvent(new Event('change'));
  await until(() => [...$('library-style').options].some(option =>
    option.dataset.styleName === 'DifficultyFile' && option.textContent.includes('Easy')));
  await until(() => [...$('library-style').options].some(option =>
    option.dataset.styleName === 'InvalidDifficulty' && option.textContent.includes('Difficulty unavailable')));
  check($('style-name').textContent === 'Difficulty UI' && $('stop').getAttribute('aria-pressed') === 'true', 'Library rating does not replace the style or start playback');
  const option = [...$('library-style').options].find(option => option.dataset.styleName === 'DifficultyFile');
  change('library-style', option.value);
  await until(() => $('library-difficulty').querySelector('h3')?.textContent.includes('DifficultyFile'));
  check($('library-difficulty').textContent.includes('BPM'), 'Selecting a local file exposes track explanations');
  check(!$('style-excluded').hidden && $('style-excluded-list').textContent.includes('InvalidDifficulty') &&
    ![...$('style-results').children].some(row => row.textContent.includes('InvalidDifficulty')),
  'Broken sources are excluded from playable results with explicit error details');
  $('style-dialog').close();
  return checks;
}

export async function verifyStyleFolderUI() {
  const $ = id => document.getElementById(id);
  const until = async predicate => {
    const limit = performance.now() + 10000;
    while (!predicate()) {
      if (performance.now() > limit) throw new Error('Folder UI check timed out.');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  };
  const checks = [];
  const check = (condition, message) => {
    if (!condition) throw new Error(message);
    checks.push(message);
  };
  const previous = await readStyleFolder();
  const picker = window.showDirectoryPicker;
  const root = await navigator.storage.getDirectory();
  const folder = await root.getDirectoryHandle('style-trainer-browser-test', { create: true });
  try {
    const pop = await folder.getDirectoryHandle('Pop', { create: true });
    const file = await pop.getFileHandle('FolderTest.mid', { create: true });
    const writer = await file.createWritable();
    await writer.write(new Uint8Array([
      77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 1, 224,
      77, 84, 114, 107, 0, 0, 0, 13,
      0, 144, 60, 100, 131, 96, 128, 60, 0, 0, 255, 47, 0,
    ]));
    await writer.close();
    window.showDirectoryPicker = async options => {
      check(options.mode === 'read', 'Folder picker requests read-only access');
      return folder;
    };
    $('open-devices').click();
    $('preview').checked = true;
    $('preview').dispatchEvent(new Event('change'));
    $('devices-dialog').close();
    $('open-style').click();
    $('open-style-folder').click();
    await until(() => $('folder-status').textContent.includes('1 styles'));
    const stored = await readStyleFolder();
    check(await stored.isSameEntry(folder), 'Folder handle survives IndexedDB structured cloning');
    const option = [...$('library-style').options].find(option => option.dataset.styleName === 'FolderTest');
    check(option?.parentElement.label === 'Folder · Pop', 'Folder entries appear grouped by subfolder');
    const before = $('style-name').textContent;
    $('library-style').value = option.value;
    $('library-style').dispatchEvent(new Event('change'));
    await until(() => $('notice').textContent.includes('Previewing FolderTest'));
    check($('style-name').textContent === before, 'Folder selection previews without replacing the practice style');
    $('load-style').click();
    await until(() => $('style-name').textContent === 'FolderTest');
    check($('stop').getAttribute('aria-pressed') === 'true', 'Loading a folder style leaves practice stopped');
    $('forget-style-folder').click();
    await until(() => $('folder-status').textContent.includes('Folder forgotten'));
    check(!await readStyleFolder(), 'Forget removes the persisted handle');
    check($('style-name').textContent === 'FolderTest', 'Forget preserves the loaded exercise');
    check(![...$('library-style').options].some(option => option.dataset.styleName === 'FolderTest'), 'Forget removes folder library entries');
    check(await pop.getFileHandle('FolderTest.mid'), 'Forget does not delete local files');
    window.showDirectoryPicker = async () => { throw new DOMException('Cancelled', 'AbortError'); };
    $('open-style-folder').click();
    await until(() => $('notice').textContent.includes('Folder selection cancelled'));
    check($('style-name').textContent === 'FolderTest', 'Cancelled picker preserves the exercise');
    window.showDirectoryPicker = async () => folder;
    const open = indexedDB.open;
    indexedDB.open = () => { throw new DOMException('Storage denied', 'SecurityError'); };
    try {
      $('open-style-folder').click();
      await until(() => $('folder-status').textContent.includes('could not be remembered'));
      check([...$('library-style').options].some(option => option.dataset.styleName === 'FolderTest'), 'Storage failure leaves the folder browsable for this session');
      check($('notice').getAttribute('role') === 'alert', 'Storage failure is explicitly reported');
    } finally { indexedDB.open = open; }
    $('forget-style-folder').click();
    await until(() => $('folder-status').textContent.includes('Folder forgotten'));
    window.showDirectoryPicker = undefined;
    const files = new DataTransfer();
    files.items.add(await file.getFile());
    $('style-folder-files').files = files.files;
    $('style-folder-files').dispatchEvent(new Event('change'));
    await until(() => $('folder-status').textContent.includes('session only'));
    check([...$('library-style').options].some(option => option.dataset.styleName === 'FolderTest'), 'Session-only folder fallback populates the same library');
    check(!await readStyleFolder(), 'Session-only fallback does not claim to persist files');
    $('style-dialog').close();
    return checks;
  } finally {
    $('stop').click();
    window.showDirectoryPicker = picker;
    if (previous) await saveStyleFolder(previous);
    else await forgetStyleFolder();
    await root.removeEntry('style-trainer-browser-test', { recursive: true });
  }
}

// Run on a fresh dev page; captures audio calls without needing MIDI hardware.
export async function verifyPreviews() {
  const $ = id => document.getElementById(id);
  const waitFor = async predicate => {
    const until = performance.now() + 15000;
    while (!predicate()) {
      if (performance.now() > until) throw new Error('Preview check timed out.');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  };
  const checks = [];
  const check = (condition, message) => {
    if (!condition) throw new Error(message);
    checks.push(message);
  };
  const on = AudioEngine.prototype.on;
  const off = AudioEngine.prototype.off;
  const played = [];
  const released = [];
  AudioEngine.prototype.on = function(note) { played.push(note); };
  AudioEngine.prototype.off = function(note) { released.push(note); };
  try {
    $('open-devices').click();
    $('preview').checked = true;
    $('preview').dispatchEvent(new Event('change'));
    $('devices-dialog').close();
    const before = $('notation').querySelector('svg').getAttribute('aria-label');
    $('open-style').click();
    $('demo').click();
    await waitFor(() => played.length > 0);
    check($('notice').textContent.includes('C → G → Am → F'), 'Style preview uses the requested pop progression');
    check($('stop').getAttribute('aria-pressed') === 'true', 'Style preview does not start practice transport');
    check($('notation').querySelector('svg').getAttribute('aria-label') === before, 'Style preview preserves exercise harmony');
    await waitFor(() => $('notice').textContent.startsWith('Preview ended:'));
    const completed = played.length;
    await new Promise(resolve => setTimeout(resolve, 300));
    check(played.length === completed, 'Style preview ends after four bars instead of looping');
    $('demo').click();
    await waitFor(() => played.length > completed);
    $('style-dialog').close();
    const count = played.length;
    await new Promise(resolve => setTimeout(resolve, 300));
    check(played.length === count && released.length > 0, 'Closing the style menu releases and cancels preview notes');
    played.length = 0;
    const head = $('notation').querySelector('.vf-notehead[role="button"]');
    const pitch = Number(head.getAttribute('aria-label').split(' ').at(-1));
    head.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await waitFor(() => played.length > 0);
    check(played[0].pitch === pitch && played[0].part === undefined && played[0].channel === 15, 'Click auditions the sounding bass pitch rather than its octave-up written pitch');
    check($('stop').getAttribute('aria-pressed') === 'true', 'Clicking notation does not start or score practice');
    played.length = 0;
    head.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await waitFor(() => played.length > 0);
    check(played[0].pitch === pitch, 'Keyboard activation auditions the same note');
    $('stop').click();
    for (const part of ['Piano', 'Drums']) {
      const option = [...$('focus').options].find(option => option.textContent.startsWith(part));
      $('focus').value = option.value;
      $('focus').dispatchEvent(new Event('change'));
      played.length = 0;
      const note = $('notation').querySelector('.vf-notehead[role="button"]');
      note.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await waitFor(() => played.length > 0);
      check(played.length === 1, `${part} notehead plays one note, not the entire chord or beat`);
      check(played[0].channel === (part === 'Drums' ? 9 : 15), `${part} audition uses the correct melodic/percussion channel`);
      $('stop').click();
    }
    return checks;
  } finally {
    $('stop').click();
    AudioEngine.prototype.on = on;
    AudioEngine.prototype.off = off;
  }
}

// Use a disposable browser profile: this deliberately replaces its starter cache.
export async function verifySavedSounds() {
  const buffer = new TextEncoder().encode('RIFF0000sfbk1234').buffer;
  const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
  const font = { version: 'test', sha256 };
  try {
    await clearSavedSounds();
    if (await readSavedSounds(font)) throw new Error('Saved sounds were not cleared.');
    await saveSounds(font, buffer);
    const saved = await readSavedSounds(font);
    await validateStarter(saved, font);
    if (await readSavedSounds({ ...font, version: 'changed' })) throw new Error('Cache version was ignored.');
    await saveSounds(font, new ArrayBuffer(12));
    let corrupt = false;
    try { await validateStarter(await readSavedSounds(font), font); } catch { corrupt = true; }
    if (!corrupt) throw new Error('Corrupt cached audio was accepted.');
    return ['clear', 'save/read', 'integrity', 'version isolation', 'corrupt rejection'];
  } finally { await clearSavedSounds(); }
}

export async function verifyPublicUI() {
  const $ = id => document.getElementById(id);
  const waitFor = async predicate => {
    const limit = performance.now() + 5000;
    while (!predicate()) {
      if (performance.now() > limit) throw new Error('Public UI check timed out.');
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  };
  const checks = [];
  const check = (condition, message) => {
    if (!condition) throw new Error(`Public UI regression: ${message}`);
    checks.push(message);
  };
  await waitFor(() => !$('starter-setup').hidden);
  check($('library-style').closest('label').hidden && $('load-style').hidden, 'Public library intentionally excludes private styles');
  check($('style-dialog').querySelector('a[href="https://www.jjazzlab.org/en/resources/"]'), 'Style resources page is linked without mirroring files');
  check(!$('preview').checked, 'Preview is opt-in');
  $('play').click();
  await waitFor(() => $('devices-dialog').open);
  check($('stop').getAttribute('aria-pressed') === 'true', 'First Play waits for a sound choice');
  $('stop').click();
  $('preview').checked = true;
  $('preview').dispatchEvent(new Event('change'));
  check($('stop').getAttribute('aria-pressed') === 'true', 'Stop cancels deferred transport start');
  $('play').click();
  await waitFor(() => $('play').getAttribute('aria-pressed') === 'true');
  check($('device-summary').textContent.includes('Preview'), 'Explicit Preview plays with honest readiness');
  $('stop').click();
  $('preview').checked = false;
  $('preview').dispatchEvent(new Event('change'));
  $('devices-dialog').close();
  return checks;
}

export async function verifyNotationLayout() {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;height:400px;overflow:auto';
  document.body.append(host);
  let checks = 0;
  const check = (condition, message) => {
    if (!condition) throw new Error(`Notation regression: ${message}`);
    checks++;
  };
  try {
    const style = createDemo();
    for (const width of [360, 1200]) for (const bars of [1, 4, 8]) for (const track of styleTracks(style)) {
      host.style.width = `${width}px`;
      const exercise = buildExercise(style, { bars, trackId: track.id, level: 4 });
      const notation = new Notation(host);
      notation.render(exercise, 'C');
      notation.positions.forEach((position, bar) => {
        const previous = notation.positions[bar - 1];
        if (previous && previous.y === position.y) position.staves.forEach((stave, i) => {
          const before = previous.staves[i];
          check(Math.abs(before.getX() + before.getWidth() - stave.getX()) < 1e-7, 'Adjacent staff lines meet');
        });
        for (const [fraction, x] of position.anchors) {
          if (fraction === 1) continue;
          notation.update((bar + fraction) * exercise.barTicks, exercise.barTicks);
          check(Math.abs(Number(notation.cursor.getAttribute('x')) - x) < 1e-7, 'Playhead aligns with engraved attacks/rests');
          check(Number(notation.cursor.getAttribute('y')) === position.y, 'Playhead follows the correct row');
        }
      });
      notation.feedback(61, exercise.barTicks / 2, false);
      check(notation.feedbackMarks.length === 1, 'Wrong-note overlay still renders');
      const head = notation.feedbackMarks[0].querySelector('.vf-notehead path').getBBox();
      check(Math.abs(head.x - notation.positionX(notation.positions[0], .5)) < 2, 'Wrong-note head follows the playhead timing map');
      notation.clearFeedback();
      check(notation.feedbackMarks.length === 0, 'Wrong-note overlay clears');
    }
    return checks;
  } finally {
    host.remove();
  }
}

// Run on a fresh dev-server page; this smoke test changes practice settings.
export async function verifyPianoKeyboard() {
  const $ = id => document.getElementById(id);
  const checks = [];
  const check = (condition, message) => {
    if (!condition) throw new Error(`Piano regression: ${message}`);
    checks.push(message);
  };
  const until = async predicate => {
    const deadline = performance.now() + 15000;
    while (!predicate()) {
      if (performance.now() > deadline) throw new Error('Piano UI check timed out.');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  };
  const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const highlighted = () => [...$('piano-keyboard').querySelectorAll('.target')].map(key => Number(key.dataset.pitch)).sort((a, b) => a - b);
  const pads = () => [...$('practice-pads').children].map(key => Number(key.dataset.pitch)).sort((a, b) => a - b);
  const matches = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  const change = (id, value) => {
    $(id).value = value;
    $(id).dispatchEvent(new Event('change'));
  };
  const on = AudioEngine.prototype.on;
  const off = AudioEngine.prototype.off;
  const played = [];
  AudioEngine.prototype.on = function(note) { played.push(note); };
  AudioEngine.prototype.off = () => {};
  try {
    $('stop').click();
    check($('piano-keyboard').querySelectorAll('.piano-key').length === 88, 'All 88 keys are rendered');
    check($('piano-keyboard').querySelectorAll('.white').length === 52 &&
      $('piano-keyboard').querySelectorAll('.black').length === 36, 'Piano has 52 white and 36 black keys');
    check(!$('piano-keyboard').querySelector('button, [tabindex], [role="button"]'), 'Piano has no playable or focusable keys');
    $('piano-keyboard').querySelector('[data-pitch="60"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    check(!played.length, 'Clicking the piano never plays audio');
    $('open-devices').click();
    $('preview').checked = true;
    $('preview').dispatchEvent(new Event('change'));
    $('devices-dialog').close();
    const pianoTrack = [...$('focus').options].find(option => option.textContent.startsWith('Piano'));
    change('focus', pianoTrack.value);
    $('layers').lastElementChild.click();
    $('show-keys').checked = true;
    $('show-keys').dispatchEvent(new Event('change'));
    await settle();
    const first = pads();
    check(first.length > 1 && matches(highlighted(), first), 'Stopped piano shows the full first target chord');
    $('step').click();
    await until(() => $('mode-description').textContent.startsWith('Waiting'));
    await settle();
    check(matches(highlighted(), first), 'Step waits with every chord pitch highlighted');
    const buttons = [...$('practice-pads').children];
    const shortcuts = 'asdfghjklqwertyui';
    for (const index of buttons.keys()) {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: shortcuts[index], code: `Key${shortcuts[index].toUpperCase()}`, bubbles: true }));
      if (index < buttons.length - 1) {
        await settle();
        check(matches(highlighted(), first), 'Partially completed Step chord remains fully highlighted');
      }
    }
    await settle();
    check($('piano-keyboard').querySelectorAll('.held').length === first.length, 'Held pad input appears on the piano');
    buttons.forEach((button, index) => document.body.dispatchEvent(new KeyboardEvent('keyup', {
      key: shortcuts[index], code: `Key${shortcuts[index].toUpperCase()}`, bubbles: true,
    })));
    await until(() => played.some(note => note.isTarget));
    $('stop').click();
    await settle();
    check(!$('piano-keyboard').querySelector('.held') && matches(highlighted(), first), 'Stop clears input and restores the first shape');
    played.length = 0;
    $('play').click();
    await until(() => played.some(note => note.isTarget));
    await settle();
    check(matches(highlighted(), first), 'Play highlights sounding target pitches, not backing notes');
    $('stop').click();
    played.length = 0;
    $('record').click();
    await until(() => $('record').getAttribute('aria-pressed') === 'true');
    await settle();
    check(matches(highlighted(), first), 'Record count-in shows the first shape');
    await until(() => played.length > 0);
    await settle();
    check(!played.some(note => note.isTarget) && matches(highlighted(), first), 'Record shows target pitches while target audio is muted');
    $('stop').click();
    const container = document.createElement('div');
    const status = document.createElement('p');
    status.id = 'piano-test-status';
    const piano = new PianoKeyboard(container, status);
    piano.update([21, 61, 108, 109], [61, 64]);
    check(container.querySelector('[data-pitch="61"]').classList.contains('target') &&
      container.querySelector('[data-pitch="61"]').classList.contains('held'), 'Black keys can show target and held state together');
    check(status.textContent.includes('Outside piano range: C#8'), 'Out-of-range notes are explicitly named');
    piano.update([], []);
    check(!container.querySelector('.target, .held'), 'Empty state removes every highlight');
    const bounds = $('piano-keyboard').getBoundingClientRect();
    check(bounds.width > 0 && bounds.right <= innerWidth &&
      document.documentElement.scrollWidth <= innerWidth, 'Full keyboard fits without page-level horizontal overflow');
    return checks;
  } finally {
    $('stop').click();
    AudioEngine.prototype.on = on;
    AudioEngine.prototype.off = off;
    $('show-keys').checked = false;
    $('show-keys').dispatchEvent(new Event('change'));
  }
}

export async function verifyUI() {
  const $ = id => document.getElementById(id);
  const results = [];
  const check = (condition, message) => {
    if (!condition) throw new Error(`UI regression: ${message}`);
    results.push(message);
  };
  const change = (id, value) => {
    $(id).value = value;
    $(id).dispatchEvent(new Event('change', { bubbles: true }));
  };
  const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  check($('stop').getAttribute('aria-pressed') === 'true', 'Start with transport stopped');
  const ids = [...document.querySelectorAll('[id]')].map(node => node.id);
  check(new Set(ids).size === ids.length, 'Every control has a unique ID');
  check($('keys-panel').hidden, 'On-screen keys are hidden initially');
  const before = $('notation').querySelector('svg').getAttribute('aria-label');
  for (const [trigger, dialog] of [['open-style', 'style-dialog'], ['open-devices', 'devices-dialog']]) {
    $(trigger).click();
    check($(dialog).open, `${dialog} opens`);
    check(!$('stop').matches(':disabled') && !$('stop').closest('[inert]'), 'Stop remains usable with setup open');
    $(dialog).querySelector('[data-close]').click();
    await settle();
    check(document.activeElement === $(trigger), `${dialog} restores trigger focus`);
    check($('notation').querySelector('svg').getAttribute('aria-label') === before, 'Setup disclosure preserves the exercise');
  }
  $('open-mastery').click();
  check($('mastery-dialog').open, 'Mastery showcase opens');
  check($('mastery-tab-styles').getAttribute('aria-selected') === 'true', 'Style Mastery is the default tab');
  check(!$('mastery-panel-styles').hidden && $('mastery-panel-trophies').hidden, 'Only the selected mastery panel is exposed');
  check($('mastery-styles-list').querySelector('.mastery-style-item'), 'Current style appears in the mastery hierarchy');
  check($('mastery-styles-list').querySelector('.mastery-section-item'), 'Playable sections appear beneath the current style');
  check($('mastery-styles-list').querySelector('.mastery-track'), 'Playable instruments appear beneath sections');
  const returnToPractice = $('mastery-styles-list').querySelector('.mastery-style-item[open] .mastery-load-style');
  check(returnToPractice?.textContent === 'Return to practice' && !returnToPractice.disabled, 'Current style offers a stopped, non-resetting return to practice');
  const partLabels = [...$('mastery-styles-list').querySelectorAll('.mastery-style-item[open] .mastery-family-row .mastery-pill')]
    .map(pill => pill.textContent);
  check(partLabels.length === 5 && ['Rhythm', 'Bass', 'Chord', 'Pad', 'Phrase'].every(label =>
    partLabels.some(text => text.includes(label))), 'All five Yamaha style-part mastery indicators are visible');
  if (innerWidth >= 900) check($('mastery-dialog').getBoundingClientRect().width >= 700, 'Mastery uses a dedicated wide surface');
  $('mastery-tab-trophies').click();
  check($('mastery-tab-trophies').getAttribute('aria-selected') === 'true' && !$('mastery-panel-trophies').hidden, 'Trophy Case tab switches panels');
  $('mastery-tab-trophies').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  check($('mastery-tab-styles').getAttribute('aria-selected') === 'true' && document.activeElement === $('mastery-tab-styles'), 'Arrow keys switch and focus mastery tabs');
  $('mastery-dialog').querySelector('[data-close]').click();
  await settle();
  check(document.activeElement === $('open-mastery'), 'Mastery showcase restores trigger focus');
  check($('notation').querySelector('svg').getAttribute('aria-label') === before, 'Mastery showcase preserves the exercise');
  $('show-keys').checked = true;
  $('show-keys').dispatchEvent(new Event('change'));
  check(!$('keys-panel').hidden && $('practice-pads').children.length > 0, 'Keys toggle reveals playable pads');
  $('show-keys').checked = false;
  $('show-keys').dispatchEvent(new Event('change'));
  check($('keys-panel').hidden, 'Keys toggle hides pads');
  $('open-harmony').click();
  await settle();
  check($('harmony-popover').matches(':popover-open'), 'Chord progression popover opens');
  $('randomize-chords').click();
  check($('open-harmony').textContent.includes('Randomized'), 'Harmony trigger reflects randomization');
  check($('harmony-summary').textContent.includes('7'), 'Harmony summary shows generated seventh chords');
  $('restore-chords').click();
  check($('open-harmony').textContent === 'Chord progression: Original', 'Restore updates chord progression summary');
  $('harmony-popover').hidePopover();
  await settle();
  $('open-harmony').click();
  await settle();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await settle();
  check(!$('harmony-popover').matches(':popover-open') && document.activeElement === $('open-harmony'), 'Escape closes harmony and restores focus');
  $('open-devices').click();
  $('stop').focus();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await settle();
  check(!$('devices-dialog').open, 'Escape closes setup even after focus moves to transport');
  change('practice-speed', '50');
  check($('practice-status').textContent.includes('speed-up to 75%'), '50% shows speed-up eligibility');
  change('practice-bar', '0');
  check($('practice-status').textContent.includes('Practice only'), 'Single-bar drill shows practice-only status');
  change('practice-bar', '');
  change('practice-speed', '100');
  check($('practice-status').textContent.includes('eligible for level-up'), 'Full-speed full-pattern level eligibility is restored');
  check(document.documentElement.scrollWidth <= innerWidth, 'No body-level horizontal overflow');
  if (innerWidth >= 1300 && innerHeight >= 768) {
    const score = $('notation').getBoundingClientRect();
    check(score.top <= 260, 'Laptop notation starts within 260 pixels');
    check(score.top + 180 < document.querySelector('.transport-shell').getBoundingClientRect().top, 'First notation row fits above transport');
  }
  return results;
}

export async function verifyDrumLevels() {
  const style = createDemo();
  const notes = [
    [0, 36], [720, 36], [960, 36], [480, 37], [1440, 37],
    ...Array.from({ length: 8 }, (_, index) => [index * 240, 42]),
  ];
  style.notes = notes.map(([tick, pitch]) => ({
    tick, pitch, duration: 60, track: 9, channel: 9, program: 0, bank: 0, velocity: 90,
  }));
  style.sections = [{ name: 'Main A', start: 0, end: 1920 }];
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:-10000px;width:1000px';
  document.body.append(host);
  try {
    const notation = new Notation(host);
    const counts = [];
    for (let level = 1; level <= 4; level++) {
      const exercise = buildExercise(style, { trackId: '9:9', bars: 4, level });
      notation.render(exercise, 'C');
      counts.push(exercise.target.length);
      const hats = exercise.target.filter(note => note.pitch === 42);
      if (level === 3 && hats.some(note => note.tick % 480 !== 0)) throw new Error('Level 3 contains offbeat hi-hats.');
      if (level === 3 && hats.length !== 16) throw new Error('Level 3 must preserve all four on-beat hi-hats per bar.');
      if (level === 4 && hats.length !== 32) throw new Error('Level 4 must restore all offbeat hi-hats.');
      if (!host.querySelector('svg')) throw new Error('Drum level failed to render.');
    }
    return { counts, checks: ['All drum levels render', 'Level 3 keeps only pulse hats', 'Level 4 restores the full source pattern'] };
  } finally { host.remove(); }
}

export async function verifyDrumNotation() {
  const checks = [];
  const check = (condition, message) => {
    if (!condition) throw new Error(`Drum notation: ${message}`);
    checks.push(message);
  };
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:-10000px;top:0;width:1000px';
  document.body.append(host);
  try {
    const pitches = Object.keys(DRUM_NOTATION).map(Number);
    pitches.push(87);
    const style = createDemo();
    style.notes = pitches.map((pitch, index) => ({
      pitch, tick: index * 240, duration: 200, track: 9, channel: 9,
      program: 0, bank: 0, velocity: 90, trackName: '',
    }));
    style.sections = [{ name: 'Drum map', start: 0, end: Math.ceil(pitches.length / 8) * 1920 }];
    const played = [];
    const notation = new Notation(host);
    notation.onAudition = source => played.push(source.pitch);
    const exercise = buildExercise(style, { bars: 8, level: 4, trackId: '9:9' });
    const original = structuredClone(exercise);
    notation.render(exercise, 'C');
    check(host.querySelectorAll('.drum-key-item').length === pitches.length, 'Visual key covers every used GM/kit-specific drum');
    check(host.querySelector('.drum-key').textContent.includes('Side stick / cross-stick') &&
      host.querySelector('.drum-key').textContent.includes('Unmapped percussion'), 'Legend explicitly names cross-stick and unmapped sounds');
    const heads = [...host.querySelectorAll('.vf-notehead[role="button"]')];
    for (const pitch of pitches) {
      const head = heads.find(head => head.getAttribute('aria-label').endsWith(`MIDI note ${pitch}`));
      check(Boolean(head), `MIDI ${pitch} has an accessible, named notehead`);
      head.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      check(played.at(-1) === pitch, `Audition preserves MIDI ${pitch}`);
    }

    const entry = notation.feedbackEntries.find(entry => entry.pitches.includes(37));
    check(entry.note.getKeys()[entry.pitches.indexOf(37)] === 'c/5/x2', 'Rendered side stick uses an X on the snare space');
    const snare = notation.feedbackEntries.find(entry => entry.pitches.includes(38));
    check(snare.note.getKeys()[snare.pitches.indexOf(38)] === 'c/5', 'Rendered acoustic snare retains an oval');
    notation.feedback(37, entry.sources[0].tick, true, .5);
    check(entry.note.getSVGElement().querySelector('.vf-notehead').getAttribute('data-timing') === 'close', 'New cross-stick head retains close timing feedback');
    notation.clearFeedback();
    notation.feedback(53, 0, false);
    check(notation.feedbackMarks.length === 1, 'Unexpected drum feedback renders the mapped ride bell');
    check(JSON.stringify(exercise) === JSON.stringify(original), 'Drum mapping never changes exercise pitches, timing or scoring data');
    check(drumNotation(44).key === 'd/4/x2', 'Pedal hi-hat uses an X below the staff');
    return checks;
  } finally { host.remove(); }
}
