const decoder = new TextDecoder();
const roots = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const qualities = ['','6','maj7','maj7#11','add9','maj9','6/9','aug','m','m6','m7','m7b5','madd9','m9','m11','mMaj7','mMaj9','dim','dim7','7','7sus4','7b5','9','7#11','13','7b9','7b13','7#9','maj7aug','7aug','1+8','1+5','sus4','1+2+5','cancel'];
const tables = ['Bypass', 'Melody', 'Chord', 'Melodic Minor', 'Melodic Minor 5th Var.', 'Harmonic Minor', 'Harmonic Minor 5th Var.', 'Natural Minor', 'Natural Minor 5th Var.', 'Dorian', 'Dorian 5th Var.'];
const nttAlterations = new Map([
  [3, [2]], [4, [2]], [5, [2, 5]], [6, [2, 5]],
  [7, [2, 5, 6]], [8, [2, 5, 6]], [9, [2, 6]], [10, [2, 6]],
]);

function nearestDegree(interval, scale) {
  return scale.reduce((best, value, index) =>
    Math.abs(value - interval) < Math.abs(scale[best] - interval) ? index : best, 0);
}

function chordTones(chord) {
  return chord.chordIntervals?.length ? chord.chordIntervals :
    [0, 2, 4, 6].map(degree => chord.intervals[degree]);
}

export function sourceHarmony(policy) {
  const { sourceRoot: root, sourceChord: type } = policy;
  const chordIntervals = [
    [0, 4, 7], [0, 4, 7, 9], [0, 4, 7, 11], [0, 4, 6, 7, 11], [0, 2, 4, 7], [0, 2, 4, 7, 11],
    [0, 2, 4, 7, 9], [0, 4, 8], [0, 3, 7], [0, 3, 7, 9], [0, 3, 7, 10], [0, 3, 6, 10],
    [0, 2, 3, 7], [0, 2, 3, 7, 10], [0, 2, 3, 5, 7, 10], [0, 3, 7, 11], [0, 2, 3, 7, 11],
    [0, 3, 6], [0, 3, 6, 9], [0, 4, 7, 10], [0, 5, 7, 10], [0, 4, 6, 10],
    [0, 2, 4, 7, 10], [0, 4, 6, 7, 10], [0, 2, 4, 7, 9, 10], [0, 1, 4, 7, 10],
    [0, 4, 7, 8, 10], [0, 3, 4, 7, 10], [0, 4, 8, 11], [0, 4, 8, 10],
    [0], [0, 7], [0, 5, 7], [0, 2, 7], [],
  ][type];
  const minor = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18].includes(type);
  const intervals = minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  return { root, minor, key: roots[root] + (minor ? 'm' : ''), name: roots[root] + qualities[type], intervals, chordIntervals };
}

