import { inputFeedback, LoopScore, TIMING_TOLERANCE_MS } from './training.js';

export class Transport {
  constructor({ now = () => performance.now(), noteOn, noteOff, retune = () => {}, silence, guide, onState, onResult, onLoop, onError, onBeat = () => {} }) {
    Object.assign(this, { now, noteOn, noteOff, retune, silence, guide, onState, onResult, onLoop, onError, onBeat });
    this.mode = 'stop';
    this.loop = true;
    this.solo = false;
    this.clickEnabled = true;
    this.position = 0;
    this.held = new Set();
    this.activeNotes = new Map();
    // Delay between sending a note to the synth and hearing it; record scoring uses heard time.
    this.latencyMs = 0;
  }
  heardPosition(now = this.now()) {
    if (this.mode !== 'play' && this.mode !== 'record') return this.position;
    const heard = now - this.latencyMs;
    const score = [...this.scores.values()].find(candidate =>
      heard >= candidate.startTime && heard < candidate.endTime);
    if (score) return (heard - score.startTime) / score.msPerTick;
    const elapsed = now - this.latencyMs - this.origin;
    if (elapsed < 0) return 0;
    if (this.finishing || !this.loop) return Math.min(this.exercise.durationTicks, (elapsed - this.cycle * this.duration) / this.msPerTick);
    return (elapsed % this.duration) / this.msPerTick;
  }
  start(mode, exercise, bpm) {
    this.stop();
    this.mode = mode;
    this.exercise = exercise;
    this.msPerTick = 60000 / bpm / exercise.ppq;
    this.bpm = bpm;
    this.duration = exercise.durationTicks / exercise.ppq * 60000 / bpm;
    this.beatMs = 60000 / bpm * 4 / exercise.meter.denominator;
    this.origin = this.now() + (mode === 'record' ? this.beatMs * exercise.meter.numerator : 80);
    this.lastBeat = null;
    this.cycle = 0;
    this.events = this.makeEvents(exercise);
    this.eventIndex = 0;
    this.groupIndex = 0;
    this.waiting = null;
    this.scores = new Map();
    this.prepareScore(0, exercise);
    this.prepareScore(1, exercise);
    this.timer = setInterval(() => {
      try { this.tick(); }
      catch (error) { this.stop(); this.onError(error); }
    }, 5);
    this.onState();
  }
  makeEvents(exercise) {
    return [...(this.solo ? [] : exercise.backing), ...(this.mode === 'record' ? [] : exercise.target)]
      .flatMap((note, id) => [
        { tick: note.tick, type: 'on', note, id },
        { tick: note.tick + note.duration, type: 'off', note, id },
        ...(note.pitchChanges ?? []).map(change => ({ ...change, type: change.action, note, id })),
      ]).sort((a, b) => a.tick - b.tick ||
        ({ off: 0, stop: 0, pitch: 1, retrigger: 2, on: 3 }[a.type] - { off: 0, stop: 0, pitch: 1, retrigger: 2, on: 3 }[b.type]));
  }
  prepareScore(cycle, exercise) {
    if (this.mode === 'record' && (this.loop || cycle <= this.cycle)) {
      const bpm = cycle > this.cycle ? this.pendingBpm ?? this.bpm : this.bpm;
      const msPerTick = 60000 / bpm / exercise.ppq;
      const startTime = this.origin + cycle * this.duration;
      const score = new LoopScore(exercise.groups, msPerTick, startTime, null, exercise.ppq);
      score.exercise = exercise;
      score.cycle = cycle;
      score.startTime = startTime;
      score.endTime = startTime + exercise.durationTicks * msPerTick;
      score.msPerTick = msPerTick;
      this.scores.set(cycle, score);
    }
  }
  setLoop(enabled) {
    this.loop = enabled;
    if (this.mode !== 'record') return;
    if (enabled) this.prepareScore(this.cycle + 1, this.pending ?? this.exercise);
    else this.scores.delete(this.cycle + 1);
  }
  queueExercise(exercise, bpm = this.bpm) {
    this.pending = exercise;
    this.pendingBpm = bpm;
    this.prepareScore(this.cycle + 1, exercise);
  }
  tick() {
    if (this.mode === 'stop') return;
    const now = this.now();
    if (this.mode === 'record') {
      const beat = Math.floor((now - this.origin) / this.beatMs);
      if (beat !== this.lastBeat && !this.finishing) {
        this.lastBeat = beat;
        if (beat < 0 || this.clickEnabled) this.onBeat(((beat % this.exercise.meter.numerator) + this.exercise.meter.numerator) % this.exercise.meter.numerator === 0, beat < 0);
      }
      const heard = now - this.latencyMs;
      for (const [cycle, score] of this.scores) {
        if (heard >= score.endTime + (score.halfTolerance ?? TIMING_TOLERANCE_MS)) {
          this.scores.delete(cycle);
          this.onResult(score.result(), cycle + 1, score.exercise, score.inputs);
          if (this.mode === 'stop') return;
        }
      }
      if (this.finishing && heard >= this.finishing) { this.stop({ feedback: false }); return; }
    }
    if (this.waiting || this.finishing) return;
    let elapsed = now - this.origin - this.cycle * this.duration;
    this.position = Math.max(0, Math.min(this.exercise.durationTicks, elapsed / this.msPerTick));
    if (elapsed < 0) return;
    if (this.mode === 'step') {
      const group = this.exercise.groups[this.groupIndex];
      if (group && this.position >= group.tick) {
        this.position = group.tick;
        this.waiting = { group, since: now, overshoot: elapsed - group.tick * this.msPerTick, played: new Set() };
        this.guide(group.pitches);
        this.onState();
      }
    }
    if (this.mode !== 'record') {
      const beat = Math.floor((this.cycle * this.exercise.durationTicks + this.position) * this.msPerTick / this.beatMs);
      if (beat !== this.lastBeat) {
        this.lastBeat = beat;
        if (this.clickEnabled) this.onBeat(beat % this.exercise.meter.numerator === 0, false);
      }
    }
    while (this.eventIndex < this.events.length && this.events[this.eventIndex].tick <= this.position + 1e-7) {
      const event = this.events[this.eventIndex++];
      if (this.waiting && event.type === 'on' && event.tick === this.waiting.group.tick) {
        this.eventIndex--;
        break;
      }
      if (event.type === 'on') {
        this.noteOn(event.note, event.id);
        this.activeNotes.set(event.id, event.note);
      } else if (event.type === 'off' || event.type === 'stop') {
        const active = this.activeNotes.get(event.id);
        if (active) this.noteOff(active, event.id);
        this.activeNotes.delete(event.id);
      } else if (event.type === 'pitch') {
        const active = this.activeNotes.get(event.id);
        if (active) {
          this.retune(active, event.pitch, event.id);
          this.activeNotes.set(event.id, { ...active, pitch: event.pitch });
        }
      } else if (event.type === 'retrigger') {
        const active = this.activeNotes.get(event.id);
        if (active) this.noteOff(active, event.id);
        const retargeted = { ...event.note, pitch: event.pitch };
        this.noteOn(retargeted, event.id);
        this.activeNotes.set(event.id, retargeted);
      }
    }
    if (!this.waiting && elapsed >= this.duration) {
      this.silence({ feedback: false });
      this.activeNotes.clear();
      this.guide([]);
      if (!this.loop) {
        if (this.mode === 'record') {
          const halfTolerance = this.scores.get(this.cycle)?.halfTolerance ?? TIMING_TOLERANCE_MS;
          this.finishing = this.origin + (this.cycle + 1) * this.duration + halfTolerance;
        } else this.stop();
        return;
      }
      // Do not burst missed notes after the browser has throttled the timer.
      if (elapsed > this.duration * 2) throw new Error('Playback fell behind. Keep this tab active and restart the exercise.');
      const nextStart = this.origin + (this.cycle + 1) * this.duration;
      this.cycle++;
      if (this.pending) {
        this.exercise = this.pending;
        this.bpm = this.pendingBpm;
        this.pending = null;
        this.pendingBpm = null;
        this.msPerTick = 60000 / this.bpm / this.exercise.ppq;
        this.duration = this.exercise.durationTicks * this.msPerTick;
        this.beatMs = 60000 / this.bpm * 4 / this.exercise.meter.denominator;
        this.origin = nextStart - this.cycle * this.duration;
        this.lastBeat = null;
      }
      this.position = Math.max(0, (now - nextStart) / this.msPerTick);
      this.events = this.makeEvents(this.exercise);
      this.eventIndex = 0;
      this.groupIndex = 0;
      this.prepareScore(this.cycle + 1, this.exercise);
      this.onLoop(this.cycle + 1);
      this.onState();
    }
  }
  input(pitch, on, timestamp = this.now()) {
    if (on) this.held.add(pitch); else this.held.delete(pitch);
    if (!on || this.mode === 'stop') return null;
    if (this.mode === 'step' && this.waiting) {
      if (this.waiting.group.pitches.includes(pitch)) this.waiting.played.add(pitch);
      // Melodic chord shapes must be held together; percussion may be tapped.
      const correct = this.waiting.group.pitches.includes(pitch) && this.waiting.group.notes.every(n => n.part === 'drums' ?
        this.waiting.played.has(n.pitch) : this.held.has(n.pitch));
      if (correct) {
        const wait = this.waiting;
        this.origin += this.now() - wait.since + wait.overshoot;
        this.groupIndex++;
        this.waiting = null;
        this.guide([]);
        this.onState();
        return true;
      }
      return this.waiting.group.pitches.includes(pitch);
    }
    if (this.mode === 'record') {
      timestamp -= this.latencyMs;
      const activeScores = [...this.scores.values()];
      const tolerance = activeScores[0]?.halfTolerance ?? TIMING_TOLERANCE_MS;
      this.feedback = timestamp < this.origin - tolerance ? { reason: 'count-in', offsetMs: null, expectedPitches: [] } :
        inputFeedback(activeScores.flatMap(score => score.expected), pitch, timestamp, tolerance);
      const candidates = activeScores.flatMap(score =>
        score.expected.filter(n => !n.hit && n.pitch === pitch && Math.abs(n.time - timestamp) <= (score.halfTolerance ?? TIMING_TOLERANCE_MS) + 1e-7)
          .map(note => ({ score, note })));
      const match = candidates.sort((a, b) => Math.abs(a.note.time - timestamp) - Math.abs(b.note.time - timestamp))[0];
      if (match) {
        this.feedback = { ...inputFeedback(match.score.expected, pitch, timestamp, match.score.halfTolerance), targetCycle: match.score.cycle,
          targetTick: (match.note.time - match.score.startTime) / match.score.msPerTick };
        const accepted = match.score.input(pitch, timestamp);
        this.feedback.credit = match.note.credit;
        return accepted;
      }
      const score = activeScores.find(candidate => timestamp >= candidate.startTime && timestamp < candidate.endTime);
      score?.input(pitch, timestamp);
      return timestamp < this.origin - tolerance ? null : false;
    }
    return null;
  }
  stop({ feedback = true } = {}) {
    clearInterval(this.timer);
    this.activeNotes.clear();
    this.mode = 'stop';
    this.position = 0;
    this.cycle = 0;
    this.waiting = null;
    this.finishing = null;
    this.pending = null;
    this.pendingBpm = null;
    this.feedback = null;
    this.held.clear();
    this.silence({ feedback });
    this.guide([]);
    this.onState();
  }
}
