import { Renderer, Stave, StaveNote, Voice, Formatter, Accidental, Annotation, Articulation, Dot, StaveConnector, StaveTie, Barline } from 'vexflow';

const sharpNames = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
const flatNames = ['c', 'db', 'd', 'eb', 'e', 'f', 'gb', 'g', 'ab', 'a', 'bb', 'b'];
const drumKeys = { 33: 'f/4', 35: 'f/4', 36: 'f/4', 31: 'c/5', 37: 'c/5', 38: 'c/5', 40: 'c/5', 42: 'g/5', 44: 'g/5', 46: 'g/5' };

export const writtenPitch = note => note.pitch + (note.part === 'bass' ? 12 : 0);

export function notationStaves(notes) {
  const staves = [];
  if (notes.some(n => n.part === 'chords')) {
    staves.push({ clef: 'treble', accepts: n => n.part === 'chords' && n.pitch >= 60 });
    staves.push({ clef: 'bass', accepts: n => n.part === 'chords' && n.pitch < 60 });
  }
  if (notes.some(n => n.part === 'bass')) {
    staves.push({ clef: 'bass', annotation: '8vb', accepts: n => n.part === 'bass' });
  }
  if (notes.some(n => n.part === 'drums')) {
    staves.push({ clef: 'percussion', accepts: n => n.part === 'drums' });
  }
  return staves;
}

const rhythmValues = [
  { size: 16, duration: 'w' }, { size: 12, duration: 'h', dots: 1 },
  { size: 8, duration: 'h' }, { size: 6, duration: 'q', dots: 1 },
  { size: 4, duration: 'q' }, { size: 3, duration: '8', dots: 1 },
  { size: 2, duration: '8' }, { size: 1, duration: '16' },
];

export function planNotationRhythm(exercise, definition) {
  const barUnits = Math.round(exercise.barTicks / exercise.ppq * 4);
  const totalUnits = barUnits * exercise.bars;
  const unitTicks = exercise.ppq / 4;
  const events = new Map();
  for (const note of exercise.target.filter(definition.accepts)) {
    const unit = Math.min(totalUnits - 1, Math.max(0, Math.round(note.tick / unitTicks)));
    if (!events.has(unit)) events.set(unit, []);
    events.get(unit).push(note);
  }
  const attacks = [...events.keys()].sort((a, b) => a - b);
  const spans = [];
  let cursor = 0;
  for (let index = 0; index < attacks.length; index++) {
    const unit = attacks[index];
    if (cursor < unit) spans.push({ unit: cursor, size: unit - cursor, sources: [] });
    const sources = events.get(unit);
    const next = attacks[index + 1] ?? totalUnits;
    const available = next - unit;
    const sounding = Math.max(...sources.map(note => (note.tick + note.duration) / unitTicks - unit));
    const gap = available - sounding;
    let length;
    if (gap <= 2 + 1e-7 && rhythmValues.some(value => value.size === available)) length = available;
    else {
      length = Math.min(available, Math.max(1, Math.round(sounding)));
      const candidates = rhythmValues.filter(value =>
        value.size >= length && value.size <= available && value.size - sounding <= 2 + 1e-7);
      // Fill a clean beat before a longer rest, not just before the next attack.
      const plain = candidates.find(value => !value.dots && unit % value.size === 0);
      const longer = plain ?? candidates.at(-1);
      if (longer) length = longer.size;
    }
    spans.push({
      unit, size: length, sources, attackUnit: unit,
      staccato: sources.every(note => note.duration / unitTicks / length <= .55),
    });
    cursor = unit + length;
  }
  if (cursor < totalUnits) spans.push({ unit: cursor, size: totalUnits - cursor, sources: [] });
  const bars = Array.from({ length: exercise.bars }, () => []);
  const compound = exercise.meter.denominator === 8 && exercise.meter.numerator % 3 === 0;
  for (const span of spans) {
    let unit = span.unit;
    let remaining = span.size;
    while (remaining > 0) {
      const bar = Math.floor(unit / barUnits);
      const local = unit % barUnits;
      const limit = Math.min(remaining, barUnits - local);
      const value = rhythmValues.find(value => {
        if (value.size > limit) return false;
        if (local === 0 && value.size === barUnits) return true;
        if (compound) {
          return value.size <= 6 - local % 6 &&
            (value.size === 6 && local % 6 === 0 || value.size === 3 && local % 3 === 0 ||
              !value.dots && local % value.size === 0);
        }
        const beatUnits = 16 / exercise.meter.denominator;
        if (local % beatUnits !== 0 && value.size > beatUnits - local % beatUnits) return false;
        const base = value.dots ? value.size / 1.5 : value.size;
        return local % base === 0;
      });
      if (!value) throw new Error('Could not represent the simplified rhythm on the sixteenth-note grid.');
      bars[bar].push({
        ...value, unit: local, sources: span.sources, attackUnit: span.attackUnit,
        continuation: span.sources.length > 0 && unit !== span.attackUnit,
        staccato: span.staccato && unit === span.attackUnit,
      });
      unit += value.size;
      remaining -= value.size;
    }
  }
  return bars;
}

