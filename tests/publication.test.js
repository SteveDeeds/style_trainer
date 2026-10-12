import test from 'node:test';
import assert from 'node:assert/strict';
import { assetUrl } from '../src/assets.js';
import { cacheKey, downloadSounds, validateStarter } from '../src/soundfont-cache.js';

test('public resources use the project prefix and preserve encoded file names', () => {
  for (const path of ['/synth/fluid.js', 'synth/fluid.js']) assert.equal(assetUrl(path, '/style_trainer/'), '/style_trainer/synth/fluid.js');
  assert.equal(assetUrl('/styles/Rock%20%26%20Roll.sty', '/style_trainer/'), '/style_trainer/styles/Rock%20%26%20Roll.sty');
  assert.equal(assetUrl('/library.json', '/'), '/library.json');
  assert.throws(() => assetUrl('https://example.com/file.sf2'), /site-relative/);
});

test('starter validation checks both SoundFont format and pinned integrity', async () => {
  const bytes = new TextEncoder().encode('RIFF0000sfbk1234');
  const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
  await validateStarter(bytes.buffer, { sha256 });
  await validateStarter(bytes.buffer, { sha256: sha256.toUpperCase() });
  await assert.rejects(validateStarter(bytes.buffer, { sha256: 'incorrect' }), /integrity/);
  await assert.rejects(validateStarter(new ArrayBuffer(12), { sha256 }), /valid .sf2/);
  assert.notEqual(cacheKey({ version: '1', sha256 }), cacheKey({ version: '2', sha256 }));
  assert.equal(cacheKey({ version: '1', sha256 }), cacheKey({ version: '1', sha256: sha256.toUpperCase() }));
});

test('starter download reports bytes, rejects HTTP errors and supports cancellation', async () => {
  const signal = new AbortController().signal;
  const progress = [];
  const buffer = await downloadSounds('/font.sf2', signal, (...args) => progress.push(args),
    async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-length': '3' } }));
  assert.deepEqual([...new Uint8Array(buffer)], [1, 2, 3]);
  assert.deepEqual(progress.at(-1), [3, 3]);
  await assert.rejects(downloadSounds('/font.sf2', signal, () => {}, async () => new Response(null, { status: 404 })), /HTTP 404/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(downloadSounds('/font.sf2', controller.signal, () => {}, async () => new Response(new Uint8Array([1]))), { name: 'AbortError' });
});
