import { Notation } from '../src/notation.js';
import { createDemo } from '../src/midi.js';
import { buildExercise, styleTracks } from '../src/training.js';
import { clearSavedSounds, readSavedSounds, saveSounds, validateStarter } from '../src/soundfont-cache.js';
import { AudioEngine } from '../src/audio.js';
import { Transport } from '../src/transport.js';
import { PianoKeyboard } from '../src/piano.js';
import { forgetLastStyle, forgetStyleFolder, readLastStyle, readStyleFolder, saveLastStyle, saveStyleFolder } from '../src/style-folder.js';

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

export async function verifyContinuousGameplay() {
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
  const directions = [];
  const encouragements = [];
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
        check(['huh.wav', 'yeah.wav'].includes(encouragements.at(-1).file), 'Qualifying loops use huh or yeah');
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
      check(['lets go.wav', 'yeah like that.wav'].includes(encouragements.at(-1).file), 'Achievement phrases contain multiple syllables');
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
    check(encouragements.filter(cue => cue.kind === 'up').every(cue => ['bring it up.wav', 'come on.wav'].includes(cue.file)), 'Speed increases use only the assigned spoken samples');
    check(encouragements.filter(cue => cue.kind === 'down').every(cue => ['drop it back.wav', 'drop it down.wav', 'lay back.wav'].includes(cue.file)), 'Slowdowns use only drop or lay back samples');
    check($('practice-status').textContent.includes('90 BPM'), 'Displayed BPM matches the slowed transport');
    check($('record').getAttribute('aria-pressed') === 'true', 'Record stays active after slowdown');
    for (let i = 0; i < 3; i++) completeLoop(false);
    check(transport.pending?.practiceSpeed === 50, 'Further struggle queues the 50% floor');
    $('stop').click();
    check(transport.mode === 'stop', 'Explicit Stop still ends recording');
    check($('practice-status').textContent.includes('60 BPM'), 'Stopping with a queued change keeps settings and notation in sync');
    check(directions.length === 3, 'Explicit Stop does not play an extra cue');
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
    if (transport) transport.now = () => performance.now();
    if (savedMastery === null) localStorage.removeItem('style-trainer-mastery-v2');
    else localStorage.setItem('style-trainer-mastery-v2', savedMastery);
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
    const option = [...$('library-style').options].find(option => option.textContent === 'FolderTest');
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
    check(![...$('library-style').options].some(option => option.textContent === 'FolderTest'), 'Forget removes folder library entries');
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
      check([...$('library-style').options].some(option => option.textContent === 'FolderTest'), 'Storage failure leaves the folder browsable for this session');
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
    check([...$('library-style').options].some(option => option.textContent === 'FolderTest'), 'Session-only folder fallback populates the same library');
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
  check($('mastery-styles-list').textContent.includes('Bass') && $('mastery-styles-list').textContent.includes('Drums'), 'Family mastery indicators are visible');
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
