import test from 'node:test';
import assert from 'node:assert/strict';
import { DRUM_NOTATION, drumNotation } from '../src/drum-notation.js';
import { buildNotationVoice, notationStaves } from '../src/notation.js';

function exerciseFor(pitches, simultaneous = false) {
  const target = pitches.map((pitch, index) => ({
    pitch, tick: simultaneous ? 0 : index * 480, duration: 480, part: 'drums',
  }));
  return {
    target, ppq: 480, barTicks: 1920, bars: Math.ceil(pitches.length / 4),
    meter: { numerator: 4, denominator: 4 }, chords: [],
  };
}

test('cross-stick shares the snare space but not its notehead or MIDI identity', () => {
  const exercise = exerciseFor([37, 38, 40]);
  const before = structuredClone(exercise);
  const entries = buildNotationVoice(exercise, notationStaves(exercise.target)[0], 0, 'C').entries;
  assert.deepEqual(entries.map(entry => entry.note.getKeys()), [['c/5/x2'], ['c/5'], ['c/5']]);
  assert.equal(entries[0].note.getKeyProps()[0].code, 'noteheadXBlack');
  assert.notEqual(entries[1].note.getKeyProps()[0].code, 'noteheadXBlack');
  assert.deepEqual(entries.map(entry => entry.pitches), [[37], [38], [40]]);
  assert.deepEqual(exercise, before);
});

test('all GM percussion notes have a valid explicit rendering and auxiliary labels', () => {
  for (let pitch = 35; pitch <= 81; pitch++) {
    assert.ok(DRUM_NOTATION[pitch], `GM ${pitch} is mapped`);
    const exercise = exerciseFor([pitch]);
    const entry = buildNotationVoice(exercise, notationStaves(exercise.target)[0], 0, 'C').entries[0];
    assert.equal(entry.note.getKeys()[0], drumNotation(pitch).key);
    assert.deepEqual(entry.pitches, [pitch]);
    if (drumNotation(pitch).label) assert.ok(entry.note.getModifiers().some(modifier =>
      modifier.getCategory() === 'Annotation'));
  }
});

test('toms have six distinct ascending positions and cymbals are distinguished from drums', () => {
  const toms = [41, 43, 45, 47, 48, 50].map(pitch => drumNotation(pitch).key);
  assert.equal(new Set(toms).size, 6);
  assert.ok(toms.every(key => !key.includes('/x')));
  for (const pitch of [42, 44, 46, 49, 51, 52, 55, 57, 59]) {
    assert.ok(drumNotation(pitch).key.includes('/x'));
  }
  assert.equal(drumNotation(53).key, 'f/5/d2');
  assert.equal(drumNotation(51).key, 'f/5/x2');
});

test('simultaneous snare and side stick retain both sources and heads', () => {
  const exercise = exerciseFor([37, 38], true);
  const entry = buildNotationVoice(exercise, notationStaves(exercise.target)[0], 0, 'C').entries[0];
  assert.deepEqual(entry.note.getKeys(), ['c/5/x2', 'c/5']);
  assert.deepEqual(entry.pitches, [37, 38]);
  assert.equal(entry.sources.length, 2);
});

test('kit-dependent unmapped sounds are explicitly labeled instead of appearing as anonymous toms', () => {
  const descriptor = drumNotation(87);
  assert.match(descriptor.name, /Unmapped.*87.*kit-dependent/);
  const exercise = exerciseFor([87]);
  const entry = buildNotationVoice(exercise, notationStaves(exercise.target)[0], 0, 'C').entries[0];
  assert.ok(entry.note.getModifiers().some(modifier => modifier.getCategory() === 'Annotation'));
});
