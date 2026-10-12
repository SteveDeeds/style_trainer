import test from 'node:test';
import assert from 'node:assert/strict';
import { pianoKeys, pianoTargets } from '../src/piano.js';
import { groupNotes } from '../src/training.js';
import { Transport } from '../src/transport.js';

const target = [
  { tick: 96, duration: 192, pitch: 60, isTarget: true, part: 'chords',
    pitchChanges: [{ tick: 192, action: 'pitch', pitch: 61 }] },
  { tick: 96, duration: 48, pitch: 64, isTarget: true, part: 'chords' },
  { tick: 300, duration: 80, pitch: 21, isTarget: true, part: 'bass' },
];
const exercise = { target, backing: [], groups: groupNotes(target), ppq: 96, durationTicks: 384,
  meter: { numerator: 4, denominator: 4 } };

test('piano spans all 88 sounding pitches from A0 to C8 with correct key geometry', () => {
  const keys = pianoKeys();
  assert.equal(keys.length, 88);
  assert.deepEqual(keys.map(key => key.pitch), Array.from({ length: 88 }, (_, index) => 21 + index));
  assert.equal(keys.filter(key => !key.black).length, 52);
  assert.equal(keys.filter(key => key.black).length, 36);
  assert.equal(keys[0].label, 'A0');
  assert.equal(keys.at(-1).label, 'C8');
  assert.equal(keys.find(key => key.pitch === 60).label, 'C4');
  assert.equal(keys[0].x, 0);
  assert.equal(keys[1].x, 14);
  assert.equal(keys[2].x, 20);
  assert.equal(keys.at(-1).x, 1020);
  assert.ok(keys.every(key => key.x >= 0 && key.x + key.width <= 1040));
});

test('piano shows first target while stopped or counting in and exact waiting Step chord', () => {
  assert.deepEqual(pianoTargets(exercise, { mode: 'stop', tick: 0 }), [60, 64]);
  assert.deepEqual(pianoTargets(exercise, { mode: 'record', tick: 0, countIn: true }), [60, 64]);
  assert.deepEqual(pianoTargets(exercise, { mode: 'step', tick: 192, waiting: { group: { pitches: [61, 65] } } }), [61, 65]);
  assert.deepEqual(pianoTargets({ target: [], groups: [] }, { mode: 'stop', tick: 0 }), []);
});

test('piano respects note lengths, rests, overlapping voices, and CASM retuning in Play and muted Record', () => {
  for (const mode of ['play', 'record', 'step']) {
    assert.deepEqual(pianoTargets(exercise, { mode, tick: 95 }), []);
    assert.deepEqual(pianoTargets(exercise, { mode, tick: 96 }), [60, 64]);
    assert.deepEqual(pianoTargets(exercise, { mode, tick: 144 }), [60]);
    assert.deepEqual(pianoTargets(exercise, { mode, tick: 192 }), [61]);
    assert.deepEqual(pianoTargets(exercise, { mode, tick: 288 }), []);
    assert.deepEqual(pianoTargets(exercise, { mode, tick: 300 }), [21]);
    assert.deepEqual(pianoTargets(exercise, { mode, tick: 384 }), []);
  }
  const notes = [
    { tick: 0, duration: 100, pitch: 60, pitchChanges: [{ tick: 40, action: 'retrigger', pitch: 65 }, { tick: 80, action: 'stop' }] },
    { tick: 0, duration: 60, pitch: 60 },
  ];
  const changed = { target: notes, groups: groupNotes(notes) };
  assert.deepEqual(pianoTargets(changed, { mode: 'play', tick: 39 }), [60]);
  assert.deepEqual(pianoTargets(changed, { mode: 'play', tick: 40 }), [60, 65]);
  assert.deepEqual(pianoTargets(changed, { mode: 'play', tick: 80 }), []);
});

test('real Step transport keeps the piano chord highlighted while partially matched, then advances and resets', () => {
  let now = 0;
  const transport = new Transport({ now: () => now, noteOn: () => {}, noteOff: () => {}, silence: () => {},
    guide: () => {}, onState: () => {}, onResult: () => {}, onLoop: () => {}, onError: error => { throw error; } });
  const pitches = () => pianoTargets(exercise, { mode: transport.mode, tick: transport.heardPosition(), waiting: transport.waiting });
  try {
    transport.start('step', exercise, 120);
    clearInterval(transport.timer);
    now = transport.origin + 96 * transport.msPerTick;
    transport.tick();
    assert.deepEqual(pitches(), [60, 64]);
    transport.input(60, true);
    now += 1000;
    transport.tick();
    assert.deepEqual(pitches(), [60, 64]);
    transport.input(64, true);
    transport.tick();
    now += 96 * transport.msPerTick;
    transport.tick();
    assert.deepEqual(pitches(), [61]);
    transport.stop();
    assert.deepEqual(pitches(), [60, 64]);
  } finally { transport.stop(); }
});