/** CASM policies are section/source-channel specific, not SMF key signatures. */
export function parseCasm(bytes, offset) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const groups = [];
  const walk = (start, end, visit) => {
    for (let position = start; position < end;) {
      if (position + 8 > end) throw new Error('Truncated Yamaha chunk header.');
      const tag = decoder.decode(bytes.subarray(position, position + 4));
      const size = view.getUint32(position + 4);
      const next = position + 8 + size;
      if (next > end) throw new Error(`Truncated Yamaha ${tag} chunk.`);
      visit(tag, position + 8, next);
      position = next;
    }
  };
  walk(offset, bytes.length, (tag, start, end) => {
    if (tag !== 'CASM') return;
    walk(start, end, (child, groupStart, groupEnd) => {
      if (child !== 'CSEG') return;
      const group = { sections: [], channels: {} };
      const overrides = new Map();
      walk(groupStart, groupEnd, (kind, begin, finish) => {
        const data = bytes.subarray(begin, finish);
        if (kind === 'Sdec') group.sections = decoder.decode(data).replace(/\0/g, '').split(',').map(name => name.trim());
        if (kind === 'Cntt') {
          if (data.length !== 2 || data[0] > 15) throw new Error('Invalid Yamaha Cntt policy.');
          overrides.set(data[0], data[1]);
        }
        if (kind !== 'Ctab' && kind !== 'Ctb2') return;
        if (data.length < (kind === 'Ctab' ? 26 : 40)) throw new Error(`Truncated Yamaha ${kind} policy.`);
        if (data[0] > 15 || data[9] > 15 || data[18] > 11 || data[19] > 34) throw new Error(`Invalid Yamaha ${kind} source channel/chord.`);
        const range = (begin, legacy = false) => {
          const raw = data[begin + 1];
          const table = raw & 127;
          const result = { ntr: data[begin], ntt: legacy ? (['Bypass', 'Melody', 'Chord', 'Bass', 'Melodic Minor', 'Harmonic Minor'][table] ?? `Unknown ${table}`) : (tables[table] ?? `Unknown ${table}`),
            bassOn: !!(raw & 128), highKey: data[begin + 2], lowLimit: data[begin + 3], highLimit: data[begin + 4], rtr: data[begin + 5] };
          if (result.ntr > 2 || result.rtr > 5 || (legacy && table > 5)) throw new Error(`Invalid Yamaha ${kind} transposition policy.`);
          if (result.lowLimit > result.highLimit || result.highLimit > 127 || result.highKey > 11) throw new Error(`Invalid Yamaha ${kind} pitch range.`);
          return result;
        };
        group.channels[data[0]] = {
          channel: data[0], destination: data[9], name: decoder.decode(data.subarray(1, 9)).trim(),
          sourceRoot: data[18], sourceChord: data[19], format: kind,
          lowBoundary: kind === 'Ctb2' ? data[20] : 0,
          highBoundary: kind === 'Ctb2' ? data[21] : 127,
          ranges: kind === 'Ctb2' ? [range(22), range(28), range(34)] : [range(20, true)],
        };
        const policy = group.channels[data[0]];
        if (policy.lowBoundary > policy.highBoundary) throw new Error(`Invalid Yamaha ${kind} pitch boundaries.`);
      });
      for (const [channel, raw] of overrides) {
        const policy = group.channels[channel];
        if (!policy) throw new Error('Yamaha Cntt refers to a missing source channel.');
        if ((raw & 127) >= tables.length) throw new Error('Invalid Yamaha Cntt transposition table.');
        policy.ranges[0].ntt = tables[raw & 127] ?? `Unknown ${raw & 127}`;
        policy.ranges[0].bassOn = !!(raw & 128);
      }
      groups.push(group);
    });
  });
  return groups;
}

function nearestPitch(pitch, pitchClasses, low = 0, high = 127) {
  for (let distance = 0; distance <= 127; distance++) {
    for (const candidate of [pitch + distance, pitch - distance]) {
      if (candidate >= low && candidate <= high && pitchClasses.includes(candidate % 12)) return candidate;
    }
  }
  throw new Error('Yamaha note limits contain no playable transposed pitch.');
}

