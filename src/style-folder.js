const supportedStyle = /\.(mid|midi|sty|prs|sst)$/i;
const databaseName = 'style-trainer-folders';

async function storedFolder(mode, operation) {
  if (!globalThis.indexedDB) throw new Error('Browser storage is unavailable.');
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    let blocked = false;
    request.onupgradeneeded = () => request.result.createObjectStore('folders');
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      blocked = true;
      reject(new Error('Remembered folder storage is blocked. Close other Style Trainer tabs and retry.'));
    };
    request.onsuccess = () => {
      if (blocked) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
  try {
    return await new Promise((resolve, reject) => {
      const tx = database.transaction('folders', mode);
      let request;
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error ?? new Error('Remembered folder operation was aborted.'));
      tx.onerror = () => reject(tx.error ?? new Error('Remembered folder operation failed.'));
      try { request = operation(tx.objectStore('folders')); }
      catch (error) { tx.abort(); reject(error); }
    });
  } finally { database.close(); }
}

export const readStyleFolder = () => storedFolder('readonly', store => store.get('selected'));
export const saveStyleFolder = handle => storedFolder('readwrite', store => store.put(handle, 'selected'));
export const forgetStyleFolder = () => storedFolder('readwrite', store => store.delete('selected'));

export async function folderPermission(handle, request = false) {
  const options = { mode: 'read' };
  if (await handle.queryPermission(options) === 'granted') return true;
  return request && await handle.requestPermission(options) === 'granted';
}

function entry(name, relativePath, fileSource) {
  return {
    name: name.replace(supportedStyle, ''),
    category: `Folder · ${relativePath.includes('/') ? relativePath.slice(0, relativePath.lastIndexOf('/')) : 'Root'}`,
    relativePath,
    ...fileSource,
  };
}

const sorted = entries => entries.sort((a, b) =>
  a.category.localeCompare(b.category) || a.name.localeCompare(b.name) || a.relativePath.localeCompare(b.relativePath));

export async function scanStyleFolder(handle) {
  const entries = [];
  async function visit(directory, prefix) {
    for await (const child of directory.values()) {
      const relativePath = prefix + child.name;
      if (child.kind === 'directory') await visit(child, `${relativePath}/`);
      else if (child.kind === 'file' && supportedStyle.test(child.name)) {
        entries.push(entry(child.name, relativePath, { handle: child }));
      }
    }
  }
  await visit(handle, '');
  return sorted(entries);
}

export function stylesFromFiles(files) {
  return sorted([...files].filter(file => supportedStyle.test(file.name)).map(file =>
    entry(file.name, file.webkitRelativePath || file.name, { file })));
}

export async function readStyleEntry(entry, fetcher = fetch) {
  if (entry.handle || entry.file) {
    const file = entry.file ?? await entry.handle.getFile();
    if (file.size > 32 * 1024 * 1024) throw new Error(`Style is larger than 32 MiB: ${file.name}`);
    return { buffer: await file.arrayBuffer(), name: file.name };
  }
  const response = await fetcher(entry.url);
  if (!response.ok) throw new Error(`Style could not be loaded (HTTP ${response.status}): ${entry.name}`);
  return { buffer: await response.arrayBuffer(), name: `${entry.name}.sty` };
}
