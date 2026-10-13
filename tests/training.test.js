import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemo, parseMidi } from '../src/midi.js';
import { buildExercise, buildStylePreview, groupNotes, inferChord, initialHarmony, inputFeedback, LAYERS, LoopScore, medianTimingOffset, practiceExercise, Progression, randomHarmony, styleTracks, targetGroupAt, trackIdOf } from '../src/training.js';
import { Transport } from '../src/transport.js';
import { MidiController, preferredMidiPort } from '../src/controller.js';
import { AudioEngine, monitorNote } from '../src/audio.js';
import { loadMastery, saveMastery, recordLoopToMastery, recordAdvancementToMastery, evaluateTrophies, TROPHIES } from '../src/mastery.js';

test('style preview uses four full-density bars of C G Am F with untransposed drums', () => {
  const style = createDemo();
  const preview = buildStylePreview(style);
  assert.deepEqual(preview.chords, ['C', 'G', 'Am', 'F']);
  assert.equal(preview.bars, 4);
  assert.equal(preview.durationTicks, 4 * preview.barTicks);
  assert.equal(preview.level, 4);
  const original = buildExercise(style, { bars: 4, focus: 'full', level: 4 });
  assert.equal(preview.target.length, original.target.length);
  assert.deepEqual(preview.target.filter(note => note.part === 'drums'), original.target.filter(note => note.part === 'drums'));
  assert.ok(preview.target.some((note, index) => note.part !== 'drums' && note.pitch !== original.target[index].pitch));
});

test('loaded Yamaha styles start with a C-major progression while MIDI keeps source harmony', () => {
  const samples = [0, 1 / 7, 2 / 7, 3 / 7];
  const styleHarmony = initialHarmony({ sourceType: 'style' }, 4, () => samples.shift());
  assert.deepEqual(styleHarmony.map(chord => chord.name), ['Cmaj7', 'Dm7', 'Em7', 'Fmaj7']);
  assert.equal(initialHarmony({ sourceType: 'midi' }, 4, () => 0), null);
});

test('style preview prefers Main A even when an intro comes first', () => {
  const style = createDemo();
  style.sections.unshift({ name: 'Intro A', start: 0, end: style.ppq });
  assert.equal(buildStylePreview(style).target.length, buildExercise(style, { section: 1, level: 4 }).target.length);
});

test('live input uses one selected instrument for correct and incorrect pitches with piano fallback', () => {
  const source = { part: 'bass', program: 33 };
  assert.equal(monitorNote(36, 80, source).program, 33);
  assert.equal(monitorNote(61, 80, source).program, 33);
  assert.equal(monitorNote(61, 80, source).channel, 15);
  assert.equal(monitorNote(61, 80).program, 0);
  assert.equal(monitorNote(61, 80, { program: NaN }).program, 0);
  assert.equal(monitorNote(61, 80, { program: 128 }).program, 0);
  assert.deepEqual(monitorNote(31, 100, { part: 'drums', program: 16 }), {
    pitch: 31, velocity: 100, channel: 9, program: 16, bank: 0,
  });
});

test('loaded audio monitors any MIDI note without transport playback', () => {
  const messages = [];
  const audio = new AudioEngine();
  audio.context = {};
  audio.soundfont = 7;
  audio.synth = {
    midiProgramSelect: (...args) => messages.push(['program', ...args]),
    midiNoteOn: (...args) => messages.push(['on', ...args]),
    midiNoteOff: (...args) => messages.push(['off', ...args]),
  };
  const note = monitorNote(61, 80, { part: 'bass', program: 33 });
  audio.on(note);
  audio.off(note);
  assert.deepEqual(messages, [['program', 15, 7, 0, 33], ['on', 15, 61, 80], ['off', 15, 61]]);
});

test('RTR pitch bends use an isolated synth channel and fail explicitly when channels are exhausted', () => {
  const messages = [];
  const audio = new AudioEngine();
  audio.context = { currentTime: 0 };
  audio.soundfont = 7;
  audio.synth = {
    midiProgramSelect: (...args) => messages.push(['program', ...args]),
    midiPitchWheelSensitivity: (...args) => messages.push(['sensitivity', ...args]),
    midiNoteOn: (...args) => messages.push(['on', ...args]),
    midiNoteOff: (...args) => messages.push(['off', ...args]),
    midiPitchBend: (...args) => messages.push(['bend', ...args]),
    midiAllSoundsOff: () => {},
  };
  const note = { pitch: 60, velocity: 90, channel: 3, program: 0, pitchChanges: [{ action: 'pitch', pitch: 65 }] };
  audio.on(note, 1);
  const channel = messages.find(message => message[0] === 'on')[1];
  assert.notEqual(channel, note.channel);
  audio.retune(note, 65, 1);
  audio.off(note, 1);
  assert.ok(messages.some(message => message[0] === 'bend' && message[1] === channel && message[2] !== 8192));
  assert.ok(messages.some(message => message[0] === 'off' && message[1] === channel && message[2] === 60));

  const busy = new AudioEngine();
  busy.context = { currentTime: 0 };
  busy.soundfont = 7;
  busy.synth = audio.synth;
  for (let id = 0; id < 14; id++) busy.on({ ...note, channel: 15 }, id);
  assert.throws(() => busy.on({ ...note, channel: 15 }, 14), /all melodic channels are occupied/);
  busy.silence();
});

test('ordinary polyphonic notes share their source channel without exhausting CASM channels', () => {
  const messages = [];
  const audio = new AudioEngine();
  audio.context = { currentTime: 0 };
  audio.soundfont = 7;
  audio.synth = {
    midiProgramSelect: (...args) => messages.push(['program', ...args]),
    midiNoteOn: (...args) => messages.push(['on', ...args]),
    midiNoteOff: (...args) => messages.push(['off', ...args]),
    midiAllSoundsOff: () => {},
  };
  for (let pitch = 48; pitch < 63; pitch++) {
    audio.on({ pitch, velocity: 90, channel: 3, program: 0 });
  }
  assert.deepEqual(messages.filter(([type]) => type === 'on').map(([, channel]) => channel), Array(15).fill(3));
  audio.silence();
});

test('transport dispatches sustained CASM pitch changes without retriggering', () => {
  let now = 0;
  const calls = [];
  const transport = new Transport({
    now: () => now,
    noteOn: (note, id) => calls.push(['on', note.pitch, id]),
    noteOff: (note, id) => calls.push(['off', note.pitch, id]),
    retune: (note, pitch, id) => calls.push(['pitch', note.pitch, pitch, id]),
    silence: () => {},
    guide: () => {},
    onState: () => {},
    onResult: () => {},
    onLoop: () => {},
    onError: error => { throw error; },
  });
  const exercise = {
    backing: [], target: [{ tick: 0, duration: 500, pitch: 69, velocity: 90, channel: 3,
      pitchChanges: [{ tick: 384, action: 'pitch', pitch: 65 }] }],
    ppq: 96, durationTicks: 768, meter: { numerator: 4, denominator: 4 }, groups: [],
  };
  transport.start('play', exercise, 120);
  clearInterval(transport.timer);
  now = transport.origin;
  transport.tick();
  now = transport.origin + 384 * transport.msPerTick;
  transport.tick();
  assert.deepEqual(calls.map(call => call[0]), ['on', 'pitch']);
  assert.deepEqual(calls[1].slice(1, 3), [69, 65]);
  transport.stop();
});

test('Launchpad port selection prefers MIDI second interface over DAW and ignores disconnected ports', () => {
  const ports = [
    { id: 'daw', name: 'Launchpad X DAW', state: 'connected' },
    { id: 'one', name: 'Launchpad X', state: 'connected' },
    { id: 'two', name: 'MIDIIN2 (Launchpad X)', state: 'connected' },
  ];
  assert.equal(preferredMidiPort(ports).id, 'two');
  ports[2].state = 'disconnected';
  assert.equal(preferredMidiPort(ports).id, 'one');
  assert.equal(preferredMidiPort([]), undefined);
});
test('LED test requires an input note and sends native channel-one on/off to that note', async () => {
  const messages = [];
  const controller = new MidiController(() => {}, () => {}, error => { throw error; });
  await assert.rejects(controller.testLight(), /output/);
  controller.output = { state: 'connected', send: message => messages.push(message) };
  await assert.rejects(controller.testLight(), /Press a Launchpad pad/);
  controller.lastInputPitch = 36;
  await controller.testLight();
  assert.deepEqual(messages, [[0x90, 36, 60], [0x80, 36, 0]]);
});
import { buildNotationVoice, Notation, notationStaves, planNotationRhythm, prepareNotationBars, writtenPitch } from '../src/notation.js';

