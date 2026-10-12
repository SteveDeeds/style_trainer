const decoder = new TextDecoder();
const majorKeys = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'];
const minorKeys = ['Abm', 'Ebm', 'Bbm', 'Fm', 'Cm', 'Gm', 'Dm', 'Am', 'Em', 'Bm', 'F#m', 'C#m', 'G#m', 'D#m', 'A#m'];

/** Reads SMF notes and Yamaha section/source-channel CASM policies. */
export function parseMidi(buffer, filename = 'Imported style') {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let offset = 0;
  const requireBytes = (count, end = bytes.length) => {
    if (offset + count > end) throw new Error('Truncated MIDI file.');
  };
  const text = (count) => {
    requireBytes(count);
    const value = decoder.decode(bytes.subarray(offset, offset + count));
    offset += count;
    return value;
  };
  const u16 = () => { requireBytes(2); const n = view.getUint16(offset); offset += 2; return n; };
  const u32 = () => { requireBytes(4); const n = view.getUint32(offset); offset += 4; return n; };
  const variable = (end) => {
    let value = 0;
    for (let i = 0; i < 4; i++) {
      requireBytes(1, end);
      const byte = bytes[offset++];
      value = (value << 7) | (byte & 127);
      if (!(byte & 128)) return value;
    }
    throw new Error('Invalid MIDI variable-length value.');
  };
  if (text(4) !== 'MThd') throw new Error('Choose a standard MIDI or MIDI-compatible Yamaha style file.');
  const headerLength = u32();
  if (headerLength < 6) throw new Error('Invalid MIDI header.');
  requireBytes(headerLength);
  const headerEnd = offset + headerLength;
  const format = u16();
  const trackCount = u16();
  const ppq = u16();
  if (format > 1) throw new Error('Asynchronous format-2 MIDI files are not supported.');
  if (!trackCount || !ppq || (ppq & 0x8000)) throw new Error('Only beat-based (PPQ) MIDI timing is supported.');
  offset = headerEnd;
  const notes = [];
  const markers = [];
  const tempos = [];
  const meters = [];
  const instrumentEvents = [];
  let key = 'Unknown';
  let maxTick = 0;
  for (let track = 0; track < trackCount; track++) {
    if (text(4) !== 'MTrk') throw new Error('Missing MIDI track chunk.');
    const length = u32();
    requireBytes(length);
    const end = offset + length;
    let tick = 0;
    let running = 0;
    const active = new Map();
    let trackName = '';
    const finish = (channel, pitch) => {
      const list = active.get(`${channel}:${pitch}`);
      if (!list?.length) return;
      const note = list.shift();
      note.duration = Math.max(1, tick - note.tick);
      notes.push(note);
    };
    while (offset < end) {
      tick += variable(end);
      requireBytes(1, end);
      let status = bytes[offset];
      if (status & 128) offset++;
      else {
        if (!running) throw new Error('Invalid MIDI running status.');
        status = running;
      }
      if (status === 0xff) {
        running = 0;
        requireBytes(1, end);
        const type = bytes[offset++];
        const count = variable(end);
        requireBytes(count, end);
        const data = bytes.subarray(offset, offset + count);
        if (type === 3) trackName = decoder.decode(data);
        if (type === 6) markers.push({ tick, name: decoder.decode(data) });
        if (type === 0x51 && count === 3) {
          const micros = (data[0] << 16) | (data[1] << 8) | data[2];
          if (!micros) throw new Error('Invalid zero MIDI tempo.');
          tempos.push({ tick, bpm: 60000000 / micros });
        }
        if (type === 0x58 && count >= 2) {
          const numerator = data[0];
          const denominator = 2 ** data[1];
          if (!numerator || denominator > 16) throw new Error('Unsupported MIDI time signature (denominator must be 16 or less).');
          meters.push({ tick, numerator, denominator });
        }
        if (type === 0x59 && count === 2) {
          const sharps = data[0] > 127 ? data[0] - 256 : data[0];
          key = (data[1] ? minorKeys : majorKeys)[sharps + 7] ?? 'Unknown';
        }
        offset += count;
        if (type === 0x2f) break;
      } else if (status === 0xf0 || status === 0xf7) {
        running = 0;
        const count = variable(end);
        requireBytes(count, end);
        offset += count;
      } else {
        if (status >= 0xf0) throw new Error('Unsupported MIDI system event.');
        running = status;
        const kind = status >> 4;
        const channel = status & 15;
        const count = kind === 0xc || kind === 0xd ? 1 : 2;
        requireBytes(count, end);
        const a = bytes[offset++];
        const b = count === 2 ? bytes[offset++] : 0;
        if (a > 127 || b > 127) throw new Error(`Invalid MIDI data byte at file offset ${offset - count}.`);
        if (kind === 0xc) instrumentEvents.push({ tick, channel, program: a });
        if (kind === 0xb && a === 0) instrumentEvents.push({ tick, channel, bank: b });
        if (kind === 0x8 || (kind === 0x9 && !b)) finish(channel, a);
        else if (kind === 0x9) {
          const id = `${channel}:${a}`;
          if (!active.has(id)) active.set(id, []);
          active.get(id).push({
            tick, pitch: a, velocity: b, channel, track, trackName,
            program: 0, bank: 0, duration: ppq / 4,
          });
        }
      }
    }
    for (const list of active.values()) {
      for (const note of list) {
        note.duration = Math.max(1, tick - note.tick);
        notes.push(note);
      }
    }
    maxTick = Math.max(maxTick, tick);
    offset = end;
  }
  if (!notes.length) throw new Error('This file contains no playable MIDI notes.');
  notes.sort((a, b) => a.tick - b.tick || a.pitch - b.pitch);
  const programs = Array(16).fill(0);
  const banks = Array(16).fill(0);
  instrumentEvents.sort((a, b) => a.tick - b.tick);
  let instrumentIndex = 0;
  for (const note of notes) {
    while (instrumentIndex < instrumentEvents.length && instrumentEvents[instrumentIndex].tick <= note.tick) {
      const event = instrumentEvents[instrumentIndex++];
      if (event.program !== undefined) programs[event.channel] = event.program;
      if (event.bank !== undefined) banks[event.channel] = event.bank;
    }
    note.program = programs[note.channel];
    note.bank = banks[note.channel];
  }
  tempos.sort((a, b) => a.tick - b.tick);
  meters.sort((a, b) => a.tick - b.tick);
  markers.sort((a, b) => a.tick - b.tick);
  maxTick = notes.reduce((max, note) => Math.max(max, note.tick + note.duration), maxTick);
  const sections = markers
    .filter(m => /^(main|intro|ending|fill|break)/i.test(m.name))
    .map(m => ({
      name: m.name, start: m.tick,
      end: markers.find(next => next.tick > m.tick)?.tick ?? maxTick,
    }))
    .filter(s => s.end > s.start);
  const casm = parseCasm(bytes, offset);
  for (const section of sections) {
    const groups = casm.filter(group => group.sections.includes(section.name.trim()));
    if (groups.length) section.channelPolicies = Object.assign({}, ...groups.map(group => group.channels));
  }
  for (const note of notes) {
    const section = sections.find(section => note.tick >= section.start && note.tick < section.end);
    const policy = section?.channelPolicies?.[note.channel];
    if (policy) note.yamaha = policy;
  }
  return {
    name: filename.replace(/\.(mid|midi|sty|prs|sst)$/i, ''),
    ppq, notes, key, tempos, meters, maxTick, casm,
    sections: sections.length ? sections : [{ name: 'Whole arrangement', start: 0, end: maxTick }],
  };
}

