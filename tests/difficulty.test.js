import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeDifficulty, difficultyLabel } from '../src/difficulty.js';

const note = (tick, channel = 11, pitch = 60, duration = 1) => ({
  tick, channel, track: channel, pitch, duration, program: 0, bank: 0,
});
const fixture = (notes, end = 1920) => ({
  ppq: 480, notes, sourceType: 'style',
  tempos: [{ tick: 0, bpm: 120 }],
  sections: [{ name: 'Main A', start: 0, end }],
});
const repeated = (gap, count = 16) => Array.from({ length: count }, (_, index) => note(index * gap));

test('difficulty uses attack spacing, not staccato duration, at exact eighth/sixteenth/thirty-second thresholds', () => {
  for (const [gap, expected] of [[960, 'Easy'], [240, 'Easy'], [120, 'Medium'], [60, 'Hard'], [30, 'Hard']]) {
    const notes = repeated(gap);
    assert.equal(difficultyLabel(analyzeDifficulty(fixture(notes, gap * notes.length))), expected);
    assert.equal(difficultyLabel(analyzeDifficulty(fixture(notes.map(note => ({ ...note, duration: 1000 })), gap * notes.length))), expected);
  }
  assert.throws(() => analyzeDifficulty({ ...fixture([]), ppq: 0 }), /positive MIDI/);
});

test('occasional harder fills are separate from recurring difficulty', () => {
  const notes = repeated(240, 40);
  notes.push(note(60));
  assert.equal(difficultyLabel(analyzeDifficulty(fixture(notes, 9600))), 'Easy · Hard fills');
  const recurring = repeated(240, 10);
  recurring.push(note(60), note(120), note(180), note(300), note(360), note(420));
  assert.equal(difficultyLabel(analyzeDifficulty(fixture(recurring, 2400))), 'Hard');
});

test('tracks are measured independently and section/style ratings use the hardest playable track', () => {
  const first = repeated(240).flatMap(note => [note, { ...note, tick: note.tick + 60, channel: 12, track: 12 }]);
  const later = repeated(120).map(note => ({ ...note, tick: note.tick + 3840, channel: 13, track: 13 }));
  const style = fixture([...first, ...later], 3840);
  style.sections.push({ name: 'Main B', start: 3840, end: 5760 }, { name: 'Silent', start: 5760, end: 7680 });
  const result = analyzeDifficulty(style);
  assert.equal(difficultyLabel(result), 'Medium');
  assert.equal(difficultyLabel(result.sections[0]), 'Easy');
  assert.equal(difficultyLabel(result.sections[1]), 'Medium');
  assert.equal(difficultyLabel(result.sections[2]), 'N/A');
  assert.deepEqual(result.sections[2].tracks, []);
  assert.equal(result.sections[0].tracks.length, 2);
  assert.equal(result.sections[1].tracks.length, 1);
  assert.equal(difficultyLabel(result.sections[1].parts.pad), 'Medium');
  assert.equal(difficultyLabel(result.sections[1].parts.bass), 'N/A');
});

test('tempo and coordination explain difficulty without adding score points', () => {
  const notes = repeated(160).flatMap(note => [note, { ...note, pitch: 67 }, { ...note, pitch: 72 }]);
  const style = fixture(notes, 2560);
  style.tempos = [{ tick: 0, bpm: 70 }, { tick: 480, bpm: 140 }];
  const result = analyzeDifficulty(style);
  assert.equal(difficultyLabel(result), 'Easy', 'Eighth-note triplets use the eighth-note tier');
  const details = result.sections[0].tracks[0].details.join(' · ');
  assert.match(details, /70-140 BPM/);
  assert.match(details, /triplet\/swing/);
  assert.match(details, /3 simultaneous notes/);
  assert.match(details, /offbeat/);
  assert.match(details, /attacks\/sec/);
  assert.match(details, /12-semitone range/);
});

test('short loop-boundary returns are rated and single isolated notes are Easy', () => {
  const notes = [note(0), note(420)];
  const rating = analyzeDifficulty(fixture(notes, 480));
  assert.equal(difficultyLabel(rating), 'Easy · Hard fills');
  assert.equal(difficultyLabel(analyzeDifficulty(fixture([note(0)]))), 'Easy');
  assert.equal(difficultyLabel(analyzeDifficulty(fixture([note(0)], 60))), 'Hard', 'A one-note thirty-second loop still repeats rapidly');
  assert.equal(difficultyLabel(analyzeDifficulty(fixture([note(0), note(60)], 120))), 'Hard', 'An entirely fast two-note loop is recurring, not a rare fill');
  const jumps = analyzeDifficulty(fixture([note(0), note(240, 11, 84)], 480));
  assert.ok(jumps.sections[0].tracks[0].details.includes('octave-or-larger jumps'));
});

test('humanized eighths, rolled chords, and swing do not masquerade as thirty-second runs', () => {
  const eighths = repeated(240).map((note, index) => ({ ...note, tick: note.tick + (index % 2 ? 12 : 0) }));
  const rolled = eighths.flatMap(note => [note, { ...note, tick: note.tick + 10, pitch: 67 }]);
  assert.equal(difficultyLabel(analyzeDifficulty(fixture(rolled, 3840))), 'Easy');
  const swing = repeated(480).flatMap(note => [note, { ...note, tick: note.tick + 320 }]);
  assert.equal(difficultyLabel(analyzeDifficulty(fixture(swing, 7680))), 'Easy');
});

test('hard fills stay separate from easy Main-section grooves', () => {
  const style = fixture(repeated(240, 16), 3840);
  style.notes.push(...repeated(60, 16).map(note => ({ ...note, tick: note.tick + 3840 })));
  style.sections.push({ name: 'Fill In AA', start: 3840, end: 4800 });
  assert.equal(difficultyLabel(analyzeDifficulty(style)), 'Easy · Hard fills');
  assert.equal(difficultyLabel(analyzeDifficulty(style).sections[1]), 'Hard');
});
