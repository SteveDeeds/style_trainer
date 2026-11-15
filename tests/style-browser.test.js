import test from 'node:test';
import assert from 'node:assert/strict';
import { filterStyleRows, readRecentStyles, rememberRecentStyle, styleEntryKey, TEMPO_BANDS } from '../src/style-browser.js';

const rows = [
  { index: 0, entry: { name: 'Slow Ballad', category: 'Pop' }, profile: { level: 0, bpms: [70], meters: ['4/4'] } },
  { index: 1, entry: { name: 'Fast Waltz', category: 'Jazz' }, profile: { level: 2, bpms: [140], meters: ['3/4'] } },
  { index: 2, entry: { name: 'Medium Swing', category: 'Jazz' }, profile: { level: 1, bpms: [100], meters: ['4/4'] } },
  { index: 3, entry: { name: 'Pending', category: 'Pop' } },
];

test('search and toggle filters combine with OR within groups and AND across groups', () => {
  assert.equal(filterStyleRows(rows).length, 4);
  assert.deepEqual(filterStyleRows(rows, { search: 'jazz swing' }).map(row => row.index), [2]);
  assert.deepEqual(filterStyleRows(rows, {
    folders: new Set(['Jazz']), tempos: new Set(['andante', 'allegro']),
    meters: new Set(['4/4']), difficulties: new Set(['0', '1']),
  }).map(row => row.index), [2]);
  assert.deepEqual(filterStyleRows(rows, { difficulties: new Set(['pending']) }).map(row => row.index), [3]);
  assert.equal(filterStyleRows(rows, { tempos: new Set(['largo']) }).length, 0);
});

test('sorting uses numeric metadata and sends unrated sources to the end', () => {
  assert.deepEqual(filterStyleRows(rows, { sort: 'difficulty' }).map(row => row.index), [0, 2, 1, 3]);
  assert.deepEqual(filterStyleRows(rows, { sort: 'tempo' }).map(row => row.index), [0, 2, 1, 3]);
  assert.deepEqual(filterStyleRows(rows, { sort: 'folder' }).map(row => row.index), [1, 2, 3, 0]);
});

test('tempo ranges have no gaps or overlaps at integer BPM boundaries', () => {
  for (let bpm = 30; bpm <= 300; bpm++) {
    assert.equal(TEMPO_BANDS.filter(band => bpm >= band.min && bpm <= band.max).length, 1);
  }
});

test('recent history persists, deduplicates loads, and retains only the last ten sources', () => {
  const data = new Map();
  const storage = { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) };
  let recent = readRecentStyles(storage);
  for (let index = 0; index < 12; index++) recent = rememberRecentStyle(recent, `style-${index}`, storage);
  assert.equal(recent.length, 10);
  assert.equal(recent[0], 'style-11');
  assert.ok(!recent.includes('style-1'));
  recent = rememberRecentStyle(recent, 'style-5', storage);
  assert.equal(recent[0], 'style-5');
  assert.equal(recent.filter(key => key === 'style-5').length, 1);
  assert.deepEqual(readRecentStyles(storage), recent);
  assert.throws(() => readRecentStyles({ getItem: () => '{}' }), /Invalid recent/);
  assert.throws(() => rememberRecentStyle([], 'test', { setItem() { throw new Error('Denied'); } }), /Denied/);
});

test('Recent intersects other filters without confusing duplicate names in different folders', () => {
  const recent = [styleEntryKey(rows[0].entry), styleEntryKey(rows[2].entry)];
  assert.deepEqual(filterStyleRows(rows, { recentOnly: true, recent }).map(row => row.index), [2, 0]);
  assert.deepEqual(filterStyleRows(rows, { recentOnly: true, recent, folders: new Set(['Jazz']) }).map(row => row.index), [2]);
  assert.equal(filterStyleRows(rows, { recentOnly: true }).length, 0);
  assert.notEqual(styleEntryKey({ name: 'Same', category: 'A', relativePath: 'A/Same.sty' }),
    styleEntryKey({ name: 'Same', category: 'B', relativePath: 'B/Same.sty' }));
});
