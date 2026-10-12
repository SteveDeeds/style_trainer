import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { parseCasm, sourceHarmony, transposeYamaha } from '../src/yamaha.js';
import { parseMidi } from '../src/midi.js';
import { buildExercise, practiceExercise, randomHarmony, LoopScore } from '../src/training.js';

const chunk = (tag, data) => {
  const header = Buffer.alloc(8);
  header.write(tag);
  header.writeUInt32BE(data.length, 4);
  return Buffer.concat([header, Buffer.from(data)]);
};
function ctab(channel, { destination = channel, root = 0, chord = 2, ntr = 0, ntt = 3, highKey = 11, low = 0, high = 127 } = {}) {
  const data = Buffer.alloc(27);
  data[0] = channel;
  data.write('Part    ', 1);
  data[9] = destination;
  data.set([root, chord, ntr, ntt, highKey, low, high, 1, 0], 18);
  return chunk('Ctab', data);
}
const casm = children => chunk('CASM', chunk('CSEG', Buffer.concat(children)));
const sectionNames = names => chunk('Sdec', Buffer.from(names));
const am7 = randomHarmony('C', 1, () => 5 / 7)[0];

test('CASM source root/chord, channel routing and NTR/NTT use documented offsets', () => {
  const bytes = casm([sectionNames('Main A,Main B'), ctab(3, { destination: 10, root: 2, chord: 10, ntr: 1, ntt: 2, highKey: 7, low: 28, high: 60 })]);
  const [group] = parseCasm(bytes, 0);
  assert.deepEqual(group.sections, ['Main A', 'Main B']);
  const policy = group.channels[3];
  assert.equal(policy.destination, 10);
  assert.equal(sourceHarmony(policy).name, 'Dm7');
  assert.deepEqual(policy.ranges[0], { ntr: 1, ntt: 'Chord', bassOn: false, highKey: 7, lowLimit: 28, highLimit: 60, rtr: 1 });
  assert.throws(() => parseCasm(bytes.subarray(0, bytes.length - 1), 0), /Truncated/);
});
test('Cntt overrides and Ctb2 pitch ranges are decoded independently', () => {
  const [legacy] = parseCasm(casm([sectionNames('Main A'), ctab(10), chunk('Cntt', [10, 0x87])]), 0);
  assert.equal(legacy.channels[10].ranges[0].ntt, 'Natural Minor');
  assert.equal(legacy.channels[10].ranges[0].bassOn, true);
  const data = Buffer.alloc(40);
  data[0] = 13; data[9] = 13; data[19] = 2;
  data[20] = 48; data[21] = 72;
  data.set([1, 0, 11, 0, 127, 0], 22);
  data.set([1, 2, 11, 0, 127, 1], 28);
  data.set([0, 0x81, 11, 0, 127, 3], 34);
  const [modern] = parseCasm(casm([sectionNames('Main B'), chunk('Ctb2', data)]), 0);
  const policy = modern.channels[13];
  assert.equal(transposeYamaha({ pitch: 36, yamaha: policy }, am7), 36);
  assert.equal(transposeYamaha({ pitch: 60, yamaha: policy }, am7), 60);
  assert.equal(transposeYamaha({ pitch: 76, yamaha: policy }, am7), 84);
  assert.equal(policy.ranges[2].bassOn, true);
});
test('Root Trans Bass uses one authored source chord, with key-aware diatonic movement', () => {
  const [group] = parseCasm(casm([sectionNames('Main A'), ctab(10)]), 0);
  const policy = group.channels[10];
  assert.deepEqual([24, 28, 31, 33].map(pitch => transposeYamaha({ pitch, yamaha: policy }, am7)), [33, 36, 40, 41]);
  const fmaj7 = randomHarmony('C', 1, () => 3 / 7)[0];
  assert.deepEqual([48, 52, 55, 57].map(pitch => transposeYamaha({ pitch, yamaha: policy }, fmaj7)), [53, 57, 60, 62]);
});
test('Root Fixed Chord keeps piano register, drums and bypass stay unchanged', () => {
  const [group] = parseCasm(casm([sectionNames('Main A'), ctab(13, { ntr: 1, ntt: 2 }), ctab(9), ctab(15, { ntt: 0 })]), 0);
  const fmaj7 = randomHarmony('C', 1, () => 3 / 7)[0];
  assert.deepEqual([60, 64, 67].map(pitch => transposeYamaha({ pitch, yamaha: group.channels[13] }, fmaj7)), [60, 64, 69]);
  for (const pitch of [33, 36, 37, 42]) assert.equal(transposeYamaha({ pitch, yamaha: group.channels[9] }, am7), pitch);
  assert.equal(transposeYamaha({ pitch: 60, yamaha: group.channels[15] }, am7), 60);
});
test('High Key folds by destination root and limits move by octaves, not clamping pitch classes', () => {
  const [group] = parseCasm(casm([sectionNames('Main A'), ctab(10, { highKey: 5, low: 36, high: 60 })]), 0);
  const f = randomHarmony('C', 1, () => 3 / 7)[0];
  const g = randomHarmony('C', 1, () => 4 / 7)[0];
  assert.equal(transposeYamaha({ pitch: 48, yamaha: group.channels[10] }, f), 53);
  assert.equal(transposeYamaha({ pitch: 48, yamaha: group.channels[10] }, g), 43);
  assert.equal(transposeYamaha({ pitch: 24, yamaha: group.channels[10] }, f), 41);
  const guitar = structuredClone(group.channels[10]);
  guitar.ranges[0].ntr = 2;
  assert.throws(() => transposeYamaha({ pitch: 60, yamaha: guitar }, am7), /Unsupported Yamaha/);
});
test('MIDI parser associates section-specific source-channel policies with notes', () => {
  const events = Buffer.from([
    0, 0xff, 6, 6, ...Buffer.from('Main A'),
    0, 0x93, 48, 80, 96, 0x83, 48, 0,
    0, 0xff, 6, 6, ...Buffer.from('Main B'),
    0, 0x93, 50, 80, 96, 0x83, 50, 0, 0, 0xff, 0x2f, 0,
  ]);
  const header = Buffer.from([0, 0, 0, 1, 0, 96]);
  const bytes = Buffer.concat([chunk('MThd', header), chunk('MTrk', events),
    chunk('CASM', Buffer.concat([
      chunk('CSEG', Buffer.concat([sectionNames('Main A'), ctab(3, { destination: 10 })])),
      chunk('CSEG', Buffer.concat([sectionNames('Main B'), ctab(3, { destination: 10, root: 2 })])),
    ])),
  ]);
  const style = parseMidi(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
  assert.equal(style.notes[0].yamaha.sourceRoot, 0);
  assert.equal(style.notes[1].yamaha.sourceRoot, 2);
  assert.equal(style.key, 'Unknown');
  assert.deepEqual(buildExercise(style, { trackId: '0:3', bars: 1, level: 1 }).chords, ['Cmaj7']);
  assert.equal(buildExercise(style, { section: 1, trackId: '0:3', bars: 1, level: 1 }).focus, 'bass');
  delete style.notes[0].yamaha;
  assert.throws(() => buildExercise(style, { trackId: '0:3', bars: 1, harmony: [am7] }), /Missing Yamaha CASM policy/);
});

const rockPath = new URL('../public/styles/Pop&Rock/RocknRoll.sty', import.meta.url);
test('RocknRoll Track 1 bass: Cmaj7 source and Am7 targets, backing, density and scoring agree', { skip: !existsSync(rockPath) }, () => {
  const bytes = readFileSync(rockPath);
  const style = parseMidi(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length), 'RocknRoll.sty');
  const before = structuredClone(style);
  const source = buildExercise(style, { trackId: '0:10', level: 4 });
  assert.deepEqual(source.chords, Array(4).fill('Cmaj7'));
  assert.deepEqual(source.target.map(note => note.pitch), Array(4).fill([24, 28, 31, 33]).flat());
  const harmony = Array(4).fill(am7);
  const changed = buildExercise(style, { trackId: '0:10', level: 4, harmony });
  assert.deepEqual(changed.chords, Array(4).fill('Am7'));
  assert.deepEqual(changed.target.map(note => note.pitch), Array(4).fill([33, 36, 40, 41]).flat());
  const withoutPitch = notes => notes.map(({ pitch, ...note }) => note);
  assert.deepEqual(withoutPitch(changed.target), withoutPitch(source.target));
  assert.deepEqual(changed.backing.filter(note => note.part === 'drums'), source.backing.filter(note => note.part === 'drums'));
  const otherTrack = buildExercise(style, { trackId: '0:13', level: 4, harmony });
  assert.deepEqual(otherTrack.backing.filter(note => note.channel === 10).map(note => note.pitch), changed.target.map(note => note.pitch));
  const simple = buildExercise(style, { trackId: '0:10', level: 1, harmony });
  assert.equal(simple.target.length, 4);
  assert.ok(simple.target.every(note => note.pitch % 12 === 9));
  const score = new LoopScore(changed.groups, 1, 0, 100);
  changed.groups.forEach(group => group.pitches.forEach(pitch => score.input(pitch, group.tick)));
  assert.equal(score.result().score, 100);
  assert.equal(practiceExercise(changed, { bpm: 158, normalBpm: 158 }).practiceOnly, false);
  assert.deepEqual(practiceExercise(changed, { bar: 1, bpm: 158, normalBpm: 158 }).target.map(note => note.pitch), [33, 36, 40, 41]);
  assert.deepEqual(style, before);
  assert.deepEqual(buildExercise(style, { trackId: '0:10', level: 4 }), source);
});