test('playhead follows engraved note spacing and changes rows at bar boundaries', () => {
  const attributes = {};
  const notation = new Notation({ scrollTop: 0, clientHeight: 400 });
  notation.cursor = { setAttribute: (name, value) => { attributes[name] = value; } };
  notation.positions = [
    { anchors: [[0, 80], [.25, 120], [.5, 220], [1, 300]], y: 32, height: 94 },
    { anchors: [[0, 330], [.5, 410], [1, 500]], y: 32, height: 94 },
    { anchors: [[0, 80], [.5, 180], [1, 300]], y: 500, height: 94 },
  ];
  for (const [tick, x, y] of [[0, 80, 32], [96, 120, 32], [144, 170, 32],
    [192, 220, 32], [383, 300 - 80 / 192, 32], [384, 330, 32],
    [576, 410, 32], [768, 80, 500]]) {
    notation.update(tick, 384);
    assert.ok(Math.abs(attributes.x - x) < 1e-9);
    assert.equal(attributes.y, y);
  }
  assert.equal(notation.element.scrollTop, 484);
});

test('practice tracks distinguish channels in format-0 styles and never offer full style', () => {
  const style = createDemo();
  style.notes.forEach(note => { note.track = 0; });
  const tracks = styleTracks(style);
  assert.equal(tracks.length, 3);
  assert.deepEqual(tracks.map(track => track.id), ['0:1', '0:2', '0:9']);
  assert.ok(tracks.every(track => track.name.includes(`Ch ${track.channel + 1}`)));
  assert.deepEqual(tracks.map(track => track.part), ['bass', 'chords', 'drums']);
});
test('random harmony generates major/minor/diminished chords in major and natural minor keys', () => {
  for (const key of ['C', 'Am', 'F#', 'Bb', 'Cb']) {
    let index = 0;
    const chords = randomHarmony(key, 8, () => (index++ % 7) / 7);
    assert.equal(chords.length, 8);
    assert.ok(chords.every(chord => chord.intervals[0] === 0));
    assert.ok(chords.slice(1).every((chord, i) => chord.root !== chords[i].root));
  }
  assert.equal(randomHarmony('C', 1, () => 1 / 7)[0].name, 'Dm7');
  assert.equal(randomHarmony('C', 1, () => 6 / 7)[0].name, 'Bm7b5');
  assert.equal(randomHarmony('Am', 1, () => 1 / 7)[0].name, 'Bm7b5');
  assert.throws(() => randomHarmony('Unknown', 4), /known/);
  assert.throws(() => randomHarmony('C', 4, () => 1), /Random source/);
});
test('randomization changes pitched tracks together before density filtering and leaves drums/source intact', () => {
  const style = createDemo();
  const before = structuredClone(style);
  const harmony = randomHarmony('C', 4, () => 1 / 7);
  const original = buildExercise(style, { trackId: '1:1', level: 4 });
  const changed = buildExercise(style, { trackId: '1:1', level: 4, harmony });
  const combined = exercise => [...exercise.target, ...exercise.backing].sort((a, b) => a.tick - b.tick || a.track - b.track || a.pitch - b.pitch);
  const withoutPitch = exercise => combined(exercise).map(({ pitch, ...note }) => note);
  assert.deepEqual(withoutPitch(changed), withoutPitch(original));
  assert.deepEqual(changed.backing.filter(note => note.part === 'drums'), original.backing.filter(note => note.part === 'drums'));
  assert.deepEqual(changed.chords, harmony.map(chord => chord.name));
  assert.notDeepEqual(changed.target.map(note => note.pitch), original.target.map(note => note.pitch));
  const scale = [0, 2, 4, 5, 7, 9, 11];
  assert.ok(combined(changed).filter(note => note.part !== 'drums').every(note => scale.includes(note.pitch % 12)));
  assert.equal(changed.target[0].pitch % 12, harmony[0].root);
  const chords = buildExercise(style, { trackId: '2:2', level: 4, harmony });
  const first = chords.target.filter(note => note.tick === 0);
  assert.deepEqual(first.map(note => (note.pitch - harmony[0].root + 12) % 12).sort((a, b) => a - b), [0, 3, 7, 10]);
  assert.equal(practiceExercise(changed, { bpm: 96, normalBpm: 96 }).practiceOnly, false);
  assert.equal(practiceExercise(changed, { bpm: 96, normalBpm: 96, speed: 50 }).practiceOnly, true);
  const progression = new Progression(4);
  for (let i = 0; i < 2; i++) progression.submit(100, 1, !practiceExercise(changed, { bpm: 96, normalBpm: 96 }).practiceOnly);
  assert.equal(progression.submit(90, 1, true), true);
  assert.equal(progression.level, 2);
  assert.deepEqual(style, before);
  assert.deepEqual(buildExercise(style, { trackId: '1:1', level: 4 }), original);
});
test('repeated sections are reharmonized once and dominant sevenths retain their chord role', () => {
  const style = createDemo();
  const harmony = randomHarmony('C', 8, () => 1 / 7);
  const short = buildExercise(style, { trackId: '2:2', level: 4, harmony: harmony.slice(0, 4) });
  const repeated = buildExercise(style, { trackId: '2:2', level: 4, bars: 8, harmony });
  assert.deepEqual(repeated.target.filter(note => note.tick < short.durationTicks), short.target);
  for (let bar = 0; bar < 8; bar++) {
    const chord = harmony[bar];
    const pitches = repeated.target.filter(note => note.tick === bar * repeated.barTicks)
      .map(note => (note.pitch - chord.root + 12) % 12);
    assert.ok(pitches.includes(chord.intervals[6]), `bar ${bar + 1} retains seventh`);
  }
});
test('debug level selection allows every density and resets streak without exceeding track range', () => {
  const progression = new Progression(3);
  progression.submit(100);
  progression.selectLevel(3);
  assert.equal(progression.level, 3);
  assert.equal(progression.streak, 0);
  progression.selectLevel(1);
  assert.equal(progression.level, 1);
  for (const level of [0, 4, 1.5, NaN]) assert.throws(() => progression.selectLevel(level), /density range/);
  assert.equal(progression.level, 1);
});
test('tempo ladder advances 50 to 75 to 100 before passing density, with a fresh streak at each speed', () => {
  const progression = new Progression(4);
  const full = buildExercise(createDemo(), { trackId: '1:1' });
  for (const speed of [50, 75, 100]) {
    const exercise = practiceExercise(full, { bpm: 96, normalBpm: 96, speed });
    assert.equal(progression.submitExercise(90, exercise), null);
    assert.equal(progression.submitExercise(100, exercise), null);
    assert.deepEqual(progression.submitExercise(90, exercise), speed === 100 ? { level: 2 } : { nextSpeed: speed === 50 ? 75 : 100 });
    assert.equal(progression.level, speed === 100 ? 2 : 1);
    assert.equal(progression.streak, 0);
  }
});
test('speed ladder excludes single-bar drills, lowered header tempo and manual 25/90 percent speeds', () => {
  const full = buildExercise(createDemo(), { trackId: '1:1' });
  for (const options of [
    { bar: 0, bpm: 96, speed: 50 }, { bar: 0, bpm: 96, speed: 75 },
    { bpm: 80, speed: 50 }, { bpm: 80, speed: 75 },
    { bpm: 96, speed: 25 }, { bpm: 96, speed: 90 },
  ]) {
    const exercise = practiceExercise(full, { normalBpm: 96, ...options });
    const progression = new Progression(4);
    for (let i = 0; i < 4; i++) assert.equal(progression.submitExercise(100, exercise), null);
    assert.equal(progression.streak, 0);
    assert.equal(progression.level, 1);
    assert.equal(exercise.nextSpeed, null);
  }
});
test('rolling average progression tracks up to 3 loops; level change resets streak; top level masters', () => {
  const full = buildExercise(createDemo(), { trackId: '1:1' });
  const progression = new Progression(4);
  const slow = practiceExercise(full, { bpm: 96, normalBpm: 96, speed: 50 });
  progression.submitExercise(100, slow);
  progression.submitExercise(89.99, slow);
  assert.equal(progression.streak, 2);
  // An average < 90 across 3 loops does not advance
  progression.submitExercise(70, slow);
  assert.equal(progression.streak, 3);
  assert.ok(progression.average < 90);
  progression.selectLevel(4);
  assert.equal(progression.streak, 0); // selectLevel resets streak
  assert.equal(progression.submitExercise(100, slow), null);
  assert.equal(progression.streak, 0);
  const top = practiceExercise(buildExercise(createDemo(), { trackId: '1:1', level: 4 }), { bpm: 96, normalBpm: 96 });
  progression.selectLevel(4); // resets streak
  progression.submitExercise(90, top);
  progression.submitExercise(90, top);
  assert.deepEqual(progression.submitExercise(90, top), { level: 4 });
  assert.equal(progression.level, 4);
});
test('track focus reduces only the selected track and keeps other same-part tracks as backing', () => {
  const style = createDemo();
  const originalBass = style.notes.filter(note => note.channel === 1);
  style.notes.push(...originalBass.map(note => ({ ...note, track: 4, channel: 4, pitch: note.pitch + 12 })));
  const exercise = buildExercise(style, { trackId: '1:1', level: 2 });
  assert.equal(exercise.focus, 'bass');
  assert.ok(exercise.target.length > 0);
  assert.ok(exercise.target.every(note => trackIdOf(note) === '1:1'));
  assert.ok(exercise.backing.some(note => trackIdOf(note) === '4:4'));
  assert.ok(exercise.backing.every(note => trackIdOf(note) !== '1:1'));
  assert.throws(() => buildExercise(style, { trackId: 'missing' }), /selected track/);
});
test('maximum track density preserves original notes while lower layers remain track-specific', () => {
  const style = createDemo();
  for (const track of styleTracks(style)) {
    const full = buildExercise(style, { trackId: track.id, level: LAYERS[track.part].length, bars: 2 });
    const expected = style.notes.filter(note => trackIdOf(note) === track.id && note.tick < full.durationTicks);
    const values = notes => notes.map(note => [note.tick, note.pitch, note.duration]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    assert.deepEqual(values(full.target), values(expected));
    const reduced = buildExercise(style, { trackId: track.id, level: 1 });
    assert.ok(reduced.target.every(note => trackIdOf(note) === track.id));
  }
});

test('notation omits in-key accidentals but cancels chromatic alterations and resets every bar', () => {
  const style = createDemo();
  const exercise = buildExercise(style, { focus: 'bass', bars: 2 });
  exercise.target = [36, 37, 36, 36, 36].map((pitch, i) => ({
    pitch, part: 'bass', tick: i * 480, duration: 480,
  }));
  const definition = notationStaves(exercise.target)[0];
  const first = buildNotationVoice(exercise, definition, 0, 'C').voice;
  const accidentalTypes = voice => voice.getTickables().filter(note => !note.isRest())
    .map(note => note.getModifiers().filter(modifier => modifier.getCategory() === 'Accidental').map(modifier => modifier.type));
  assert.deepEqual(accidentalTypes(first), [[], ['#'], ['n'], []]);
  const second = buildNotationVoice(exercise, definition, 1, 'C').voice;
  assert.deepEqual(accidentalTypes(second), [[]]);
  exercise.target = [42, 42, 41, 42].map((pitch, i) => ({ pitch, part: 'bass', tick: i * 480, duration: 480 }));
  assert.deepEqual(accidentalTypes(buildNotationVoice(exercise, definition, 0, 'G').voice), [[], [], ['n'], ['#']]);
});
test('dense bass engraving measures simplified notes and preserves source attack mappings', () => {
  const exercise = buildExercise(createDemo(), { focus: 'bass', level: 4, bars: 4 });
  const bars = prepareNotationBars(exercise, notationStaves(exercise.target), 'C');
  assert.ok(bars.every(bar => bar.minimumWidth > 0));
  const tickables = bars[1].parts[0].voice.getTickables();
  const onsets = exercise.groups.filter(group => group.tick >= exercise.barTicks && group.tick < exercise.barTicks * 2);
  assert.ok(tickables.length >= onsets.length);
  assert.ok(bars[1].parts[0].entries.every(entry => entry.sources.length > 0));
});
function rhythmExercise(notes, meter = { numerator: 4, denominator: 4 }, bars = 1) {
  const ppq = 480;
  const barTicks = ppq * 4 * meter.numerator / meter.denominator;
  return {
    ppq, meter, barTicks, bars, durationTicks: barTicks * bars, chords: Array(bars).fill(''),
    target: notes.map(([tick, duration, pitch = 36]) => ({ tick, duration, pitch, part: 'bass' })),
  };
}
test('attack-focused simplification renders the three requested long-note replacements exactly', () => {
  for (const [sounding, next, duration, staccato] of [
    [360, 480, 'q', false], [720, 960, 'h', false], [240, 480, 'q', true],
    [120, 240, '8', true],
  ]) {
    const exercise = rhythmExercise([[0, sounding], [next, 120, 38]]);
    const before = structuredClone(exercise);
    const definition = notationStaves(exercise.target)[0];
    const rhythm = planNotationRhythm(exercise, definition)[0];
    assert.equal(rhythm[0].duration, duration);
    assert.equal(rhythm[0].staccato, staccato);
    assert.equal(rhythm[0].dots, undefined);
    assert.equal(rhythm[1].unit, next / 120);
    const part = buildNotationVoice(exercise, definition, 0, 'C');
    assert.equal(part.entries[0].note.getDuration(), duration);
    assert.equal(part.entries[0].note.getModifiers().filter(modifier => modifier.getCategory() === 'Articulation').length, Number(staccato));
    assert.equal(part.ties.length, 0);
    assert.deepEqual(exercise, before);
  }
});
test('simplification preserves significant gaps, leading silence and repeated attacks', () => {
  const exercise = rhythmExercise([[240, 240], [960, 120], [1200, 120]]);
  const rhythm = planNotationRhythm(exercise, notationStaves(exercise.target)[0])[0];
  assert.equal(rhythm[0].sources.length, 0);
  assert.equal(rhythm[0].size, 2);
  assert.ok(rhythm.some(event => !event.sources.length && event.unit >= 4 && event.unit < 8));
  assert.deepEqual(rhythm.filter(event => event.sources.length && !event.continuation).map(event => event.unit), [2, 8, 10]);
  const single = rhythmExercise([[0, 120]]);
  const singlePlan = planNotationRhythm(single, notationStaves(single.target)[0])[0];
  assert.equal(singlePlan[0].size, 2);
  assert.ok(singlePlan.slice(1).every(event => event.sources.length === 0));
});
test('quarter note, short second-beat note, quarter rest, quarter note stays four clear beats', () => {
  for (const duration of [336, 360]) {
    const exercise = rhythmExercise([[0, 336], [480, duration], [1440, 336]]);
    const before = structuredClone(exercise);
    const definition = notationStaves(exercise.target)[0];
    const rhythm = planNotationRhythm(exercise, definition)[0];
    assert.deepEqual(rhythm.map(event => [event.unit, event.size, Boolean(event.sources.length), event.dots ?? 0]),
      [[0, 4, true, 0], [4, 4, true, 0], [8, 4, false, 0], [12, 4, true, 0]]);
    const part = buildNotationVoice(exercise, definition, 0, 'C');
    assert.equal(part.ties.length, 0);
    assert.deepEqual(part.voice.getTickables().map(note => note.getDuration()), ['q', 'q', 'q', 'q']);
    assert.deepEqual(exercise, before);
  }
});
test('clean dotted values have correct VexFlow ticks and no invented tenuto', () => {
  const exercise = rhythmExercise([[0, 600], [720, 120]]);
  const definition = notationStaves(exercise.target)[0];
  const part = buildNotationVoice(exercise, definition, 0, 'C');
  assert.equal(planNotationRhythm(exercise, definition)[0][0].size, 6);
  assert.equal(part.entries[0].note.getModifiers().filter(modifier => modifier.getCategory() === 'Dot').length, 1);
  assert.equal(part.voice.getTicksUsed().value(), part.voice.getTotalTicks().value());
  assert.equal(part.entries[0].note.getModifiers().filter(modifier => modifier.getCategory() === 'Articulation').length, 0);
});
test('gap absorption and staccato use explicit inclusive boundaries', () => {
  const definition = { accepts: () => true, clef: 'bass' };
  const exact = planNotationRhythm(rhythmExercise([[0, 240], [480, 120]]), definition)[0];
  assert.equal(exact[0].size, 4);
  const larger = planNotationRhythm(rhythmExercise([[0, 239], [480, 120]]), definition)[0];
  assert.equal(larger[0].size, 2);
  assert.equal(larger[1].sources.length, 0);
  for (const [sounding, staccato] of [[264, true], [265, false], [360, false]]) {
    const first = planNotationRhythm(rhythmExercise([[0, sounding], [480, 120]]), definition)[0][0];
    assert.equal(first.size, 4);
    assert.equal(first.staccato, staccato);
  }
});
test('off-beat sustain uses only necessary beat ties and preserves the next attack', () => {
  const exercise = rhythmExercise([[240, 360], [720, 120]]);
  const definition = notationStaves(exercise.target)[0];
  const rhythm = planNotationRhythm(exercise, definition)[0];
  assert.deepEqual(rhythm.filter(event => event.attackUnit === 2).map(event => [event.unit, event.size, event.continuation]), [[2, 2, false], [4, 2, true]]);
  const part = buildNotationVoice(exercise, definition, 0, 'C');
  assert.equal(part.ties.length, 1);
});
test('held notes cross barlines without new source attacks and chords use their longest release', () => {
  const exercise = rhythmExercise([[0, 2400], [2400, 120, 38]], undefined, 2);
  const definition = notationStaves(exercise.target)[0];
  const rhythm = planNotationRhythm(exercise, definition);
  assert.equal(rhythm[1][0].continuation, true);
  assert.equal(rhythm[1][0].sources[0], exercise.target[0]);
  assert.equal(rhythm.flat().filter(event => event.sources.length && !event.continuation).length, 2);
  const chord = rhythmExercise([[0, 120, 36], [0, 480, 40], [480, 120, 43]]);
  const first = planNotationRhythm(chord, notationStaves(chord.target)[0])[0][0];
  assert.equal(first.size, 4);
  assert.equal(first.staccato, false);
  assert.equal(first.sources.length, 2);
});
test('all planned measures fill exactly in simple and compound meters', () => {
  for (const meter of [{ numerator: 4, denominator: 4 }, { numerator: 6, denominator: 8 }]) {
    const exercise = rhythmExercise([[0, 360], [720, 180], [1080, 120], [1920, 120]], meter, 2);
    const definition = notationStaves(exercise.target)[0];
    const plans = planNotationRhythm(exercise, definition);
    for (let bar = 0; bar < 2; bar++) {
      assert.equal(plans[bar].reduce((total, event) => total + event.size, 0), exercise.barTicks / 120);
      const part = buildNotationVoice(exercise, definition, bar, 'C');
      assert.equal(part.voice.getTicksUsed().value(), part.voice.getTotalTicks().value());
    }
  }
});

test('bass guitar notation raises written pitches only and uses an octave-down bass clef', () => {
  const bass = { pitch: 28, part: 'bass' };
  assert.equal(writtenPitch(bass), 40);
  assert.equal(bass.pitch, 28);
  assert.equal(writtenPitch({ pitch: 48, part: 'chords' }), 48);
  assert.equal(writtenPitch({ pitch: 36, part: 'drums' }), 36);
  const staves = notationStaves([bass]);
  assert.equal(staves.length, 1);
  assert.equal(staves[0].clef, 'bass');
  assert.equal(staves[0].annotation, '8vb');
  assert.equal(staves[0].accepts({ pitch: 72, part: 'bass' }), true);
});
test('mixed arrangements separate transposing bass from concert-pitch chord staves', () => {
  const notes = [{ pitch: 36, part: 'bass' }, { pitch: 48, part: 'chords' }, { pitch: 64, part: 'chords' }, { pitch: 36, part: 'drums' }];
  const staves = notationStaves(notes);
  assert.deepEqual(staves.map(staff => [staff.clef, staff.annotation]), [
    ['treble', undefined], ['bass', undefined], ['bass', '8vb'], ['percussion', undefined],
  ]);
  for (const note of notes) assert.equal(staves.filter(staff => staff.accepts(note)).length, 1);
});

function midi(track, { format = 0, division = 480 } = {}) {
  const bytes = [
    ...Buffer.from('MThd'), 0, 0, 0, 6, 0, format, 0, 1, division >> 8, division & 255,
    ...Buffer.from('MTrk'), 0, 0, track.length >> 8, track.length & 255, ...track,
  ];
  return Uint8Array.from(bytes).buffer;
}
test('SMF parser handles tempo, meter, key, programs, running status and velocity-zero offs', () => {
  const style = parseMidi(midi([
    0, 0xff, 0x51, 3, 7, 0xa1, 0x20,
    0, 0xff, 0x58, 4, 4, 2, 24, 8,
    0, 0xff, 0x59, 2, 0, 0,
    0, 0xc1, 33,
    0, 0x91, 36, 100,
    0x83, 0x60, 36, 0,
    0, 0xff, 0x2f, 0,
  ]), 'Groove.mid');
  assert.equal(style.name, 'Groove');
  assert.equal(style.sourceType, 'midi');
  assert.equal(style.tempos[0].bpm, 120);
  assert.equal(style.key, 'C');
  assert.equal(style.notes[0].duration, 480);
  assert.equal(style.notes[0].program, 33);
  assert.equal(style.maxTick, 480);
});
test('parser closes repeated overlapping pitches independently', () => {
  const style = parseMidi(midi([
    0, 0x90, 60, 90, 120, 60, 80, 120, 0x80, 60, 0, 120, 60, 0, 0, 0xff, 0x2f, 0,
  ]));
  assert.deepEqual(style.notes.map(n => n.duration), [240, 240]);
});
test('SMF parser identifies Yamaha style filename extensions', () => {
  const data = midi([0, 0x90, 60, 90, 120, 0x80, 60, 0, 0, 0xff, 0x2f, 0]);
  for (const extension of ['sty', 'prs', 'sst']) {
    assert.equal(parseMidi(data, `example.${extension}`).sourceType, 'style');
  }
});
test('program and bank changes in a different SMF track apply by channel and time', () => {
  const control = [0, 0xc1, 33, 0, 0xff, 0x2f, 0];
  const notes = [0, 0x91, 36, 90, 120, 0x81, 36, 0, 0, 0xff, 0x2f, 0];
  const header = [...Buffer.from('MThd'), 0, 0, 0, 6, 0, 1, 0, 2, 1, 0xe0];
  const chunk = data => [...Buffer.from('MTrk'), 0, 0, 0, data.length, ...data];
  const style = parseMidi(Uint8Array.from([...header, ...chunk(control), ...chunk(notes)]).buffer);
  assert.equal(style.notes[0].program, 33);
  const exercise = buildExercise(style, { focus: 'bass', bars: 1 });
  assert.deepEqual(exercise.target.map(n => [n.tick, n.duration]), [[0, 120], [480, 120], [960, 120], [1440, 120]]);
});
test('parser reads Yamaha section markers and rejects malformed trailing CASM', () => {
  const raw = new Uint8Array(midi([
    0, 0xff, 6, 6, ...Buffer.from('Main A'),
    0, 0x90, 60, 80, 0x83, 0x60, 0x80, 60, 0,
    0, 0xff, 6, 10, ...Buffer.from('Fill In AA'),
    0, 0x90, 62, 80, 0x83, 0x60, 0x80, 62, 0,
    0, 0xff, 0x2f, 0,
  ]));
  const withCasm = new Uint8Array(raw.length + 8);
  withCasm.set(raw);
  withCasm.set(Buffer.from('CASMxxxx'), raw.length);
  assert.throws(() => parseMidi(withCasm.buffer, 'test.sty'), /Truncated Yamaha CASM/);
  withCasm.set([0, 0, 0, 0], raw.length + 4);
  const style = parseMidi(withCasm.buffer, 'test.sty');
  assert.equal(style.sections.length, 2);
  assert.equal(style.sections[0].end, 480);
  assert.equal(style.sections[1].start, 480);
});
test('parser explicitly rejects malformed, truncated, SMPTE and format-2 files', () => {
  assert.throws(() => parseMidi(new ArrayBuffer(4)), /Truncated|Choose/);
  assert.throws(() => parseMidi(midi([], { format: 2 })), /format-2/);
  assert.throws(() => parseMidi(midi([], { division: 0x8001 })), /PPQ/);
  assert.throws(() => parseMidi(midi([0, 60, 90])), /running status/);
  assert.throws(() => parseMidi(midi([0, 0xff, 1, 127])), /Truncated/);
});
test('each focus has the specified density ladder and no unwanted backing part', () => {
  const style = createDemo();
  assert.equal(LAYERS.drums.length, 4);
  assert.equal(LAYERS.bass.length, 4);
  assert.equal(LAYERS.chords.length, 4);
  for (const focus of Object.keys(LAYERS)) {
    let previous = 0;
    for (let level = 1; level <= LAYERS[focus].length; level++) {
      const exercise = buildExercise(style, { focus, level, bars: 4 });
      assert.ok(exercise.target.length >= previous, `${focus} ${level} should increase density`);
      previous = exercise.target.length;
      assert.ok(exercise.backing.every(n => focus !== 'full' && n.part !== focus));
      assert.ok(exercise.target.every(n => n.isTarget));
    }
  }
});
test('drum levels keep every kick then every snare then hats, regardless of beat', () => {
  const style = createDemo();
  style.notes = [
    [0, 36], [240, 35], [480, 36], [720, 38], [960, 40],
    [1200, 42], [1440, 44], [1680, 46], [0, 49], [240, 51], [480, 34], [720, 45],
  ].map(([tick, pitch]) => ({ tick, pitch, duration: 60, channel: 9, track: 9, program: 0, velocity: 80, bank: 0 }));
  const kick = buildExercise(style, { focus: 'drums', level: 1, bars: 1 });
  assert.deepEqual(kick.target.map(n => [n.tick, n.pitch]), [[0, 36], [240, 35], [480, 36]]);
  const snare = buildExercise(style, { focus: 'drums', level: 2, bars: 1 });
  assert.deepEqual(snare.target.map(n => n.pitch), [36, 35, 36, 38, 40]);
  assert.deepEqual(buildExercise(style, { focus: 'drums', level: 3, bars: 1 }).target.map(n => n.pitch),
    [36, 35, 36, 38, 40, 42, 44, 46]);
  assert.equal(buildExercise(style, { focus: 'drums', level: 4, bars: 1 }).target.length, style.notes.length);
});
test('Yamaha kick and snare variants retain assigned pitches, kits and velocities at every layer', () => {
  const style = createDemo();
  style.notes = [33, 35, 36, 31, 37, 38, 40, 42, 44, 46, 29, 32, 34, 39, 49].map((pitch, i) => ({
    pitch, tick: i * 120, duration: 55, channel: 9, track: 9, bank: 127, program: 40, velocity: 64 + i,
  }));
  const expected = [
    [33, 35, 36], [33, 35, 36, 31, 37, 38, 40],
    [33, 35, 36, 31, 37, 38, 40, 42, 44, 46], style.notes.map(note => note.pitch),
  ];
  for (let level = 1; level <= 4; level++) {
    const exercise = buildExercise(style, { trackId: '9:9', bars: 1, level });
    assert.deepEqual(exercise.target.map(note => note.pitch), expected[level - 1]);
    assert.deepEqual(exercise.target.map(({ part, isTarget, ...note }) => note),
      style.notes.filter(note => expected[level - 1].includes(note.pitch)));
  }
});
test('chord layers select source roots then other on-beat notes without generating fifths or triads', () => {
  const style = createDemo();
  assert.deepEqual(buildExercise(style, { focus: 'chords', level: 1, bars: 1 }).target.map(n => n.pitch), [60]);
  assert.deepEqual(buildExercise(style, { focus: 'chords', level: 2, bars: 1 }).target.map(n => n.pitch), [60, 64]);
  assert.deepEqual(buildExercise(style, { focus: 'chords', level: 3, bars: 1 }).target.map(n => n.pitch), [60, 64, 67]);
  assert.deepEqual(buildExercise(style, { focus: 'chords', level: 4, bars: 1 }).target.map(n => n.pitch), [60, 64, 67, 71]);
  assert.equal(inferChord([{ pitch: 60 }, { pitch: 64 }, { pitch: 67 }, { pitch: 71 }]).name, 'Cmaj7');
});
test('bass and chords have cumulative four-layer filters and preserve all source note properties', () => {
  for (const focus of ['bass', 'chords']) {
    const style = createDemo();
    const source = [
      [0, 36], [240, 36], [480, 40], [720, 43], [960, 48], [1200, 38], [1440, 43], [1680, 48],
    ].map(([tick, pitch], index) => ({
      tick, pitch, duration: 71 + index, velocity: 60 + index, channel: focus === 'bass' ? 1 : 2,
      track: focus === 'bass' ? 1 : 2, bank: 0, program: focus === 'bass' ? 33 : 0,
    }));
    const harmony = [60, 64, 67].map(pitch => ({
      tick: 0, pitch, duration: 1920, velocity: 60, channel: 3, track: 3, program: 0, bank: 0,
    }));
    style.notes = [...source, ...harmony];
    const expected = [[0, 4], [0, 1, 4, 7], [0, 1, 2, 4, 6, 7], [0, 1, 2, 3, 4, 5, 6, 7]];
    for (let level = 1; level <= 4; level++) {
      const exercise = buildExercise(style, { trackId: `${source[0].track}:${source[0].channel}`, level, bars: 1 });
      assert.deepEqual(exercise.target.map(({ part, isTarget, ...note }) => note),
        expected[level - 1].map(index => source[index]), `${focus} level ${level}`);
    }
  }
});
test('root filtering follows intra-bar chord changes including inversions and held harmony', () => {
  const style = createDemo();
  const note = (tick, pitch, duration, channel) => ({ tick, pitch, duration, channel, track: channel, program: channel === 1 ? 33 : 0, bank: 0, velocity: 80 });
  style.notes = [
    ...[64, 67, 72].map(pitch => note(0, pitch, 960, 2)),
    ...[65, 69, 72].map(pitch => note(960, pitch, 2880, 2)),
    note(0, 36, 100, 1), note(480, 40, 100, 1),
    note(960, 41, 100, 1), note(1440, 36, 100, 1),
    note(1920, 41, 100, 1), note(2400, 43, 100, 1),
  ];
  const bass = buildExercise(style, { trackId: '1:1', level: 1, bars: 2 });
  assert.deepEqual(bass.target.map(n => [n.tick, n.pitch]), [[0, 36], [960, 41], [1920, 41]]);
  assert.deepEqual(bass.chords, ['C', 'F']);
});
test('beat classification allows humanization without moving notes and follows the meter beat unit', () => {
  for (const denominator of [4, 8]) {
    const style = createDemo();
    style.meters = [{ tick: 0, numerator: denominator === 4 ? 4 : 6, denominator }];
    const beat = 480 * 4 / denominator;
    const positions = [0, beat + beat * .05, beat * 2 + beat * .07, beat * 2.5];
    const source = positions.map(tick => ({
      tick, pitch: 36, duration: 40, channel: 1, track: 1, program: 33, bank: 0, velocity: 80,
    }));
    style.notes = source;
    assert.deepEqual(buildExercise(style, { focus: 'bass', bars: 1 }).target.map(n => n.tick), positions.slice(0, 2));
    assert.deepEqual(buildExercise(style, { focus: 'bass', level: 2, bars: 1 }).target.map(n => n.tick), positions.slice(0, 3));
    assert.deepEqual(buildExercise(style, { focus: 'bass', level: 4, bars: 1 }).target.map(n => n.tick), positions);
  }
});
test('sparse bass uses its on-beat root without treating off-beat approach notes as roots', () => {
  const style = createDemo();
  style.notes = [[240, 35], [480, 36], [720, 36], [960, 43], [1200, 38]].map(([tick, pitch]) => ({
    tick, pitch, duration: 60, channel: 1, track: 1, program: 33, bank: 0, velocity: 80,
  }));
  assert.deepEqual(buildExercise(style, { focus: 'bass', bars: 1 }).target.map(n => n.tick), [480]);
  assert.deepEqual(buildExercise(style, { focus: 'bass', level: 2, bars: 1 }).target.map(n => n.tick), [480, 720]);
  assert.deepEqual(buildExercise(style, { focus: 'bass', level: 3, bars: 1 }).target.map(n => n.tick), [480, 720, 960]);
});
test('exercise length is exactly 1–8 bars and short sections repeat with clipped tails', () => {
  const style = createDemo();
  style.sections[0].end = 1920;
  for (let bars = 1; bars <= 8; bars++) {
    const exercise = buildExercise(style, { bars, focus: 'drums', level: 4 });
    assert.equal(exercise.durationTicks, 1920 * bars);
    assert.ok(exercise.target.every(n => n.tick + n.duration <= exercise.durationTicks));
    assert.equal(exercise.target.filter(n => n.pitch === 36).length, 2 * bars);
  }
});
test('last-bar practice clips notes and backing, preserves pitch and uses that bar chord', () => {
  const full = buildExercise(createDemo(), { bars: 4, focus: 'bass', level: 2 });
  const before = structuredClone(full);
  const drill = practiceExercise(full, { bar: 3, bpm: 96, normalBpm: 96, speed: 50 });
  assert.equal(drill.bars, 1);
  assert.equal(drill.sourceBar, 4);
  assert.equal(drill.durationTicks, full.barTicks);
  assert.deepEqual(drill.chords, ['G7']);
  assert.equal(drill.playbackBpm, 48);
  assert.equal(drill.practiceOnly, true);
  assert.ok(drill.target.every(n => n.tick >= 0 && n.tick + n.duration <= full.barTicks));
  assert.ok(drill.backing.every(n => n.tick >= 0 && n.tick + n.duration <= full.barTicks));
  assert.deepEqual(drill.target.map(n => n.pitch), full.target.filter(n => n.tick >= 3 * full.barTicks).map(n => n.pitch));
  assert.deepEqual(full, before);
});
test('reduced tempo or selected-bar practice never qualifies; normal full pattern does', () => {
  const full = buildExercise(createDemo());
  for (const options of [
    { bar: 0, bpm: 96, speed: 100 }, { bpm: 96, speed: 75 }, { bpm: 80, speed: 100 },
  ]) {
    assert.equal(practiceExercise(full, { normalBpm: 96, ...options }).practiceOnly, true);
  }
  assert.equal(practiceExercise(full, { bpm: 96, normalBpm: 96 }).practiceOnly, false);
  assert.throws(() => practiceExercise(full, { bar: 4, bpm: 96, normalBpm: 96 }), /within/);
  const progression = new Progression(3);
  for (let i = 0; i < 5; i++) assert.equal(progression.submit(100, 1, false), false);
  assert.equal(progression.level, 1);
  assert.equal(progression.streak, 0);
  progression.submit(100);
  progression.submit(100);
  assert.equal(progression.submit(90), true);
});
test('single-bar drills retrigger and clip sustained notes crossing the selected start', () => {
  const full = buildExercise(createDemo());
  full.target = [{ pitch: 60, tick: full.barTicks - 120, duration: 360, part: 'chords' }];
  const drill = practiceExercise(full, { bar: 1, bpm: 96, normalBpm: 96 });
  assert.deepEqual(drill.target.map(n => [n.tick, n.duration]), [[0, 240]]);
});
test('invalid ranges and meter-changing exercise ranges fail explicitly', () => {
  const style = createDemo();
  assert.throws(() => buildExercise(style, { bars: 0 }), /1 to 8/);
  assert.throws(() => buildExercise(style, { level: 5 }), /density/);
  style.meters.push({ tick: 1920, numerator: 3, denominator: 4 });
  assert.throws(() => buildExercise(style, { bars: 4 }), /time-signature/);
  assert.doesNotThrow(() => buildExercise(style, { bars: 1 }));
});
test('off-beat-only chords provide progressive targets without inventing artificial notes', () => {
  const style = createDemo();
  style.notes = style.notes.filter(n => n.channel === 2).map(n => ({ ...n, tick: n.tick + 240 }));
  const first = buildExercise(style, { focus: 'chords', bars: 1 });
  assert.equal(first.target.length, 1);
  assert.deepEqual(first.target.map(n => [n.tick, n.pitch]), [[240, 60]]);
  const second = buildExercise(style, { focus: 'chords', level: 2, bars: 1 });
  assert.equal(second.target.length, 2);
  assert.equal(second.target[0].duration, 1680);
  assert.equal(buildExercise(style, { focus: 'chords', level: 3, bars: 1 }).target.length, 3);
  assert.equal(buildExercise(style, { focus: 'chords', level: 4, bars: 1 }).target.length, 4);
});
test('missing parts yield an empty target, not invented quiz successes', () => {
  const style = createDemo();
  style.notes = style.notes.filter(n => n.channel === 9);
  assert.equal(buildExercise(style, { focus: 'chords' }).target.length, 0);
  assert.equal(new LoopScore([], 1, 0).result().score, 0);
});
test('score awards 1.0 for ±1/32 note, 0.5 for ±1/16 note, and 0 beyond', () => {
  // ppq = 480, msPerTick = 1:
  // 1/32 note = 60 ms
  // 1/16 note = 120 ms
  for (const offset of [-60, -30, 0, 30, 60]) {
    const score = new LoopScore([{ tick: 100, pitches: [60] }], 1, 1000);
    assert.equal(score.input(60, 1100 + offset), true);
    assert.equal(score.result().score, 100);
  }
  for (const offset of [-120, -90, 90, 120]) {
    const score = new LoopScore([{ tick: 100, pitches: [60] }], 1, 1000);
    assert.equal(score.input(60, 1100 + offset), true);
    assert.equal(score.result().score, 50);
  }
  for (const offset of [-120.001, 120.001]) {
    const score = new LoopScore([{ tick: 100, pitches: [60] }], 1, 1000);
    assert.equal(score.input(60, 1100 + offset), false);
    assert.equal(score.result().score, 0);
  }
});
test('scoring matches each pitch once, penalizes extras and requires all chord notes', () => {
  const score = new LoopScore([{ tick: 0, pitches: [60, 64, 67] }], 1, 100);
  score.input(60, 100);
  score.input(64, 100);
  score.input(60, 100);
  const result = score.result();
  assert.deepEqual(result, { hits: 2, total: 3, extra: 1, score: 50 });
  assert.deepEqual(score.inputs.map(({ feedback, ...input }) => input), [
    { pitch: 60, time: 100, matched: true, offsetMs: 0, credit: 1 },
    { pitch: 64, time: 100, matched: true, offsetMs: 0, credit: 1 },
    { pitch: 60, time: 100, matched: false, offsetMs: null, credit: 0 },
  ]);
  assert.equal(groupNotes([{ tick: 0, pitch: 60 }, { tick: 0, pitch: 60 }])[0].pitches.length, 1);
});
test('input feedback separates wrong layout pitches, timing misses and duplicates without relaxing scoring', () => {
  const score = new LoopScore([{ tick: 0, pitches: [36] }, { tick: 500, pitches: [36] }], 1, 1000);
  assert.deepEqual(inputFeedback(score.expected, 60, 1000, score.halfTolerance), { reason: 'pitch', offsetMs: null, expectedPitches: [36] });
  assert.equal(score.input(60, 1000), false);
  assert.equal(score.inputs.at(-1).feedback.reason, 'pitch');
  assert.equal(score.input(36, 1150), false);
  assert.equal(score.inputs.at(-1).feedback.reason, 'timing');
  assert.equal(score.inputs.at(-1).feedback.offsetMs, 150);
  assert.equal(score.input(36, 965), true);
  assert.equal(score.inputs.at(-1).feedback.reason, 'hit');
  assert.equal(score.input(36, 1000), false);
  assert.equal(score.inputs.at(-1).feedback.reason, 'duplicate');
});
test('displayed target keeps the current note during the valid late-hit window', () => {
  const groups = [{ tick: 0, pitches: [60] }, { tick: 480, pitches: [62] }];
  assert.equal(targetGroupAt(groups, 45, 100), groups[0]);
  assert.equal(targetGroupAt(groups, 100, 100), groups[0]);
  assert.equal(targetGroupAt(groups, 101, 100), groups[1]);
  assert.equal(targetGroupAt(groups, 490, 100), groups[1]);
  assert.equal(targetGroupAt([], 0, 100), null);
});
test('rolling average of 3 loops >= 90% levels up; sub-90% average does not level up', () => {
  const progression = new Progression(2);
  assert.equal(progression.submit(90), false);
  assert.equal(progression.submit(85), false);
  assert.equal(progression.streak, 2);
  assert.equal(progression.submit(95), true);
  assert.equal(progression.level, 2);
  assert.equal(progression.streak, 0);
  for (let i = 0; i < 10; i++) progression.submit(100);
  assert.equal(progression.level, 2);
});
test('a finishing loop from the old density cannot qualify for the new level', () => {
  const progression = new Progression(4);
  progression.submit(100, 1);
  progression.submit(100, 1);
  assert.equal(progression.submit(100, 1), true);
  assert.equal(progression.submit(100, 1), false);
  assert.equal(progression.streak, 0);
  progression.submit(100, 2);
  assert.equal(progression.streak, 1);
});

function harness() {
  let now = 0;
  const played = [];
  const results = [];
  const guides = [];
  const exercise = buildExercise(createDemo(), { bars: 1, focus: 'chords', level: 3 });
  const transport = new Transport({
    now: () => now, noteOn: n => played.push(n), noteOff: () => {}, silence: () => {},
    guide: p => guides.push(p), onState: () => {}, onResult: r => results.push(r),
    onLoop: () => {}, onError: e => { throw e; },
  });
  return { transport, exercise, played, results, guides, advance: ms => { now = ms; transport.tick(); } };
}
test('record scoring compensates audio output latency so playing with heard audio is on time', () => {
  const latency = 400;
  const h = harness();
  try {
    h.transport.latencyMs = latency;
    h.transport.start('record', h.exercise, 120);
    const origin = h.transport.origin;
    const first = h.exercise.groups[0];
    // The listener hears the downbeat 400 ms after it was sent and plays with it.
    assert.equal(h.transport.input(first.pitches[0], true, origin + first.tick * h.transport.msPerTick + latency), true);
    assert.equal(h.transport.feedback.reason, 'hit');
    assert.ok(Math.abs(h.transport.feedback.offsetMs) < 1e-6);
    // Loop results wait until the delayed audio and tolerance window have passed.
    h.advance(origin + h.transport.duration + 150);
    assert.equal(h.results.length, 0);
    h.advance(origin + h.transport.duration + latency + 150);
    assert.equal(h.results.length, 1);
    // Playhead shows what is heard, not what was just sent to the synth.
    h.transport.latencyMs = latency;
    assert.equal(h.transport.heardPosition(origin + latency + 500), 500 / h.transport.msPerTick);
    assert.equal(h.transport.heardPosition(origin + 100), 0);
  } finally { h.transport.stop(); }
  const uncompensated = harness();
  try {
    uncompensated.transport.start('record', uncompensated.exercise, 120);
    const first = uncompensated.exercise.groups[0];
    uncompensated.transport.input(first.pitches[0], true, uncompensated.transport.origin + first.tick * uncompensated.transport.msPerTick + latency);
    assert.notEqual(uncompensated.transport.feedback.reason, 'hit');
  } finally { uncompensated.transport.stop(); }
});
test('median timing offset calibrates from correct-pitch presses only', () => {
  const press = (reason, offsetMs) => ({ feedback: { reason, offsetMs } });
  assert.equal(medianTimingOffset([press('hit', 380), press('timing', 420), press('timing', 400), press('pitch', -900), press('duplicate', 410)]), 405);
  assert.equal(medianTimingOffset([press('hit', 10), press('pitch', 5)]), null);
  assert.equal(medianTimingOffset([]), null);
});
test('steady click works in Play, pauses in Step, and Record count-in survives click off', () => {
  for (const mode of ['play', 'step', 'record']) {
    const h = harness();
    const beats = [];
    h.transport.onBeat = (accent, countIn) => beats.push({ accent, countIn });
    try {
      h.transport.clickEnabled = mode !== 'record';
      h.transport.start(mode, h.exercise, 120);
      if (mode === 'record') {
        for (const time of [0, 500, 1000, 1500, 2000, 2500]) h.advance(time);
        assert.deepEqual(beats, [
          { accent: true, countIn: true }, { accent: false, countIn: true },
          { accent: false, countIn: true }, { accent: false, countIn: true },
        ]);
      } else {
        h.advance(80);
        h.advance(580);
        h.advance(1080);
        assert.equal(beats.length, mode === 'step' ? 1 : 3);
        assert.equal(beats[0].accent, true);
        assert.ok(beats.every(beat => !beat.countIn));
      }
    } finally { h.transport.stop(); }
  }
  const h = harness();
  let clicks = 0;
  h.transport.onBeat = () => clicks++;
  try {
    h.transport.clickEnabled = false;
    h.transport.start('play', h.exercise, 120);
    h.advance(80);
    h.advance(580);
    assert.equal(clicks, 0);
  } finally { h.transport.stop(); }
});
test('solo schedules only target notes in Play/Step and keeps Record targets muted without changing scores', () => {
  const h = harness();
  try {
    for (const mode of ['play', 'step', 'record']) {
      h.transport.solo = true;
      h.transport.start(mode, h.exercise, 120);
      assert.ok(h.transport.events.every(event => event.note.isTarget));
      assert.equal(h.transport.events.length, mode === 'record' ? 0 : h.exercise.target.length * 2);
      if (mode === 'record') {
        assert.equal(h.transport.origin, 2000);
        for (const pitch of h.exercise.groups[0].pitches) h.transport.input(pitch, true, 2000);
        h.advance(4150);
        assert.equal(h.results.at(-1).score, 100);
      }
      h.transport.stop();
    }
    h.transport.solo = false;
    h.transport.start('play', h.exercise, 120);
    assert.equal(h.transport.events.length, (h.exercise.backing.length + h.exercise.target.length) * 2);
    assert.ok(h.transport.events.some(event => !event.note.isTarget));
  } finally { h.transport.stop(); }
});
test('PLAY repeats continuously, STOP resets, LOOP OFF plays exactly one pass', () => {
  const h = harness();
  try {
    h.transport.start('play', h.exercise, 120);
    h.advance(80);
    assert.ok(h.played.length);
    h.advance(2080);
    assert.equal(h.transport.cycle, 1);
    assert.equal(h.transport.mode, 'play');
    h.transport.stop();
    assert.equal(h.transport.position, 0);
    h.transport.loop = false;
    h.transport.start('play', h.exercise, 120);
    h.advance(4160);
    assert.equal(h.transport.mode, 'stop');
  } finally { h.transport.stop(); }
});
test('STEP freezes at chord onset and requires simultaneous shape, then advances and loops', () => {
  const h = harness();
  try {
    h.transport.start('step', h.exercise, 120);
    h.advance(80);
    assert.equal(h.transport.waiting.group.tick, 0);
    h.advance(500);
    assert.equal(h.transport.position, 0);
    assert.equal(h.transport.input(60, true, 500), true);
    h.transport.input(60, false, 500);
    h.transport.input(64, true, 500);
    h.transport.input(67, true, 500);
    h.transport.input(71, true, 500);
    assert.ok(h.transport.waiting, 'released root does not complete chord');
    h.transport.input(60, true, 500);
    assert.equal(h.transport.waiting, null);
    h.advance(1000);
    assert.ok(h.transport.position > 0);
    h.advance(2500);
    assert.equal(h.transport.cycle, 1);
    h.advance(2505);
    assert.ok(h.transport.waiting);
  } finally { h.transport.stop(); }
});
test('RECORD mutes target, scores late final hits after boundary and accepts early next-loop hits', () => {
  const h = harness();
  const exercise = {
    ...h.exercise,
    target: [{ tick: 1900, pitch: 60, duration: 10, isTarget: true }],
    groups: [{ tick: 0, pitches: [62], notes: [] }, { tick: 1900, pitches: [60], notes: [] }],
    backing: [],
  };
  try {
    h.transport.start('record', exercise, 120);
    // Origin = 2000, duration = 2000, final target = 3979.166...
    assert.equal(h.transport.input(62, true, 2000), true);
    h.advance(3900);
    assert.equal(h.transport.input(62, true, 3900), true, '100 ms early next-loop onset gets next-loop scorer');
    h.advance(4000);
    assert.equal(h.results.length, 0);
    assert.equal(h.transport.input(60, true, 4010), true, 'final hit can arrive after boundary within perfect tolerance');
    h.advance(4124);
    assert.equal(h.results.length, 0);
    h.advance(4130);
    assert.equal(h.results.length, 1);
    assert.equal(h.results[0].score, 100);
    assert.equal(h.played.length, 0);
  } finally { h.transport.stop(); }
});
test('RECORD with looping disabled waits the full scoring grace window then stops', () => {
  const h = harness();
  try {
    h.transport.loop = false;
    h.transport.start('record', h.exercise, 120);
    h.advance(2000);
    for (const pitch of h.exercise.groups[0].pitches) h.transport.input(pitch, true, 2000);
    h.advance(4000);
    assert.equal(h.transport.mode, 'record');
    h.advance(4124);
    assert.equal(h.transport.mode, 'record');
    h.advance(4130);
    assert.equal(h.results[0].score, 100);
    assert.equal(h.transport.mode, 'stop');
  } finally { h.transport.stop(); }
});
test('record loop toggle removes and restores the next-loop early-input window', () => {
  const h = harness();
  try {
    h.transport.start('record', h.exercise, 120);
    h.transport.setLoop(false);
    assert.equal(h.transport.scores.has(1), false);
    assert.equal(h.transport.input(60, true, 3900), false);
    h.transport.setLoop(true);
    assert.equal(h.transport.input(60, true, 3900), true);
  } finally { h.transport.stop(); }
});
test('a queued density applies at the next loop boundary, not in the middle of a loop', () => {
  const h = harness();
  try {
    h.transport.start('play', h.exercise, 120);
    const next = buildExercise(createDemo(), { bars: 1, focus: 'chords', level: 4 });
    h.transport.queueExercise(next);
    h.advance(1000);
    assert.equal(h.transport.exercise, h.exercise);
    h.advance(2080);
    assert.equal(h.transport.exercise, next);
  } finally { h.transport.stop(); }
});
test('stopping from the third qualifying result prevents further transport events and celebrates once', () => {
  const h = harness();
  const progression = new Progression(2);
  let celebrations = 0;
  h.transport.onResult = result => {
    if (progression.submit(result.score)) { h.transport.stop(); celebrations++; }
  };
  try {
    h.transport.start('record', h.exercise, 120);
    for (let cycle = 0; cycle < 3; cycle++) {
      const origin = 2000 + cycle * 2000;
      h.advance(origin);
      for (const pitch of h.exercise.groups[0].pitches) h.transport.input(pitch, true, origin);
      h.advance(origin + 2000);
      h.advance(origin + 2150);
    }
    assert.equal(progression.level, 2);
    assert.equal(celebrations, 1);
    assert.equal(h.transport.mode, 'stop');
    assert.equal(h.transport.position, 0);
    const played = h.played.length;
    h.advance(9000);
    assert.equal(h.played.length, played);
    assert.equal(celebrations, 1);
  } finally { h.transport.stop(); }
});
test('step mode cannot advance on a wrong pitch even when the shape is held', () => {
  const h = harness();
  try {
    h.transport.start('step', h.exercise, 120);
    h.transport.held = new Set([60, 64, 67]);
    h.advance(80);
    assert.equal(h.transport.input(61, true), false);
    assert.ok(h.transport.waiting);
  } finally { h.transport.stop(); }
});
test('MIDI feedback uses native note messages and clears lit pads when changing outputs', () => {
  const messages = [];
  const output = { state: 'connected', send: message => messages.push(message) };
  const received = [];
  const controller = new MidiController((...args) => received.push(args), () => {}, error => { throw error; });
  controller.output = output;
  controller.guide([36, 60]);
  controller.setOutput('');
  assert.deepEqual(messages, [[0x90, 36, 60], [0x90, 60, 60], [0x80, 36, 0], [0x80, 60, 0]]);
  assert.equal(controller.lit.size, 0);
  const input = { id: 'input' };
  controller.access = { inputs: new Map([['input', input]]) };
  controller.setInput('input');
  input.onmidimessage({ data: [0x90, 60, 90], timeStamp: 100 });
  input.onmidimessage({ data: [0x90, 60, 0], timeStamp: 101 });
  input.onmidimessage({ data: [0x80, 64, 0], timeStamp: 102 });
  assert.deepEqual(received.slice(1), [[60, true, 90, 100], [60, false, 0, 101], [64, false, 0, 102]]);
});

test('mastery tracking updates styles, highest levels, and 100% flawless distinctions', () => {
  let mastery = loadMastery({ getItem: () => null });
  assert.deepEqual(mastery.styles, {});
  assert.deepEqual(mastery.trophies, {});

  // Loop 1: 95% on Level 1
  let res = recordLoopToMastery(mastery, {
    styleName: 'Bebop Swing',
    level: 1,
    maxLevel: 4,
    score: 95,
    bpm: 120,
    isPracticeOnly: false,
  });
  mastery = res.mastery;
  assert.equal(mastery.styles['Bebop Swing'].highestLevel, 1);
  assert.equal(mastery.styles['Bebop Swing'].bestScore, 95);
  assert.equal(mastery.styles['Bebop Swing'].has100OnHighest, false);
  assert.ok(res.unlocked.some(t => t.id === 'first-loop'));

  // Loop 2: 100% on Level 1 -> gets 100% star and Century Club
  res = recordLoopToMastery(mastery, {
    styleName: 'Bebop Swing',
    level: 1,
    maxLevel: 4,
    score: 100,
    bpm: 120,
    isPracticeOnly: false,
  });
  mastery = res.mastery;
  assert.equal(mastery.styles['Bebop Swing'].has100OnHighest, true);
  assert.equal(mastery.styles['Bebop Swing'].hasEver100, true);
  assert.ok(res.unlocked.some(t => t.id === 'century-club'));

  // Advancement to Level 2
  res = recordAdvancementToMastery(mastery, {
    styleName: 'Bebop Swing',
    completedLevel: 1,
    maxLevel: 4,
    score: 96,
    bpm: 120,
  });
  mastery = res.mastery;
  assert.equal(mastery.styles['Bebop Swing'].highestLevel, 2);
  // Now highest level is 2, and they haven't gotten 100% on level 2 yet
  assert.equal(mastery.styles['Bebop Swing'].has100OnHighest, false);
  assert.equal(mastery.styles['Bebop Swing'].hasEver100, true);

  // Complete level 4 (Mastery of style)
  for (let lvl = 2; lvl <= 4; lvl++) {
    res = recordAdvancementToMastery(mastery, {
      styleName: 'Bebop Swing',
      completedLevel: lvl,
      maxLevel: 4,
      score: 100,
      bpm: 120,
    });
    mastery = res.mastery;
  }
  assert.equal(mastery.styles['Bebop Swing'].highestLevel, 4);
  assert.equal(mastery.styles['Bebop Swing'].has100OnHighest, true);
  assert.ok(mastery.trophies['first-style-mastered']);
  assert.ok(mastery.trophies['flawless-master']);
});

test('mastery evaluates milestones for multiple styles, speed, and secret awards', () => {
  let mastery = loadMastery({ getItem: () => null });

  // Fast loop at 170 BPM triggers Speed Demon
  let res = recordLoopToMastery(mastery, {
    styleName: 'Fast Bop',
    level: 2,
    maxLevel: 4,
    score: 92,
    bpm: 170,
    isPracticeOnly: false,
  });
  mastery = res.mastery;
  assert.ok(mastery.trophies['speed-demon']);

  // Secret trophy: Midnight Pocket at 100%
  res = recordLoopToMastery(mastery, {
    styleName: 'Midnight Pocket',
    level: 4,
    maxLevel: 4,
    score: 100,
    bpm: 96,
    isPracticeOnly: false,
  });
  mastery = res.mastery;
  assert.ok(mastery.trophies['secret-midnight-pocket']);

  // Master 5 styles
  for (let i = 1; i <= 5; i++) {
    recordAdvancementToMastery(mastery, {
      styleName: `Style ${i}`,
      completedLevel: 4,
      maxLevel: 4,
      score: 95,
      bpm: 100,
    });
  }
  evaluateTrophies(mastery);
  assert.ok(mastery.trophies['five-styles-mastered']);
});

test('four-level density guarantees bar minimums (L1 >= 1, L2 >= 2, L3 >= 3, L4 all) and strict nesting', () => {
  const style = createDemo();
  // 2 bars of multi-instrument backing with varying density
  const noteKey = n => `${n.tick}:${n.track}:${n.channel}:${n.pitch}`;
  for (const focus of ['drums', 'bass', 'chords', 'full']) {
    const l1 = buildExercise(style, { focus, level: 1, bars: 2 });
    const l2 = buildExercise(style, { focus, level: 2, bars: 2 });
    const l3 = buildExercise(style, { focus, level: 3, bars: 2 });
    const l4 = buildExercise(style, { focus, level: 4, bars: 2 });

    const set1 = new Set(l1.target.map(noteKey));
    const set2 = new Set(l2.target.map(noteKey));
    const set3 = new Set(l3.target.map(noteKey));
    const set4 = new Set(l4.target.map(noteKey));

    // Strict nesting: L1 <= L2 <= L3 <= L4
    for (const key of set1) assert.ok(set2.has(key), `${focus}: L1 note missing in L2`);
    for (const key of set2) assert.ok(set3.has(key), `${focus}: L2 note missing in L3`);
    for (const key of set3) assert.ok(set4.has(key), `${focus}: L3 note missing in L4`);

    // Per-bar density minimums
    for (let bar = 0; bar < 2; bar++) {
      const s = bar * l4.barTicks;
      const e = s + l4.barTicks;
      const count4 = l4.target.filter(n => n.tick >= s && n.tick < e).length;
      const count3 = l3.target.filter(n => n.tick >= s && n.tick < e).length;
      const count2 = l2.target.filter(n => n.tick >= s && n.tick < e).length;
      const count1 = l1.target.filter(n => n.tick >= s && n.tick < e).length;

      if (count4 >= 1) assert.ok(count1 >= 1, `${focus} bar ${bar}: L1 should have at least 1 note`);
      if (count4 >= 2) assert.ok(count2 >= 2, `${focus} bar ${bar}: L2 should have at least 2 notes`);
      if (count4 >= 3) assert.ok(count3 >= 3, `${focus} bar ${bar}: L3 should have at least 3 notes`);
      assert.equal(count4, l4.target.filter(n => n.tick >= s && n.tick < e).length);
    }

    // Strict progression when total source notes can support it
    if (l4.target.length >= 4) {
      assert.ok(l2.target.length > l1.target.length, `${focus}: L2 should have strictly more notes than L1`);
      assert.ok(l3.target.length > l2.target.length, `${focus}: L3 should have strictly more notes than L2`);
      assert.ok(l4.target.length > l3.target.length, `${focus}: L4 should have strictly more notes than L3`);
    }
  }
});

test('sparse styles with fewer than 3 notes clamp cleanly without throwing or fabricating notes', () => {
  const style = createDemo();
  // Bar with only 2 notes total
  style.notes = [
    { tick: 0, pitch: 36, duration: 60, channel: 1, track: 1, program: 33, velocity: 80 },
    { tick: 480, pitch: 40, duration: 60, channel: 1, track: 1, program: 33, velocity: 80 },
  ];
  const l1 = buildExercise(style, { focus: 'bass', level: 1, bars: 1 });
  const l2 = buildExercise(style, { focus: 'bass', level: 2, bars: 1 });
  const l3 = buildExercise(style, { focus: 'bass', level: 3, bars: 1 });
  const l4 = buildExercise(style, { focus: 'bass', level: 4, bars: 1 });

  assert.equal(l1.target.length, 1);
  assert.equal(l2.target.length, 2);
  assert.equal(l3.target.length, 2);
  assert.equal(l4.target.length, 2);
  // Nesting holds even when clamped
  assert.equal(l1.target[0].pitch, 36);
  assert.deepEqual(l2.target.map(n => n.pitch), [36, 40]);
});


