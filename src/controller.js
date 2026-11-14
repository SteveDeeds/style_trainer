const MIDI_PREFERENCES_KEY = 'style-trainer-midi-v1';
const portIdentity = port => port ? { id: port.id, name: port.name ?? '', manufacturer: port.manufacturer ?? '' } : null;
const validIdentity = port => port === null || (port && ['id', 'name', 'manufacturer'].every(key => typeof port[key] === 'string'));

export function rememberedMidiPort(ports, identity) {
  if (!identity) return null;
  const connected = [...ports].filter(port => port.state === 'connected');
  const exact = connected.find(port => port.id === identity.id);
  if (exact) return exact;
  if (!identity.name) return null;
  const matches = connected.filter(port => port.name === identity.name &&
    (port.manufacturer ?? '') === identity.manufacturer);
  return matches.length === 1 ? matches[0] : null;
}

export function preferredMidiPort(ports) {
  const connected = [...ports].filter(port => port.state === 'connected');
  const launchpads = connected.filter(port => /launchpad|lpx/i.test(port.name ?? ''));
  return launchpads.find(port => !/daw/i.test(port.name) && /midi(?:in|out)?2|midi\s*2/i.test(port.name))
    ?? launchpads.find(port => !/daw/i.test(port.name) && /midi/i.test(port.name))
    ?? connected.find(port => !/daw/i.test(port.name ?? ''))
    ?? connected[0];
}

export class MidiController {
  constructor(onInput, onChange, onError, { storage, navigator = globalThis.navigator } = {}) {
    Object.assign(this, { onInput, onChange, onError });
    this.storage = storage;
    this.navigator = navigator;
    this.lit = new Set();
    this.input = null;
    this.output = null;
    this.lastInputPitch = null;
    try {
      const saved = (this.storage ?? globalThis.localStorage)?.getItem(MIDI_PREFERENCES_KEY);
      this.preferences = saved ? JSON.parse(saved) : null;
      if (this.preferences && (!validIdentity(this.preferences.input) || !validIdentity(this.preferences.output))) {
        throw new Error('Invalid saved MIDI ports.');
      }
    } catch (error) {
      this.preferences = null;
      this.onError(new Error(`Could not read remembered MIDI ports: ${error.message}`));
    }
  }
  savePreferences() {
    try {
      const storage = this.storage ?? globalThis.localStorage;
      if (!storage) throw new Error('Browser storage is unavailable.');
      storage.setItem(MIDI_PREFERENCES_KEY, JSON.stringify(this.preferences));
    } catch (error) {
      this.onError(new Error(`MIDI works for this session, but its ports could not be remembered: ${error.message}`));
    }
  }
  async autoReconnect() {
    if (!this.preferences || !this.navigator?.requestMIDIAccess || !this.navigator.permissions?.query) return false;
    try {
      const permission = await this.navigator.permissions.query({ name: 'midi', sysex: false });
      if (permission.state !== 'granted' || this.access) return false;
      await this.connect();
      return true;
    } catch (error) {
      throw new Error(`Could not reconnect MIDI automatically. Use Connect MIDI to retry: ${error.message}`);
    }
  }
  async connect() {
    if (!this.navigator?.requestMIDIAccess) throw new Error('Web MIDI is unavailable. Use Chrome or Edge on localhost/HTTPS, or use the on-screen keys.');
    this.access = await this.navigator.requestMIDIAccess({ sysex: false });
    this.access.onstatechange = () => {
      if (this.input?.state === 'disconnected') this.setInput('', false);
      if (this.output?.state === 'disconnected') this.setOutput('', false);
      this.restorePorts();
      this.onChange();
    };
    this.setInput((this.preferences ? rememberedMidiPort(this.access.inputs.values(), this.preferences.input) :
      preferredMidiPort(this.access.inputs.values()))?.id ?? '', false);
    this.setOutput((this.preferences ? rememberedMidiPort(this.access.outputs.values(), this.preferences.output) :
      preferredMidiPort(this.access.outputs.values()))?.id ?? '', false);
    if (!this.preferences) {
      this.preferences = { input: portIdentity(this.input), output: portIdentity(this.output) };
      this.savePreferences();
    }
  }
  restorePorts() {
    if (!this.input && this.preferences?.input) {
      const port = rememberedMidiPort(this.access.inputs.values(), this.preferences.input);
      if (port) this.setInput(port.id, false);
    }
    if (!this.output && this.preferences?.output) {
      const port = rememberedMidiPort(this.access.outputs.values(), this.preferences.output);
      if (port) this.setOutput(port.id, false);
    }
  }
  setInput(id, remember = true) {
    if (this.input) this.input.onmidimessage = null;
    this.input = this.access?.inputs.get(id) ?? null;
    this.lastInputPitch = null;
    this.onInput(null, false);
    if (this.input) this.input.onmidimessage = event => {
      const [status, pitch, velocity] = event.data;
      if ((status & 0xf0) === 0x90 && velocity > 0) this.lastInputPitch = pitch;
      if ((status & 0xf0) === 0x90) this.onInput(pitch, velocity > 0, velocity, event.timeStamp);
      else if ((status & 0xf0) === 0x80) this.onInput(pitch, false, 0, event.timeStamp);
    };
    if (remember) {
      this.preferences = { output: null, ...this.preferences, input: portIdentity(this.input) };
      this.savePreferences();
    }
    this.onChange();
  }
  setOutput(id, remember = true) {
    this.clear();
    this.output = this.access?.outputs.get(id) ?? null;
    if (remember) {
      this.preferences = { input: null, ...this.preferences, output: portIdentity(this.output) };
      this.savePreferences();
    }
    this.onChange();
  }
  send(message) {
    if (!this.output || this.output.state !== 'connected') return;
    try { this.output.send(message); }
    catch (error) { this.onError(error); }
  }
  light(pitch, on) {
    if (on) { this.lit.add(pitch); this.send([0x90, pitch, 60]); }
    else { this.lit.delete(pitch); this.send([0x80, pitch, 0]); }
  }
  clear() {
    for (const pitch of this.lit) this.send([0x80, pitch, 0]);
    this.lit.clear();
  }
  guide(pitches) {
    this.clear();
    for (const pitch of pitches) this.light(pitch, true);
  }
  async testLight() {
    if (!this.output || this.output.state !== 'connected') throw new Error('Select a connected MIDI LED output first.');
    if (this.lastInputPitch === null) throw new Error('Press a Launchpad pad first, then click Test LED to light that same pad.');
    const pitch = this.lastInputPitch;
    this.light(pitch, true);
    await new Promise(resolve => setTimeout(resolve, 800));
    this.light(pitch, false);
  }
}
