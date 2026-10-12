export const LAYERS = {
  full: ['Kicks + on-beat roots', 'Add snares + off-beat roots', 'Add hi-hats + other on-beat notes', 'All source notes'],
  drums: ['All kick notes', 'Add all snare notes', 'Add all hi-hat notes', 'All percussion + fills'],
  bass: ['Root notes on the main beats', 'Add root notes off the beat', 'Add other notes on the main beats', 'All source bass notes'],
  chords: ['Chord roots on the main beats', 'Add chord roots off the beat', 'Add other chord notes on the main beats', 'All source chord notes'],
};
const pitchClasses = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
export const pitchName = pitch => `${pitchClasses[pitch % 12]}${Math.floor(pitch / 12) - 1}`;
export const partOf = n => n.yamaha?.destination === 8 || n.yamaha?.destination === 9 ? 'drums' :
  n.yamaha?.destination === 10 ? 'bass' :
  n.channel === 9 || n.bank === 127 || n.bank === 126 ? 'drums' :
  (n.program >= 32 && n.program <= 39) || /bass/i.test(n.trackName) ? 'bass' : 'chords';

export const trackIdOf = note => `${note.track}:${note.channel}`;

export function styleTracks(style) {
  const tracks = new Map();
  const families = ['Piano', 'Chromatic percussion', 'Organ', 'Guitar', 'Bass', 'Strings', 'Ensemble', 'Brass', 'Reed', 'Pipe', 'Synth lead', 'Synth pad', 'Synth effects', 'Ethnic', 'Percussive', 'Sound effects'];
  for (const note of style.notes) {
    const id = trackIdOf(note);
    if (!tracks.has(id)) {
      const part = partOf(note);
      tracks.set(id, {
        id, part, channel: note.channel, track: note.track,
        name: `${part === 'drums' ? 'Drums' : part === 'bass' ? 'Bass' : families[Math.floor(note.program / 8)]} · Track ${note.track + 1} / Ch ${note.channel + 1}${part === 'drums' ? '' : ` · GM ${note.program + 1}`}`,
        trackName: (note.trackName ?? '').replace(/\0/g, '').trim(),
      });
    }
  }
  return [...tracks.values()].sort((a, b) => a.track - b.track || a.channel - b.channel).map(track => ({
    ...track, name: track.trackName && [...tracks.values()].filter(other => other.track === track.track).length === 1 ?
      `${track.trackName} · ${track.name}` : track.name,
  }));
}

export function inferChord(notes) {
  if (!notes.length) return null;
  const pitches = [...new Set(notes.map(n => n.pitch % 12))];
  const lowest = Math.min(...notes.map(n => n.pitch)) % 12;
  let best = { root: lowest, minor: false, score: -1 };
  for (const root of pitches) {
    for (const minor of [false, true]) {
      const score = [0, minor ? 3 : 4, 7].reduce((s, interval) =>
        s + (pitches.includes((root + interval) % 12) ? 2 : 0), 0) + (root === lowest ? .5 : 0);
      if (score > best.score) best = { root, minor, score };
    }
  }
  const intervals = pitches.map(p => (p - best.root + 12) % 12);
  const seventh = intervals.includes(11) ? 'maj7' : intervals.includes(10) ? '7' : '';
  return { ...best, name: pitchClasses[best.root] + (best.minor ? 'm' : '') + seventh };
}

function onMainBeat(tick, ppq, denominator) {
  const beat = tick / (ppq * 4 / denominator);
  return Math.abs(beat - Math.round(beat)) < .06;
}

function drumLayer(n, level) {
  if (level === 4) return true;
  if ([33, 35, 36].includes(n.pitch)) return true;
  if (level >= 2 && [31, 37, 38, 40].includes(n.pitch)) return true;
  return level >= 3 && [42, 44, 46].includes(n.pitch);
}

function pitchedLayer(note, level, root, ppq, denominator) {
  if (level === 4) return true;
  const onBeat = onMainBeat(note.tick, ppq, denominator);
  const isRoot = note.pitch % 12 === root;
  return (isRoot && (onBeat || level >= 2)) || (onBeat && level >= 3);
}

function harmonyChanges(notes) {
  const harmonic = notes.filter(note => note.part === 'chords');
  const changes = [];
  for (const group of groupNotes(harmonic)) {
    const sounding = harmonic.filter(note => note.tick <= group.tick && note.tick + note.duration > group.tick);
    // A lone passing/arpeggio note must not replace the established chord root.
    if (new Set(sounding.map(note => note.pitch % 12)).size < 2) continue;
    changes.push({ tick: group.tick, chord: inferChord(sounding) });
  }
  return changes;
}

