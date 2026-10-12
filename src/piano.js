import { pitchName } from './training.js';

export function pianoKeys() {
  let white = 0;
  return Array.from({ length: 88 }, (_, index) => {
    const pitch = index + 21;
    const black = [1, 3, 6, 8, 10].includes(pitch % 12);
    const key = { pitch, black, label: pitchName(pitch), x: black ? white * 20 - 6 : white * 20, width: black ? 12 : 20 };
    if (!black) white++;
    return key;
  });
}

export function pianoTargets(exercise, { mode, tick, waiting = null, countIn = false }) {
  if (!exercise) return [];
  if (mode === 'step' && waiting) return waiting.group.pitches;
  if (mode === 'stop' || countIn) return exercise.groups[0]?.pitches ?? [];
  const pitches = [];
  for (const note of exercise.target) {
    if (tick < note.tick || tick >= note.tick + note.duration) continue;
    let pitch = note.pitch;
    let stopped = false;
    for (const change of note.pitchChanges ?? []) {
      if (change.tick > tick) break;
      if (change.action === 'stop') { stopped = true; break; }
      pitch = change.pitch;
    }
    if (!stopped) pitches.push(pitch);
  }
  return [...new Set(pitches)].sort((a, b) => a - b);
}

export class PianoKeyboard {
  constructor(container, status) {
    this.status = status;
    this.keys = new Map();
    this.lastState = '';
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 1040 120');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', '88-key piano note indicator, A0 to C8. Display only.');
    svg.setAttribute('aria-describedby', status.id);
    const keys = pianoKeys();
    for (const key of [...keys.filter(key => !key.black), ...keys.filter(key => key.black)]) {
      const group = document.createElementNS(ns, 'g');
      group.setAttribute('class', `piano-key ${key.black ? 'black' : 'white'}`);
      group.dataset.pitch = key.pitch;
      const title = document.createElementNS(ns, 'title');
      title.textContent = `${key.label} (MIDI ${key.pitch})`;
      const rect = document.createElementNS(ns, 'rect');
      for (const [name, value] of Object.entries({ x: key.x, y: 0, width: key.width, height: key.black ? 76 : 120, rx: 2 })) {
        rect.setAttribute(name, String(value));
      }
      group.append(title, rect);
      if (key.pitch === 21 || key.pitch % 12 === 0) {
        const label = document.createElementNS(ns, 'text');
        label.setAttribute('x', String(key.x + key.width / 2));
        label.setAttribute('y', '108');
        label.textContent = key.label;
        group.append(label);
      }
      svg.append(group);
      this.keys.set(key.pitch, group);
    }
    container.replaceChildren(svg);
  }
  update(targets, held = []) {
    const target = new Set(targets);
    const input = new Set(held);
    const state = JSON.stringify([[...target].sort((a, b) => a - b), [...input].sort((a, b) => a - b)]);
    if (state === this.lastState) return;
    this.lastState = state;
    for (const [pitch, key] of this.keys) {
      key.classList.toggle('target', target.has(pitch));
      key.classList.toggle('held', input.has(pitch));
    }
    const names = pitches => [...pitches].sort((a, b) => a - b).map(pitchName).join(' + ') || 'none';
    const outside = [...new Set([...target, ...input])].filter(pitch => pitch < 21 || pitch > 108);
    this.status.textContent = `Target: ${names(target)}. Held: ${names(input)}.${outside.length ? ` Outside piano range: ${names(outside)}.` : ''}`;
  }
}
