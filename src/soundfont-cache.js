const databaseName = 'style-trainer-sounds';
const storeName = 'starter';

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error('Browser storage is unavailable.')); return; }
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName);
    let blocked = false;
    request.onsuccess = () => {
      if (blocked) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      blocked = true;
      reject(new Error('Saved sounds are blocked by another tab. Close other Style Trainer tabs and retry.'));
    };
  });
}

async function transaction(mode, operation) {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = database.transaction(storeName, mode);
      let request;
      try { request = operation(tx.objectStore(storeName)); }
      catch (error) { tx.abort(); reject(error); return; }
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error ?? new Error('Saved-sounds transaction was aborted.'));
      tx.onerror = () => reject(tx.error ?? new Error('Saved-sounds transaction failed.'));
    });
  } finally { database.close(); }
}

export const cacheKey = font => `${font.version}:${font.sha256.toLowerCase()}`;
export const readSavedSounds = font => transaction('readonly', store => store.get(cacheKey(font)));
export const saveSounds = (font, buffer) => transaction('readwrite', store => {
  store.clear();
  return store.put(buffer, cacheKey(font));
});
export const clearSavedSounds = () => transaction('readwrite', store => store.clear());

export async function validateStarter(buffer, font) {
  const header = new Uint8Array(buffer, 0, Math.min(12, buffer.byteLength));
  if (String.fromCharCode(...header.slice(0, 4)) !== 'RIFF' ||
      String.fromCharCode(...header.slice(8, 12)) !== 'sfbk') {
    throw new Error('Starter sounds are not a valid .sf2 file.');
  }
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
  if (hash !== font.sha256.toLowerCase()) throw new Error('Starter sounds failed the integrity check. Please retry.');
}

export async function downloadSounds(url, signal, onProgress, fetcher = fetch) {
  const response = await fetcher(url, { signal });
  if (!response.ok) throw new Error(`Starter sounds could not be downloaded (HTTP ${response.status}).`);
  const total = Number(response.headers.get('content-length')) || 0;
  if (!response.body) {
    const buffer = await response.arrayBuffer();
    signal.throwIfAborted();
    onProgress(buffer.byteLength, total);
    return buffer;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.byteLength;
      onProgress(size, total);
    }
  } finally { reader.releaseLock(); }
  signal.throwIfAborted();
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes.buffer;
}