export function buildNotationVoice(exercise, definition, bar, key, showChord = false, rhythm = planNotationRhythm(exercise, definition)) {
  const { clef } = definition;
  const tickables = [];
  const ties = [];
  const entries = [];
  const flat = /b|^F$|^Dm$|^Gm$|^Cm$|^Fm$/.test(key);
  for (const event of rhythm[bar]) {
    const group = event.sources;
    const pitches = [...new Set(group.map(writtenPitch))].sort((a, b) => a - b);
    const duration = event.duration + (group.length ? '' : 'r');
    const keys = pitches.length ? pitches.map(pitch => clef === 'percussion' ? (drumKeys[pitch] ?? 'e/5') :
      `${(flat ? flatNames : sharpNames)[pitch % 12]}/${Math.floor(pitch / 12) - 1}`) : [clef === 'bass' ? 'd/3' : 'b/4'];
    const note = new StaveNote({ keys, duration, dots: event.dots ?? 0, clef: clef === 'percussion' ? 'treble' : clef });
    if (event.dots) Dot.buildAndAttach([note], { all: true });
    if (event.unit === 0 && showChord && exercise.chords[bar]) {
      note.addModifier(new Annotation(exercise.chords[bar]).setVerticalJustification(Annotation.VerticalJustify.TOP), 0);
    }
    if (event.staccato) note.addModifier(new Articulation('a.').setPosition(3), 0);
    if (group.length) {
      const previous = entries.at(-1);
      if (event.continuation && previous?.attackUnit === event.attackUnit) ties.push(new StaveTie({
        first_note: previous.note, last_note: note,
        first_indices: pitches.map((_, i) => i), last_indices: pitches.map((_, i) => i),
      }));
      entries.push({ note, sources: group, pitches, attackUnit: event.attackUnit, continuation: event.continuation });
    }
    tickables.push(note);
  }
  const voice = new Voice({ num_beats: exercise.meter.numerator, beat_value: exercise.meter.denominator });
  voice.addTickables(tickables);
  if (clef !== 'percussion') Accidental.applyAccidentals([voice], key === 'Unknown' ? 'C' : key);
  return { voice, ties, entries };
}

export function prepareNotationBars(exercise, definitions, key) {
  const rhythms = definitions.map(definition => planNotationRhythm(exercise, definition));
  return Array.from({ length: exercise.bars }, (_, bar) => {
    const parts = definitions.map((definition, i) => buildNotationVoice(exercise, definition, bar, key, i === 0, rhythms[i]));
    const formatter = new Formatter();
    parts.forEach(part => formatter.joinVoices([part.voice]));
    const minimumWidth = formatter.preCalculateMinTotalWidth(parts.map(part => part.voice));
    return { parts, formatter, minimumWidth };
  });
}