export function transposeYamaha(note, destination, { toRoot = false } = {}) {
  const policy = note.yamaha;
  const range = policy.ranges.length === 1 ? policy.ranges[0] :
    policy.ranges[note.pitch < policy.lowBoundary ? 0 : note.pitch > policy.highBoundary ? 2 : 1];
  const { ntr, ntt, highKey, lowLimit, highLimit } = range;
  const nttCode = tables.indexOf(ntt);
  if (policy.destination === 8 || policy.destination === 9 || ntt === 'Bypass') return note.pitch;
  if (range.rtr === 5) throw new Error(`Yamaha NOTE GENERATOR RTR is not supported for ${policy.name}; generator metadata is not present in this MIDI file.`);
  if (ntt.startsWith('Unknown') || policy.sourceChord === 34) throw new Error(`Unsupported Yamaha transposition for ${policy.name}: NTR ${ntr}, ${ntt}, source ${sourceHarmony(policy).name}. Restore harmony or select another section.`);
  if (lowLimit > highLimit || highLimit > 127 || highKey > 11) throw new Error(`Invalid Yamaha pitch limits for ${policy.name}.`);
  if (toRoot) return nearestPitch(note.pitch, [destination.root], lowLimit, highLimit);
  const source = sourceHarmony(policy);
  const rootShift = (destination.root - source.root + 12) % 12 - (ntr === 0 && destination.root > highKey ? 12 : 0);
  let pitch;
  if (ntr === 1 && ntt === 'Chord') {
    const tones = chordTones(destination).map(interval => (destination.root + interval) % 12);
    return nearestPitch(note.pitch, tones, lowLimit, highLimit);
  }
  if (ntr === 2) {
    const tuning = [40, 45, 50, 55, 59, 64];
    const positions = tuning.flatMap((open, string) =>
      Array.from({ length: 25 }, (_, fret) => ({ pitch: open + fret, fret, string }))
        .filter(position => position.pitch === note.pitch && source.chordIntervals.includes((position.pitch - source.root + 12) % 12)));
    const sourcePosition = positions.sort((a, b) => a.fret - b.fret)[0];
    if (!sourcePosition) throw new Error(`Cannot map Yamaha Guitar NTR voice on ${policy.name} to a string.`);
    const candidates = tuning.flatMap((open, string) => Array.from({ length: 25 }, (_, fret) => ({
      pitch: open + fret, fret, string,
    })).filter(position => position.pitch >= lowLimit && position.pitch <= highLimit &&
      chordTones(destination).includes((position.pitch - destination.root + 12) % 12)));
    if (!candidates.length) throw new Error(`Yamaha Guitar NTR pitch range contains no playable chord tone for ${policy.name}.`);
    const targetPitch = note.pitch + rootShift;
    return candidates.reduce((best, candidate) => {
      const score = Math.abs(candidate.string - sourcePosition.string) * 24 +
        Math.abs(candidate.fret - sourcePosition.fret) * 2 + Math.abs(candidate.pitch - targetPitch);
      const bestScore = Math.abs(best.string - sourcePosition.string) * 24 +
        Math.abs(best.fret - sourcePosition.fret) * 2 + Math.abs(best.pitch - targetPitch);
      return score < bestScore ? candidate : best;
    }, candidates[0]).pitch;
  }
  if (ntt === 'Chord') {
    const interval = (note.pitch - source.root + 12) % 12;
    const degree = nearestDegree(interval, source.chordIntervals);
    const targetTone = chordTones(destination)[degree] ?? destination.intervals[degree];
    return nearestPitch(note.pitch + rootShift + targetTone - source.chordIntervals[degree],
      [(destination.root + targetTone) % 12], lowLimit, highLimit);
  }
  const interval = (note.pitch - source.root + 12) % 12;
  if (ntt === 'Melody') {
    pitch = note.pitch + rootShift;
  } else if (ntt === 'Bass') {
    pitch = note.pitch + rootShift;
  } else if (nttAlterations.has(nttCode)) {
    pitch = note.pitch + rootShift;
    if (source.minor !== !!destination.minor) {
      const targetDegrees = nttAlterations.get(nttCode);
      for (const degree of targetDegrees) {
        const sourceInterval = source.minor ? [0, 2, 3, 5, 7, 8, 10][degree] : [0, 2, 4, 5, 7, 9, 11][degree];
        const destinationInterval = destination.minor ? [0, 2, 3, 5, 7, 8, 10][degree] : [0, 2, 4, 5, 7, 9, 11][degree];
        if (interval === sourceInterval) pitch += destinationInterval - sourceInterval;
      }
    }
    if ([4, 6, 8, 10].includes(nttCode) && source.chordIntervals.length > 2 && chordTones(destination).length > 2) {
      const sourceFifth = source.chordIntervals[2];
      const destinationFifth = chordTones(destination)[2];
      if (interval === sourceFifth && sourceFifth !== destinationFifth) pitch += destinationFifth - sourceFifth;
    }
  } else {
    throw new Error(`Unsupported Yamaha NTT ${ntt} for ${policy.name}.`);
  }
  return nearestPitch(ntr === 1 ? note.pitch : pitch, [(pitch + 1200) % 12], lowLimit, highLimit);
}
