const decoder = new TextDecoder();
const roots = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const qualities = ['','6','maj7','maj7#11','add9','maj9','6/9','aug','m','m6','m7','m7b5','madd9','m9','m11','mMaj7','mMaj9','dim','dim7','7','7sus4','7b5','9','7#11','13','7b9','7b13','7#9','maj7aug','7aug','1+8','1+5','sus4','1+2+5','cancel'];
const tables = ['Bypass', 'Melody', 'Chord', 'Melodic Minor', 'Melodic Minor 5th Var.', 'Harmonic Minor', 'Harmonic Minor 5th Var.', 'Natural Minor', 'Natural Minor 5th Var.', 'Dorian', 'Dorian 5th Var.'];

export function sourceHarmony(policy) {
  const { sourceRoot: root, sourceChord: type } = policy;
  const minor = type >= 8 && type <= 18;
  const third = minor ? 3 : 4;
  const fifth = [7, 28, 29].includes(type) ? 8 : [11, 17, 18, 21].includes(type) ? 6 : 7;
  const seventh = [0, 1, 2, 3, 4, 5, 6, 7, 15, 16, 28].includes(type) ? 11 : type === 18 ? 9 : 10;
  return { root, minor, key: roots[root] + (minor ? 'm' : ''), name: roots[root] + qualities[type],
    intervals: [0, 2, third, 5, fifth, minor ? 8 : 9, seventh] };
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
          return { ntr: data[begin], ntt: legacy ? (['Bypass', 'Melody', 'Chord', 'Bass', 'Melodic Minor', 'Harmonic Minor'][table] ?? `Unknown ${table}`) : (tables[table] ?? `Unknown ${table}`),
            bassOn: !!(raw & 128), highKey: data[begin + 2], lowLimit: data[begin + 3], highLimit: data[begin + 4], rtr: data[begin + 5] };
        };
        group.channels[data[0]] = {
          channel: data[0], destination: data[9], name: decoder.decode(data.subarray(1, 9)).trim(),
          sourceRoot: data[18], sourceChord: data[19], format: kind,
          lowBoundary: kind === 'Ctb2' ? data[20] : 0,
          highBoundary: kind === 'Ctb2' ? data[21] : 127,
          ranges: kind === 'Ctb2' ? [range(22), range(28), range(34)] : [range(20, true)],
        };
      });
      for (const [channel, raw] of overrides) {
        const policy = group.channels[channel];
        if (!policy) throw new Error('Yamaha Cntt refers to a missing source channel.');
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

export function transposeYamaha(note, destination) {
  const policy = note.yamaha;
  const range = policy.ranges.length === 1 ? policy.ranges[0] :
    policy.ranges[note.pitch < policy.lowBoundary ? 0 : note.pitch > policy.highBoundary ? 2 : 1];
  const { ntr, ntt, highKey, lowLimit, highLimit } = range;
  if (policy.destination === 8 || policy.destination === 9 || ntt === 'Bypass') return note.pitch;
  if (ntr > 1 || ntt.startsWith('Unknown') || policy.sourceChord === 34) throw new Error(`Unsupported Yamaha transposition for ${policy.name}: NTR ${ntr}, ${ntt}, source ${sourceHarmony(policy).name}. Restore harmony or select another section.`);
  if (lowLimit > highLimit || highLimit > 127 || highKey > 11) throw new Error(`Invalid Yamaha pitch limits for ${policy.name}.`);
  const source = sourceHarmony(policy);
  const rootShift = (destination.root - source.root + 12) % 12 - (destination.root > highKey ? 12 : 0);
  let pitch;
  if (ntr === 1 && ntt === 'Chord') {
    const tones = [0, 2, 4, 6].map(degree => (destination.root + destination.intervals[degree]) % 12);
    return nearestPitch(note.pitch, tones, lowLimit, highLimit);
  }
  const interval = (note.pitch - source.root + 12) % 12;
  let mapped = interval;
  if (['Melody', 'Bass', 'Chord'].includes(ntt)) {
    const degree = source.intervals.reduce((best, value, index) =>
      Math.abs(value - interval) < Math.abs(source.intervals[best] - interval) ? index : best, 0);
    mapped = destination.intervals[degree];
  } else {
    // Intro/ending tables alter only their documented major/minor scale degrees.
    const degrees = [2];
    if (/Harmonic|Natural/.test(ntt)) degrees.push(5);
    if (/Natural|Dorian/.test(ntt)) degrees.push(6);
    if (ntt.includes('5th Var.')) degrees.push(4);
    for (const degree of degrees) {
      if (interval === source.intervals[degree]) mapped = destination.intervals[degree];
    }
  }
  pitch = note.pitch + rootShift + mapped - interval;
  if (ntr === 1) pitch = nearestPitch(note.pitch, [(pitch + 1200) % 12]);
  return nearestPitch(pitch, [(pitch + 1200) % 12], lowLimit, highLimit);
}
