export const TEMPO_BANDS = [
  { id: 'largo', label: 'Largo', min: 0, max: 59 },
  { id: 'adagio', label: 'Adagio', min: 60, max: 75 },
  { id: 'andante', label: 'Andante', min: 76, max: 107 },
  { id: 'moderato', label: 'Moderato', min: 108, max: 119 },
  { id: 'allegro', label: 'Allegro', min: 120, max: 167 },
  { id: 'presto', label: 'Presto', min: 168, max: Infinity },
];

export const RECENT_STYLES_KEY = 'style-trainer-recent-styles-v1';
export const styleEntryKey = entry => JSON.stringify([
  entry.category || '', entry.name, entry.relativePath || entry.url || '',
]);

export function readRecentStyles(storage = globalThis.localStorage) {
  const value = JSON.parse(storage.getItem(RECENT_STYLES_KEY) || '[]');
  if (!Array.isArray(value) || value.some(key => typeof key !== 'string')) {
    throw new Error('Invalid recent styles history.');
  }
  return [...new Set(value)].slice(0, 10);
}

export function rememberRecentStyle(recent, key, storage = globalThis.localStorage) {
  const next = [key, ...recent.filter(previous => previous !== key)].slice(0, 10);
  storage.setItem(RECENT_STYLES_KEY, JSON.stringify(next));
  return next;
}

export function filterStyleRows(rows, { search = '', folders = new Set(), tempos = new Set(),
  meters = new Set(), difficulties = new Set(), sort = 'name', recentOnly = false, recent = [] } = {}) {
  const terms = search.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return rows.filter(row => {
    if (recentOnly && !recent.includes(styleEntryKey(row.entry))) return false;
    const text = `${row.entry.name} ${row.entry.category} ${row.entry.relativePath || ''}`.toLowerCase();
    if (!terms.every(term => text.includes(term))) return false;
    if (folders.size && !folders.has(row.entry.category)) return false;
    if (difficulties.size && !difficulties.has(row.profile?.level === undefined || row.profile?.level === null ? 'pending' : String(row.profile.level))) return false;
    if (meters.size && !row.profile?.meters?.some(meter => meters.has(meter))) return false;
    if (tempos.size && !row.profile?.bpms?.some(bpm => TEMPO_BANDS.some(band =>
      tempos.has(band.id) && bpm >= band.min && bpm <= band.max))) return false;
    return true;
  }).sort((a, b) => {
    let difference = 0;
    if (sort === 'tempo') difference = (a.profile?.bpms?.[0] ?? Infinity) - (b.profile?.bpms?.[0] ?? Infinity);
    if (sort === 'difficulty') difference = (a.profile?.level ?? Infinity) - (b.profile?.level ?? Infinity);
    if (sort === 'folder') difference = a.entry.category.localeCompare(b.entry.category);
    if (sort === 'meter') difference = (a.profile?.meters?.[0] || '~').localeCompare(b.profile?.meters?.[0] || '~', undefined, { numeric: true });
    return difference || a.entry.name.localeCompare(b.entry.name, undefined, { numeric: true }) || a.index - b.index;
  });
}