export function createDemo() {
  const ppq = 480;
  const notes = [];
  const progression = [
    [48, 52, 55, 59], [45, 48, 52, 55], [41, 45, 48, 52], [43, 47, 50, 53],
    [48, 52, 55, 59], [45, 48, 52, 55], [41, 45, 48, 52], [43, 47, 50, 53],
  ];
  const add = (tick, pitch, duration, channel, program, velocity = 85) =>
    notes.push({ tick, pitch, duration, channel, program, bank: 0, velocity, track: channel, trackName: '' });
  progression.forEach((chord, bar) => {
    const start = bar * ppq * 4;
    chord.forEach(p => add(start, p + 12, ppq * 4, 2, 0, 68));
    for (let beat = 0; beat < 4; beat++) {
      add(start + beat * ppq, chord[0] - 12 + (beat === 2 ? 7 : 0), ppq * .7, 1, 33);
      if (beat === 1 || beat === 3) add(start + (beat + .5) * ppq, chord[0] - 12 + 2, ppq * .3, 1, 33, 70);
      add(start + beat * ppq, beat % 2 ? 38 : 36, ppq * .15, 9, 0);
      add(start + beat * ppq, 42, ppq * .12, 9, 0, 58);
      add(start + (beat + .5) * ppq, 42, ppq * .12, 9, 0, 45);
    }
    if (bar % 4 === 3) [45, 47, 50].forEach((p, i) => add(start + (3.25 + i * .25) * ppq, p, ppq * .12, 9, 0, 75));
  });
  return {
    name: 'Midnight Pocket', ppq, notes: notes.sort((a, b) => a.tick - b.tick),
    key: 'C', tempos: [{ tick: 0, bpm: 96 }],
    meters: [{ tick: 0, numerator: 4, denominator: 4 }],
    maxTick: ppq * 32, sections: [{ name: 'Main A', start: 0, end: ppq * 32 }], demo: true,
  };
}
import { parseCasm } from './yamaha.js';
