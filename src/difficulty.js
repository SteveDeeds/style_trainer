import { partOf, STYLE_PARTS, stylePartOf, styleTracks, trackIdOf } from './training.js';

const labels = ['Easy', 'Medium', 'Hard'];
const epsilon = 1 / 192;
export const DIFFICULTY_VERSION = 3;
const tierOf = beats => {
  if (Math.abs(beats - 1 / 3) <= .035) return 0;
  if (Math.abs(beats - 1 / 6) <= .02) return 1;
  return beats >= .44 ? 0 : beats >= .21 ? 1 : 2;
};

export function difficultyLabel(rating) {
  if (!rating || rating.level === null) return 'N/A';
  const label = labels[rating.level];
  return rating.peak > rating.level ? `${label} · ${labels[rating.peak]} fills` : label;
}

function rollup(ratings) {
  const playable = ratings.filter(rating => rating.level !== null);
  return playable.length ? {
    level: Math.max(...playable.map(rating => rating.level)),
    peak: Math.max(...playable.map(rating => rating.peak)),
  } : { level: null, peak: null };
}

function trackDifficulty(notes, style, section) {
  const groups = new Map();
  let attack;
  for (const note of [...notes].sort((a, b) => a.tick - b.tick)) {
    if (attack === undefined || note.tick - attack > style.ppq / 32) {
      attack = note.tick;
      groups.set(attack, []);
    }
    groups.get(attack).push(note);
  }
  const onsets = [...groups.keys()].sort((a, b) => a - b);
  const gaps = onsets.slice(1).map((tick, index) => (tick - onsets[index]) / style.ppq);
  // Include the return to the first onset: these sections are practiced as loops.
  const wrap = (section.end - onsets.at(-1) + onsets[0] - section.start) / style.ppq;
  if (wrap > epsilon) gaps.push(wrap);
  const tiers = gaps.map(tierOf);
  let level = tiers.length === 1 ? tiers[0] : 0;
  for (let tier = 1; tier <= 2; tier++) {
    const count = tiers.filter(value => value >= tier).length;
    if ((count >= 3 || count === tiers.length) && count / tiers.length >= .35) level = tier;
  }
  const peak = tiers.reduce((highest, tier) => Math.max(highest, tier), 0);
  const details = [];
  const tempos = (style.tempos || []).filter(tempo => tempo.tick < section.end);
  const initial = tempos.filter(tempo => tempo.tick <= section.start).at(-1)?.bpm ?? 120;
  const bpms = [initial, ...tempos.filter(tempo => tempo.tick > section.start).map(tempo => tempo.bpm)];
  const min = Math.round(Math.min(...bpms));
  const max = Math.round(Math.max(...bpms));
  details.push(min === max ? `${min} BPM` : `${min}-${max} BPM`);
  if (gaps.length) {
    const shortest = gaps.reduce((shortest, gap) => Math.min(shortest, gap), Infinity);
    details.push(`up to ${Math.round(1 / shortest * max / 60 * 10) / 10} attacks/sec`);
  }
  const offbeat = onsets.filter(tick => {
    const beats = (tick - section.start) / style.ppq;
    return Math.abs(beats - Math.round(beats)) > epsilon;
  }).length;
  if (offbeat) details.push(`${Math.round(offbeat / onsets.length * 100)}% offbeat entries`);
  if (gaps.some(beats => [1 / 3, 2 / 3, 1 / 6].some(triplet => Math.abs(beats - triplet) <= epsilon))) {
    details.push('triplet/swing spacing');
  }
  const simultaneous = [...groups.values()].reduce((highest, group) =>
    Math.max(highest, new Set(group.map(note => note.pitch)).size), 0);
  if (simultaneous > 1) details.push(`up to ${simultaneous} simultaneous notes`);
  const pitched = notes.filter(note => partOf(note) !== 'drums');
  if (pitched.length) {
    const pitches = pitched.map(note => note.pitch);
    const range = pitches.reduce((range, pitch) => ({
      low: Math.min(range.low, pitch), high: Math.max(range.high, pitch),
    }), { low: Infinity, high: -Infinity });
    details.push(`${range.high - range.low}-semitone range`);
    const melodicGroups = onsets.map(tick => groups.get(tick).filter(note => partOf(note) !== 'drums'));
    if (melodicGroups.some((group, index) => index > 0 && group.length === 1 &&
      melodicGroups[index - 1].length === 1 && Math.abs(group[0].pitch - melodicGroups[index - 1][0].pitch) >= 12)) {
      details.push('octave-or-larger jumps');
    }
  }
  return { level, peak, details };
}

export function analyzeDifficulty(style) {
  if (!Number.isFinite(style.ppq) || style.ppq <= 0) throw new Error('Difficulty requires a positive MIDI ticks-per-quarter resolution.');
  const tracks = styleTracks(style);
  const sections = style.sections.map((section, index) => {
    const byTrack = new Map();
    for (const note of style.notes) {
      if (note.tick < section.start || note.tick >= section.end) continue;
      const id = trackIdOf(note);
      if (!byTrack.has(id)) byTrack.set(id, []);
      byTrack.get(id).push(note);
    }
    const playable = tracks.filter(track => byTrack.has(track.id)).map(track => {
      const notes = byTrack.get(track.id);
      return {
        id: track.id, name: track.name,
        parts: [...new Set(notes.map(note => stylePartOf(note, style.sourceType)))],
        ...trackDifficulty(notes, style, section),
      };
    });
    return {
      index, name: section.name, tracks: playable, ...rollup(playable),
      groove: /^main(?:\s|$)/i.test(section.name),
      bpm: Math.round((style.tempos || []).filter(tempo => tempo.tick <= section.start).at(-1)?.bpm ?? 120),
      meter: (() => {
        const meter = (style.meters || []).filter(meter => meter.tick <= section.start).at(-1) ?? { numerator: 4, denominator: 4 };
        return `${meter.numerator}/${meter.denominator}`;
      })(),
      parts: Object.fromEntries(Object.keys(STYLE_PARTS).map(part =>
        [part, rollup(playable.filter(track => track.parts.includes(part)))])),
    };
  });
  const grooves = sections.filter(section => section.groove && section.tracks.length);
  const overall = rollup(grooves.length ? grooves : sections);
  return {
    ...overall, peak: rollup(sections).peak, sections,
    bpms: [...new Set(sections.filter(section => section.tracks.length).map(section => section.bpm))],
    meters: [...new Set(sections.filter(section => section.tracks.length).map(section => section.meter))],
  };
}