export function randomHarmony(key, bars, random = Math.random) {
  const match = /^([A-G])([b#]?)(m?)$/.exec(key);
  if (!match) throw new Error('Random harmony needs a known major or minor key signature.');
  if (!Number.isInteger(bars) || bars < 1 || bars > 8) throw new Error('Random harmony needs 1 to 8 bars.');
  const natural = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const tonic = (natural[match[1]] + (match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0) + 12) % 12;
  const scale = match[3] ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  const names = /b|^F$|^Dm$|^Gm$|^Cm$|^Fm$/.test(key) ?
    ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] :
    ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  let previous = -1;
  return Array.from({ length: bars }, () => {
    const choices = Array.from({ length: 7 }, (_, degree) => degree).filter(degree => degree !== previous);
    const sample = random();
    if (!Number.isFinite(sample) || sample < 0 || sample >= 1) throw new Error('Random source must return a value from 0 up to, but not including, 1.');
    const degree = choices[Math.floor(sample * choices.length)];
    previous = degree;
    const root = (tonic + scale[degree]) % 12;
    const intervals = Array.from({ length: 7 }, (_, index) =>
      (scale[(degree + index) % 7] - scale[degree] + 12) % 12);
    const diminished = intervals[4] === 6;
    const minor = intervals[2] === 3;
    return { root, intervals, minor, name: names[root] + (diminished ? 'm7b5' : minor ? 'm7' : intervals[6] === 11 ? 'maj7' : '7') };
  });
}

function reharmonize(notes, harmony, barTicks, ppq, denominator) {
  const changes = harmonyChanges(notes);
  return notes.map(note => {
    if (note.part === 'drums') return note;
    const bar = Math.floor(note.tick / barTicks);
    if (note.yamaha) return { ...note, pitch: transposeYamaha(note, harmony[bar]) };
    const inBar = notes.filter(n => n.tick >= bar * barTicks && n.tick < (bar + 1) * barTicks);
    const sourceChord = changes.filter(change => change.tick <= note.tick).at(-1)?.chord ??
      changes.find(change => change.tick >= bar * barTicks && change.tick < (bar + 1) * barTicks)?.chord ??
      inferChord(inBar.filter(n => n.part === 'chords'));
    const bass = inBar.filter(n => n.part === 'bass');
    const sourceRoot = sourceChord?.root ??
      (bass.find(n => onMainBeat(n.tick, ppq, denominator)) ?? bass[0])?.pitch % 12;
    if (sourceRoot === undefined) throw new Error('Cannot infer source harmony for a pitched bar. Select another section.');
    const destination = harmony[bar];
    const sourceScale = sourceChord?.minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
    const interval = (note.pitch - sourceRoot + 12) % 12;
    let degree = sourceScale.reduce((best, value, index) =>
      Math.abs(value - interval) < Math.abs(sourceScale[best] - interval) ? index : best, 0);
    if (interval === 10 || interval === 11) degree = 6;
    const shift = (destination.root - sourceRoot + 18) % 12 - 6;
    let pitch = note.pitch + shift + destination.intervals[degree] - interval;
    while (pitch < 0) pitch += 12;
    while (pitch > 127) pitch -= 12;
    return { ...note, pitch };
  });
}

export function buildExercise(style, { section = 0, bars = 4, focus = 'full', level = 1, trackId = null, harmony = null } = {}) {
  const selectedTrack = trackId === null ? null : styleTracks(style).find(track => track.id === trackId);
  if (trackId !== null && !selectedTrack) throw new Error('The selected track does not exist in this style.');
  if (selectedTrack) focus = selectedTrack.part;
  if (!Number.isInteger(bars) || bars < 1 || bars > 8) throw new Error('Exercise length must be 1 to 8 bars.');
  if (!LAYERS[focus] || !Number.isInteger(level) || level < 1 || level > LAYERS[focus].length) throw new Error('Invalid practice focus or density level.');
  const selected = style.sections[section];
  if (!selected) throw new Error('The selected style section does not exist.');
  if (selected.end <= selected.start) throw new Error('The selected section has no duration.');
  const meter = style.meters.filter(m => m.tick <= selected.start).at(-1) ?? { numerator: 4, denominator: 4 };
  const barTicks = style.ppq * 4 * meter.numerator / meter.denominator;
  const durationTicks = bars * barTicks;
  const available = selected.end - selected.start;
  if (style.meters.some(m => m.tick > selected.start && m.tick < Math.min(selected.end, selected.start + durationTicks))) {
    throw new Error('This exercise crosses a time-signature change. Select a shorter range or another section.');
  }
  // Short style sections repeat to fill the requested exercise length.
  let backing = [];
  for (let repeat = 0; repeat * available < durationTicks; repeat++) {
    for (const source of style.notes) {
      if (source.tick < selected.start || source.tick >= selected.end) continue;
      const tick = source.tick - selected.start + repeat * available;
      if (tick >= durationTicks) continue;
      backing.push({ ...source, tick, duration: Math.min(source.duration, selected.end - source.tick, durationTicks - tick), part: partOf(source) });
    }
  }
  if (harmony !== null) {
    if (!Array.isArray(harmony) || harmony.length !== bars || harmony.some(chord =>
      !Number.isInteger(chord.root) || chord.root < 0 || chord.root > 11 ||
      !Array.isArray(chord.intervals) || chord.intervals.length !== 7 ||
      chord.intervals.some(interval => !Number.isInteger(interval) || interval < 0 || interval > 11))) {
      throw new Error('Random harmony must contain one valid diatonic chord per exercise bar.');
    }
    const missingPolicy = style.casm?.length && backing.find(note => note.part !== 'drums' && !note.yamaha);
    if (missingPolicy) throw new Error(`Missing Yamaha CASM policy for source channel ${missingPolicy.channel + 1} in ${selected.name}. Restore harmony or select another section.`);
    backing = reharmonize(backing, harmony, barTicks, style.ppq, meter.denominator);
  }
  const target = [];
  const chords = [];
  const hasPolicies = backing.some(note => note.yamaha);
  const changes = harmony ? harmony.map((chord, bar) => ({ tick: bar * barTicks, chord })) : hasPolicies ? [] : harmonyChanges(backing);
  for (let bar = 0; bar < bars; bar++) {
    const start = bar * barTicks;
    const inBar = backing.filter(n => n.tick >= start && n.tick < start + barTicks);
    const contextHarmony = inBar.filter(n => n.part === 'chords');
    const policy = inBar.find(note => note.yamaha && (!selectedTrack || trackIdOf(note) === trackId))?.yamaha ??
      inBar.find(note => note.yamaha && note.part === 'bass')?.yamaha ??
      inBar.find(note => note.yamaha)?.yamaha;
    const chord = changes.filter(change => change.tick <= start).at(-1)?.chord ??
      changes.find(change => change.tick < start + barTicks && change.tick >= start)?.chord ??
      (policy ? sourceHarmony(policy) : inferChord(contextHarmony));
    chords.push(chord?.name ?? '');
    const bass = inBar.filter(n => n.part === 'bass');
    const fallbackRoot = chord?.root ??
      (bass.find(n => onMainBeat(n.tick, style.ppq, meter.denominator)) ?? bass[0])?.pitch % 12;
    const practiceNotes = selectedTrack ? inBar.filter(n => trackIdOf(n) === trackId) : inBar;
    target.push(...practiceNotes.filter(note => {
      if (focus !== 'full' && note.part !== focus) return false;
      if (note.part === 'drums') return drumLayer(note, level);
      const root = changes.filter(change => change.tick <= note.tick).at(-1)?.chord.root ?? note.yamaha?.sourceRoot ?? fallbackRoot;
      return pitchedLayer(note, level, root, style.ppq, meter.denominator);
    }));
  }
  target.sort((a, b) => a.tick - b.tick || a.pitch - b.pitch);
  const selectedParts = focus === 'full' ? ['drums', 'bass', 'chords'] : [focus];
  const markedTarget = target.map(n => ({ ...n, isTarget: true }));
  return {
    target: markedTarget, backing: backing.filter(n => selectedTrack ? trackIdOf(n) !== trackId : !selectedParts.includes(n.part)),
    groups: groupNotes(markedTarget), chords, barTicks, durationTicks, meter, bars, ppq: style.ppq, level, focus, trackId, randomized: harmony !== null,
  };
}

export function groupNotes(notes) {
  const groups = new Map();
  for (const note of notes) {
    if (!groups.has(note.tick)) groups.set(note.tick, { tick: note.tick, notes: [], pitches: [] });
    const group = groups.get(note.tick);
    group.notes.push(note);
    if (!group.pitches.includes(note.pitch)) group.pitches.push(note.pitch);
  }
  return [...groups.values()].sort((a, b) => a.tick - b.tick);
}

export function practiceExercise(exercise, { bar = null, bpm, normalBpm, speed = 100 }) {
  if (!Number.isFinite(bpm) || bpm < 30 || bpm > 240 || !Number.isFinite(speed) || speed < 25 || speed > 100) {
    throw new Error('Choose a tempo from 30 to 240 BPM and a practice speed from 25% to 100%.');
  }
  if (bar !== null && (!Number.isInteger(bar) || bar < 0 || bar >= exercise.bars)) {
    throw new Error('Choose a bar within the current pattern.');
  }
  const playbackBpm = bpm * speed / 100;
  const practiceOnly = bar !== null || speed < 100 || bpm < normalBpm;
  const nextSpeed = bar === null && bpm >= normalBpm ? ({ 50: 75, 75: 100 }[speed] ?? null) : null;
  if (bar === null) return { ...exercise, playbackBpm, practiceOnly, practiceSpeed: speed, nextSpeed };
  const start = bar * exercise.barTicks;
  const end = start + exercise.barTicks;
  const slice = notes => notes.filter(n => n.tick < end && n.tick + n.duration > start).map(n => ({
    ...n, tick: Math.max(0, n.tick - start),
    duration: Math.min(end, n.tick + n.duration) - Math.max(start, n.tick),
  }));
  const target = slice(exercise.target);
  return {
    ...exercise, target, backing: slice(exercise.backing), groups: groupNotes(target),
    chords: [exercise.chords[bar]], bars: 1, durationTicks: exercise.barTicks,
    sourceBar: bar + 1, playbackBpm, practiceOnly, practiceSpeed: speed, nextSpeed,
  };
}

export const TIMING_TOLERANCE_MS = 100;

export function inputFeedback(expected, pitch, time, tolerance = TIMING_TOLERANCE_MS) {
  const samePitch = expected.filter(n => n.pitch === pitch);
  const available = samePitch.filter(n => !n.hit);
  const nearest = notes => notes.reduce((best, note) =>
    !best || Math.abs(note.time - time) < Math.abs(best.time - time) ? note : best, null);
  const match = nearest(available.filter(n => Math.abs(n.time - time) <= tolerance + 1e-7));
  const duplicate = nearest(samePitch.filter(n => n.hit && Math.abs(n.time - time) <= tolerance + 1e-7));
  const reference = match ?? duplicate ?? nearest(available.length ? available : samePitch);
  const closestTime = nearest(expected)?.time;
  return {
    reason: match ? 'hit' : duplicate ? 'duplicate' : samePitch.length ? 'timing' : 'pitch',
    offsetMs: reference ? time - reference.time : null,
    expectedPitches: closestTime === undefined ? [] :
      [...new Set(expected.filter(n => n.time === closestTime).map(n => n.pitch))],
  };
}

export function targetGroupAt(groups, tick, toleranceTicks = 0) {
  const near = groups.filter(g => Math.abs(g.tick - tick) <= toleranceTicks);
  return near.reduce((best, group) => !best || Math.abs(group.tick - tick) < Math.abs(best.tick - tick) ? group : best, null)
    ?? groups.find(g => g.tick >= tick) ?? groups.at(-1) ?? null;
}

export class LoopScore {
  constructor(groups, millisecondsPerTick, startTime, tolerance = TIMING_TOLERANCE_MS) {
    this.expected = groups.flatMap(g => g.pitches.map(pitch => ({
      pitch, time: startTime + g.tick * millisecondsPerTick, hit: false,
    })));
    this.tolerance = tolerance;
    this.extra = 0;
    this.inputs = [];
  }
  input(pitch, time) {
    const candidates = this.expected.filter(n => !n.hit && n.pitch === pitch && Math.abs(n.time - time) <= this.tolerance + 1e-7);
    const closest = candidates.sort((a, b) => Math.abs(a.time - time) - Math.abs(b.time - time))[0];
    this.inputs.push({
      pitch, time, matched: Boolean(closest), offsetMs: closest ? time - closest.time : null,
      feedback: inputFeedback(this.expected, pitch, time, this.tolerance),
    });
    if (!closest) { this.extra++; return false; }
    closest.hit = true;
    return true;
  }
  result() {
    const hits = this.expected.filter(n => n.hit).length;
    const total = this.expected.length;
    return { hits, total, extra: this.extra, score: total ? 100 * hits / (total + this.extra) : 0 };
  }
}

export class Progression {
  constructor(maxLevel, requiredStreak = 3) {
    this.level = 1;
    this.maxLevel = maxLevel;
    this.requiredStreak = requiredStreak;
    this.streak = 0;
  }
  selectLevel(level) {
    if (!Number.isInteger(level) || level < 1 || level > this.maxLevel) throw new Error('Select a level within this track’s density range.');
    this.level = level;
    this.streak = 0;
  }
  submitExercise(score, exercise) {
    const nextSpeed = exercise.nextSpeed;
    if (!this.submit(score, exercise.level, nextSpeed != null || !exercise.practiceOnly, nextSpeed == null)) return null;
    return nextSpeed != null ? { nextSpeed } : { level: this.level };
  }
  submit(score, level = this.level, eligible = true, advanceLevel = true) {
    if (!eligible) { this.streak = 0; return false; }
    if (level !== this.level) return false;
    this.streak = score >= 90 ? this.streak + 1 : 0;
    if (this.streak >= this.requiredStreak) {
      if (advanceLevel && this.level < this.maxLevel) this.level++;
      this.streak = 0;
      return true;
    }
    this.streak = Math.min(this.streak, this.requiredStreak);
    return false;
  }
}
import { sourceHarmony, transposeYamaha } from './yamaha.js';