export class Notation {
  constructor(element, onAudition = null) { this.element = element; this.onAudition = onAudition; }
  render(exercise, key) {
    this.element.replaceChildren();
    this.element.scrollTop = 0;
    this.previousBar = null;
    this.feedbackEntries = [];
    this.feedbackMarks = [];
    const staffDefinitions = notationStaves(exercise.target);
    const hasBass = staffDefinitions.some(staff => staff.annotation === '8vb');
    if (!staffDefinitions.length) {
      this.element.textContent = 'No notes for this focus in the selected section. Choose a different focus or density.';
      this.positions = [];
      return;
    }
    const bars = prepareNotationBars(exercise, staffDefinitions, key);
    const headerWidth = Math.max(...staffDefinitions.map(definition => {
      const stave = new Stave(0, 0, 1000);
      stave.addClef(definition.clef, 'default', definition.annotation);
      if (definition.clef !== 'percussion' && key !== 'Unknown') stave.addKeySignature(key);
      stave.addTimeSignature(`${exercise.meter.numerator}/${exercise.meter.denominator}`);
      return stave.getNoteStartX();
    }));
    // Count all engraved notes, rests and accidentals, not just MIDI onsets.
    const barWidth = Math.max(210, headerWidth + Math.max(...bars.map(bar => bar.minimumWidth)) + 30);
    const minimumColumns = Math.min(2, exercise.bars);
    const width = Math.max(barWidth * minimumColumns, this.element.clientWidth);
    const columns = Math.min(exercise.bars, Math.max(minimumColumns, Math.floor(width / barWidth)));
    const rows = Math.ceil(exercise.bars / columns);
    const rowHeight = staffDefinitions.length * 112 + 48;
    const renderer = new Renderer(this.element, Renderer.Backends.SVG);
    renderer.resize(width, rows * rowHeight + 12);
    const context = renderer.getContext();
    context.setFont('Arial', 12);
    this.positions = [];
    const barlineTies = [];
    for (let bar = 0; bar < exercise.bars; bar++) {
      const column = bar % columns;
      const row = Math.floor(bar / columns);
      const staveWidth = (width - 24) / columns;
      const x = 12 + column * staveWidth;
      const y = row * rowHeight + 28;
      const first = column === 0;
      const staves = [];
      const { parts, formatter } = bars[bar];
      const voices = parts.map(part => part.voice);
      const allTies = parts.flatMap(part => part.ties);
      for (let c = 0; c < staffDefinitions.length; c++) {
        const definition = staffDefinitions[c];
        const { clef } = definition;
        const stave = new Stave(x, y + c * 112, staveWidth);
        if (first) {
          stave.addClef(clef, 'default', definition.annotation);
          if (clef !== 'percussion' && key !== 'Unknown') stave.addKeySignature(key);
          stave.addTimeSignature(`${exercise.meter.numerator}/${exercise.meter.denominator}`);
        } else stave.setBegBarType(Barline.type.NONE);
        stave.setContext(context).draw();
        staves.push(stave);
      }
      const noteStartX = Math.max(...staves.map(stave => stave.getNoteStartX()));
      staves.forEach(stave => stave.setNoteStartX(noteStartX));
      formatter.format(voices, staves[0].getNoteEndX() - noteStartX - 14);
      voices.forEach((voice, i) => voice.draw(context, staves[i]));
      parts.forEach((part, i) => part.entries.forEach(entry => this.feedbackEntries.push({
        ...entry, stave: staves[i], definition: staffDefinitions[i], bar,
      })));
      if (bar > 0) parts.forEach((part, i) => {
        const entry = part.entries[0];
        const previous = bars[bar - 1].parts[i].entries.at(-1);
        if (!entry?.continuation || previous?.attackUnit !== entry.attackUnit) return;
        const indices = entry.pitches.map((_, index) => index);
        if (first) {
          barlineTies.push(new StaveTie({ first_note: previous.note, first_indices: indices, last_indices: indices }));
          barlineTies.push(new StaveTie({ last_note: entry.note, first_indices: indices, last_indices: indices }));
        } else barlineTies.push(new StaveTie({
          first_note: previous.note, last_note: entry.note, first_indices: indices, last_indices: indices,
        }));
      });
      allTies.forEach(tie => tie.setContext(context).draw());
      if (first && staves.length > 1) new StaveConnector(staves[0], staves.at(-1)).setType(StaveConnector.type.BRACKET).setContext(context).draw();
      context.fillText(String(exercise.sourceBar ?? bar + 1).padStart(2, '0'), x + 4, y - 10);
      const anchors = new Map();
      voices.forEach(voice => {
        const tickables = voice.getTickables();
        const total = tickables.reduce((sum, note) => sum + note.getTicks().value(), 0);
        let elapsed = 0;
        tickables.forEach(note => {
          anchors.set(elapsed / total, note.getNoteHeadBeginX());
          elapsed += note.getTicks().value();
        });
      });
      anchors.set(1, staves[0].getNoteEndX());
      this.positions.push({
        anchors: [...anchors].sort(([a], [b]) => a - b),
        y: y + 4, height: staffDefinitions.length * 112 - 18, staves, definitions: staffDefinitions,
      });
    }
    barlineTies.forEach(tie => tie.setContext(context).draw());
    const svg = this.element.querySelector('svg');
    this.context = context;
    this.exercise = exercise;
    this.key = key;
    if (this.onAudition) for (const entry of this.feedbackEntries) {
      const heads = entry.note.getSVGElement()?.querySelectorAll('.vf-notehead') ?? [];
      heads.forEach((head, index) => {
        const source = entry.sources.find(source => writtenPitch(source) === entry.pitches[index]);
        if (!source) return;
        head.style.cursor = 'pointer';
        head.setAttribute('role', 'button');
        head.setAttribute('tabindex', '0');
        head.setAttribute('aria-label', `Play MIDI note ${source.pitch}`);
        head.addEventListener('click', () => this.onAudition(source));
        head.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            this.onAudition(source);
          }
        });
      });
    }
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `${exercise.bars} bars of target notation, ${exercise.meter.numerator}/${exercise.meter.denominator}. Chords: ${exercise.chords.filter(Boolean).join(', ')}.${hasBass ? ' Bass guitar is written one octave higher; the bass clef 8 below indicates sounding one octave lower.' : ''}`);
    this.cursor = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    this.cursor.setAttribute('width', '3');
    this.cursor.setAttribute('fill', '#00a88d');
    this.cursor.setAttribute('opacity', '.75');
    this.cursor.style.pointerEvents = 'none';
    svg.append(this.cursor);
    this.update(0);
  }
  clearFeedback() {
    for (const entry of this.feedbackEntries ?? []) {
      for (const head of entry.note.getSVGElement()?.querySelectorAll('.vf-notehead') ?? []) {
        head.style.removeProperty('fill');
        head.style.removeProperty('stroke');
        head.querySelectorAll('path').forEach(path => { path.style.removeProperty('fill'); path.style.removeProperty('stroke'); });
      }
    }
    for (const mark of this.feedbackMarks ?? []) mark.remove();
    this.feedbackMarks = [];
  }
  feedback(pitch, tick, correct) {
    if (!this.positions?.length || !this.exercise) return;
    if (correct) {
      const entries = this.feedbackEntries.filter(entry => entry.sources.some(source =>
        source.pitch === pitch && Math.abs(source.tick - tick) < 1e-5));
      for (const entry of entries) {
        const source = entry.sources.find(source => source.pitch === pitch);
        const index = entry.pitches.indexOf(writtenPitch(source));
        const head = entry.note.getSVGElement()?.querySelectorAll('.vf-notehead')[index];
        if (head) {
          head.style.fill = '#008d42';
          head.style.stroke = '#008d42';
          head.querySelectorAll('path').forEach(path => { path.style.fill = '#008d42'; path.style.stroke = '#008d42'; });
        }
      }
      return;
    }
    const bar = Math.max(0, Math.min(this.exercise.bars - 1, Math.floor(tick / this.exercise.barTicks)));
    const position = this.positions[bar];
    const part = this.exercise.target[0]?.part;
    const source = { pitch, part };
    const staffIndex = Math.max(0, position.definitions.findIndex(definition => definition.accepts(source)));
    const definition = position.definitions[staffIndex];
    const written = writtenPitch(source);
    const flat = /b|^F$|^Dm$|^Gm$|^Cm$|^Fm$/.test(this.key);
    const name = (flat ? flatNames : sharpNames)[written % 12];
    const key = definition.clef === 'percussion' ? drumKeys[pitch] ?? 'e/5' : `${name}/${Math.floor(written / 12) - 1}`;
    const note = new StaveNote({ keys: [key], duration: '8', clef: definition.clef === 'percussion' ? 'treble' : definition.clef });
    note.setStave(position.staves[staffIndex]);
    if (definition.clef !== 'percussion' && name.length > 1) note.addModifier(new Accidental(name.slice(1)), 0);
    const fraction = Math.max(0, Math.min(1, (tick - bar * this.exercise.barTicks) / this.exercise.barTicks));
    const x = this.positionX(position, fraction);
    const voice = new Voice({ num_beats: 1, beat_value: 4 }).setMode(Voice.Mode.SOFT).addTickables([note]);
    new Formatter().joinVoices([voice]).format([voice], 50);
    const tickContext = note.getTickContext();
    tickContext.setX(tickContext.getX() + x - note.getNoteHeadBeginX());
    note.setStyle({ fillStyle: '#ce3030', strokeStyle: '#ce3030' });
    note.setContext(this.context).draw();
    const element = note.getSVGElement();
    if (element) {
      element.setAttribute('aria-label', `Incorrect MIDI note ${pitch}`);
      this.feedbackMarks.push(element);
    }
  }
  positionX(position, fraction) {
    const anchors = position.anchors;
    for (let i = 1; i < anchors.length; i++) {
      const [end, endX] = anchors[i];
      if (fraction <= end) {
        const [start, startX] = anchors[i - 1];
        return startX + (fraction - start) / (end - start) * (endX - startX);
      }
    }
    return anchors.at(-1)[1];
  }
  update(tick, barTicks) {
    if (!this.cursor || !this.positions?.length) return;
    const bar = barTicks ? Math.min(this.positions.length - 1, Math.floor(tick / barTicks)) : 0;
    const pos = this.positions[bar];
    const fraction = barTicks ? (tick % barTicks) / barTicks : 0;
    this.cursor.setAttribute('x', this.positionX(pos, fraction));
    this.cursor.setAttribute('y', pos.y);
    this.cursor.setAttribute('height', pos.height);
    if (bar !== this.previousBar) {
      if (pos.y < this.element.scrollTop || pos.y + pos.height > this.element.scrollTop + this.element.clientHeight) {
        this.element.scrollTop = Math.max(0, pos.y - 16);
      }
      this.previousBar = bar;
    }
  }
}
