import test from 'node:test';
import assert from 'node:assert/strict';
import { folderPermission, readStyleEntry, scanStyleFolder, stylesFromFiles } from '../src/style-folder.js';

const directory = (name, children) => ({
  name, kind: 'directory',
  async *values() { yield* children; },
});
const file = name => ({ name, kind: 'file', getFile() { throw new Error('Scanning must not read file contents'); } });

test('folder scanning recursively groups supported files without reading them', async () => {
  const entries = await scanStyleFolder(directory('Styles', [
    file('root.STY'), file('ignore.bcs'), file('license.txt'),
    directory('Pop', [file('Rock.prs'), directory('Slow', [file('Ballad.sst')])]),
    directory('Jazz', [file('Rock.mid'), file('Swing.midi')]),
  ]));
  assert.equal(entries.length, 5);
  assert.deepEqual(entries.map(entry => entry.relativePath), ['Jazz/Rock.mid', 'Jazz/Swing.midi', 'Pop/Rock.prs', 'Pop/Slow/Ballad.sst', 'root.STY']);
  assert.equal(entries[2].category, 'Folder · Pop');
  assert.equal(entries.at(-1).category, 'Folder · Root');
  assert.equal(entries[0].name, 'Rock');
});

test('folder fallback keeps file objects and groups relative paths', () => {
  const files = [{ name: 'Rock.sty', webkitRelativePath: 'Styles/Pop/Rock.sty' }, { name: 'Archive.zip' }];
  const entries = stylesFromFiles(files);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].file, files[0]);
  assert.equal(entries[0].category, 'Folder · Styles/Pop');
});

test('permission prompts happen only on explicit restore and request read-only access', async () => {
  let requests = 0;
  const handle = {
    async queryPermission(options) { assert.deepEqual(options, { mode: 'read' }); return 'prompt'; },
    async requestPermission(options) { assert.deepEqual(options, { mode: 'read' }); requests++; return 'granted'; },
  };
  assert.equal(await folderPermission(handle), false);
  assert.equal(requests, 0);
  assert.equal(await folderPermission(handle, true), true);
  assert.equal(requests, 1);
  handle.requestPermission = async () => 'denied';
  assert.equal(await folderPermission(handle, true), false);
});

test('entries read selected local files without fetch and reject missing or oversized files', async () => {
  const buffer = new ArrayBuffer(10);
  const local = { name: 'Test.sty', size: 10, async arrayBuffer() { return buffer; } };
  const noFetch = () => { throw new Error('Local styles must not be fetched or uploaded'); };
  assert.deepEqual(await readStyleEntry({ handle: { getFile: async () => local } }, noFetch), { name: 'Test.sty', buffer });
  assert.deepEqual(await readStyleEntry({ file: local }, noFetch), { name: 'Test.sty', buffer });
  await assert.rejects(readStyleEntry({ file: { ...local, size: 33 * 1024 * 1024 } }, noFetch), /32 MiB/);
  await assert.rejects(readStyleEntry({ handle: { getFile: async () => { throw new Error('Permission revoked'); } } }, noFetch), /Permission revoked/);
});

test('hosted entries retain their URL and report HTTP failures', async () => {
  const entry = { url: '/style_trainer/styles/test.sty', name: 'Test' };
  const data = await readStyleEntry(entry, async url => {
    assert.equal(url, entry.url);
    return new Response(new Uint8Array([1, 2]));
  });
  assert.equal(data.name, 'Test.sty');
  assert.equal(data.buffer.byteLength, 2);
  await assert.rejects(readStyleEntry(entry, async () => new Response(null, { status: 404 })), /HTTP 404/);
});

test('unreadable subfolders fail explicitly instead of silently giving an incomplete library', async () => {
  await assert.rejects(scanStyleFolder(directory('Styles', [{
    name: 'Blocked', kind: 'directory', async *values() { throw new Error('Access denied'); },
  }])), /Access denied/);
});
