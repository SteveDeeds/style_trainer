import * as JSSynth from 'js-synthesizer';
import { assetUrl, ENCOURAGEMENT_SAMPLES } from './assets.js';

export function monitorNote(pitch, velocity, source) {
  const program = Number.isInteger(source?.program) && source.program >= 0 && source.program <= 127 ? source.program : 0;
  return { pitch, velocity, channel: source?.part === 'drums' ? 9 : 15, program, bank: 0 };
}

export class AudioEngine {
  constructor() {
    this.voices = new Map();
    this.voiceIds = new Map();
    this.noteKeys = new WeakMap();
    this.celebrationVoices = new Set();
    this.encouragementBuffers = new Map();
    this.lastEncouragement = new Map();
    this.clickVoices = new Set();
    this.clickSound = 'clave';
    this.soundfont = null;
    this.preview = false;
    this.volume = .65;
  }
  async resume() {
    if (!this.context) {
      this.context = new AudioContext({ latencyHint: 'interactive' });
      this.gain = this.context.createGain();
      this.gain.gain.value = this.volume;
      this.gain.connect(this.context.destination);
    }
    await this.context.resume();
  }
  outputLatencyMs() {
    if (!this.context) return 0;
    return ((this.context.baseLatency || 0) + (this.context.outputLatency || 0)) * 1000;
  }
  async loadSoundfont(buffer) {
    const header = new Uint8Array(buffer, 0, Math.min(12, buffer.byteLength));
    if (String.fromCharCode(...header.slice(0, 4)) !== 'RIFF' ||
      String.fromCharCode(...header.slice(8, 12)) !== 'sfbk') {
      throw new Error('Invalid SoundFont data. Load a valid .sf2 file.');
    }
    await this.resume();
    if (!this.synth) {
      await this.context.audioWorklet.addModule(assetUrl('synth/fluid.js'));
      await this.context.audioWorklet.addModule(assetUrl('synth/synth.worklet.js'));
      const synth = new JSSynth.AudioWorkletNodeSynthesizer();
      synth.init(this.context.sampleRate);
      const node = synth.createAudioNode(this.context);
      node.connect(this.gain);
      this.synth = synth;
    }
    const id = await this.synth.loadSFont(buffer);
    if (this.soundfont !== null) await this.synth.unloadSFontAsync(this.soundfont);
    this.soundfont = id;
  }
  setVolume(value) {
    this.volume = value;
    if (this.gain) this.gain.gain.setValueAtTime(value, this.context.currentTime);
  }
  click(accent) {
    if (!this.context) return;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    // Independent synthesized percussion avoids changing a style track's SF2 kit.
    const sideStick = this.clickSound === 'side-stick';
    oscillator.type = sideStick ? 'triangle' : 'sine';
    oscillator.frequency.value = sideStick ? 850 : 2200;
    gain.gain.setValueAtTime(accent ? .18 : .12, this.context.currentTime);
    gain.gain.exponentialRampToValueAtTime(.0001, this.context.currentTime + .04);
    oscillator.connect(gain);
    gain.connect(this.gain);
    this.clickVoices.add(oscillator);
    oscillator.onended = () => {
      this.clickVoices.delete(oscillator);
      oscillator.disconnect();
      gain.disconnect();
    };
    oscillator.start();
    oscillator.stop(this.context.currentTime + .05);
  }
  async loadEncouragement() {
    if (!this.context) throw new Error('Audio must be initialized before loading encouragement samples.');
    if (this.encouragementLoading) return this.encouragementLoading;
    this.encouragementLoading = Promise.all(Object.values(ENCOURAGEMENT_SAMPLES).flat().map(async file => {
      if (this.encouragementBuffers.has(file)) return;
      const response = await fetch(assetUrl(`samples/${encodeURIComponent(file)}`));
      if (!response.ok) throw new Error(`Encouragement sample "${file}" could not be loaded (HTTP ${response.status}).`);
      const buffer = await this.context.decodeAudioData(await response.arrayBuffer());
      this.encouragementBuffers.set(file, buffer);
    }));
    try {
      await this.encouragementLoading;
    } finally {
      this.encouragementLoading = null;
    }
  }
  encourage(kind) {
    const files = ENCOURAGEMENT_SAMPLES[kind];
    if (!Object.hasOwn(ENCOURAGEMENT_SAMPLES, kind)) throw new Error('Choose an up, down, qualifying or advance encouragement cue.');
    if (!this.context || files.some(file => !this.encouragementBuffers.has(file))) {
      throw new Error('Load encouragement samples before playing a cue.');
    }
    const choices = files.filter(file => file !== this.lastEncouragement.get(kind));
    const file = choices[Math.floor(Math.random() * choices.length)];
    for (const voice of this.celebrationVoices) voice.stop();
    this.celebrationVoices.clear();
    const source = this.context.createBufferSource();
    source.buffer = this.encouragementBuffers.get(file);
    source.connect(this.gain);
    this.celebrationVoices.add(source);
    source.onended = () => {
      this.celebrationVoices.delete(source);
      source.disconnect();
    };
    source.start();
    this.lastEncouragement.set(kind, file);
  }
  tempoChange(direction) {
    if (direction !== 'up' && direction !== 'down') throw new Error('Choose an up or down tempo cue.');
    this.encourage(direction);
  }
  on(note, voiceId = null) {
    if (!this.context || (this.soundfont === null && !this.preview)) return;
    const shiftable = !!note.pitchChanges?.some(change => change.action === 'pitch');
    const occupied = channel => [...this.voices.values()].some(voice => voice.channel === channel);
    const allocateChannel = () => {
      const channel = Array.from({ length: 15 }, (_, index) => index < 9 ? index : index + 1)
        .find(candidate => candidate !== note.channel && !occupied(candidate));
      if (channel === undefined) throw new Error('CASM pitch-shift playback needs an available MIDI channel, but all melodic channels are occupied.');
      return channel;
    };
    const drumChannel = note.channel === 9 || note.part === 'drums';
    const channel = this.preview || drumChannel ? note.channel :
      shiftable ? allocateChannel() : note.channel;
    const key = voiceId !== null && shiftable ? `voice:${voiceId}` : `${channel}:${note.pitch}`;
    const existing = this.voices.get(key);
    if (existing) { existing.count++; if (voiceId !== null) this.voiceIds.set(voiceId, key); return; }
    const playbackNote = channel === note.channel ? note : { ...note, channel };
    if (this.soundfont !== null && !this.preview) {
      // A GM drum kit uses bank 128; melodic programs are zero-based.
      this.synth.midiProgramSelect(channel, this.soundfont, channel === 9 || note.part === 'drums' ? 128 : 0, note.program);
      if (shiftable) this.synth.midiPitchWheelSensitivity(channel, 12);
      this.synth.midiNoteOn(channel, note.pitch, note.velocity);
      this.voices.set(key, { count: 1, note: playbackNote, channel, basePitch: note.pitch, isolated: shiftable });
    } else {
      // Explicitly labeled lightweight preview, not a substitute for a GM SoundFont.
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      const drum = note.channel === 9 || note.part === 'drums';
      oscillator.type = drum ? 'triangle' : 'sine';
      oscillator.frequency.value = 440 * 2 ** ((note.pitch - 69) / 12);
      gain.gain.setValueAtTime(note.velocity / 127 * .12, this.context.currentTime);
      if (drum) {
        oscillator.frequency.exponentialRampToValueAtTime(40, this.context.currentTime + .1);
        gain.gain.exponentialRampToValueAtTime(.001, this.context.currentTime + .13);
      }
      oscillator.connect(gain);
      gain.connect(this.gain);
      oscillator.start();
      this.voices.set(key, { count: 1, oscillator, gain, note: playbackNote, channel, basePitch: note.pitch, isolated: shiftable });
    }
    if (voiceId !== null) this.voiceIds.set(voiceId, key);
    if (note && typeof note === 'object') this.noteKeys.set(note, key);
  }
  off(note, voiceId = null) {
    const key = voiceId !== null ? this.voiceIds.get(voiceId) :
      note && typeof note === 'object' ? this.noteKeys.get(note) ?? `${note.channel}:${note.pitch}` : `${note.channel}:${note.pitch}`;
    const voice = this.voices.get(key);
    if (voiceId !== null) this.voiceIds.delete(voiceId);
    if (!voice || --voice.count > 0) return;
    this.releaseVoice(key, voice);
  }
  releaseVoice(key, voice) {
    if (voice.oscillator) {
      voice.gain.gain.setTargetAtTime(.0001, this.context.currentTime, .015);
      voice.oscillator.stop(this.context.currentTime + .08);
    } else {
      this.synth.midiNoteOff(voice.channel, voice.basePitch);
      if (voice.isolated) this.synth.midiPitchBend(voice.channel, 8192);
    }
    this.voices.delete(key);
  }
  retune(note, pitch, voiceId) {
    const key = this.voiceIds.get(voiceId);
    const voice = this.voices.get(key);
    if (!voice) return;
    if (voice.oscillator) {
      voice.oscillator.frequency.setValueAtTime(440 * 2 ** ((pitch - 69) / 12), this.context.currentTime);
    } else {
      const semitones = pitch - voice.basePitch;
      if (Math.abs(semitones) > 12) throw new Error('CASM pitch shift exceeds the configured ±12-semitone pitch-bend range.');
      this.synth.midiPitchBend(voice.channel, Math.round(8192 + semitones * 8192 / 12));
    }
    voice.note = { ...voice.note, pitch };
  }
  silence({ feedback = true } = {}) {
    for (const oscillator of this.clickVoices) oscillator.stop();
    this.clickVoices.clear();
    this.voiceIds.clear();
    if (feedback) {
      for (const oscillator of this.celebrationVoices) oscillator.stop();
      this.celebrationVoices.clear();
    }
    for (const [key, voice] of this.voices) {
      voice.count = 1;
      this.releaseVoice(key, voice);
    }
    if (this.soundfont !== null) for (let channel = 0; channel < 16; channel++) this.synth.midiAllSoundsOff(channel);
  }
}
