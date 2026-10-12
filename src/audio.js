import * as JSSynth from 'js-synthesizer';
import { assetUrl } from './assets.js';

export function monitorNote(pitch, velocity, source) {
  const program = Number.isInteger(source?.program) && source.program >= 0 && source.program <= 127 ? source.program : 0;
  return { pitch, velocity, channel: source?.part === 'drums' ? 9 : 15, program, bank: 0 };
}

export class AudioEngine {
  constructor() {
    this.voices = new Map();
    this.celebrationVoices = new Set();
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
  celebrate() {
    if (!this.context) throw new Error('Audio must be initialized before playing the congratulations sound.');
    [60, 64, 67, 72].forEach((pitch, index) => {
      const start = this.context.currentTime + index * .14;
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      oscillator.frequency.value = 440 * 2 ** ((pitch - 69) / 12);
      gain.gain.setValueAtTime(.0001, start);
      gain.gain.exponentialRampToValueAtTime(.2, start + .01);
      gain.gain.exponentialRampToValueAtTime(.0001, start + .4);
      oscillator.connect(gain);
      gain.connect(this.gain);
      this.celebrationVoices.add(oscillator);
      oscillator.onended = () => {
        this.celebrationVoices.delete(oscillator);
        oscillator.disconnect();
        gain.disconnect();
      };
      oscillator.start(start);
      oscillator.stop(start + .42);
    });
  }
  on(note) {
    if (!this.context || (this.soundfont === null && !this.preview)) return;
    const key = `${note.channel}:${note.pitch}`;
    const existing = this.voices.get(key);
    if (existing) { existing.count++; return; }
    if (this.soundfont !== null && !this.preview) {
      // A GM drum kit uses bank 128; melodic programs are zero-based.
      this.synth.midiProgramSelect(note.channel, this.soundfont, note.channel === 9 || note.part === 'drums' ? 128 : 0, note.program);
      this.synth.midiNoteOn(note.channel, note.pitch, note.velocity);
      this.voices.set(key, { count: 1, note });
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
      this.voices.set(key, { count: 1, oscillator, gain, note });
    }
  }
  off(note) {
    const key = `${note.channel}:${note.pitch}`;
    const voice = this.voices.get(key);
    if (!voice || --voice.count > 0) return;
    if (voice.oscillator) {
      voice.gain.gain.setTargetAtTime(.0001, this.context.currentTime, .015);
      voice.oscillator.stop(this.context.currentTime + .08);
    } else this.synth.midiNoteOff(note.channel, note.pitch);
    this.voices.delete(key);
  }
  silence() {
    for (const oscillator of this.clickVoices) oscillator.stop();
    this.clickVoices.clear();
    for (const oscillator of this.celebrationVoices) oscillator.stop();
    this.celebrationVoices.clear();
    for (const voice of this.voices.values()) {
      voice.count = 1;
      this.off(voice.note);
    }
    if (this.soundfont !== null) for (let channel = 0; channel < 16; channel++) this.synth.midiAllSoundsOff(channel);
  }
}
