export function preferredMidiPort(ports) {
  const connected = [...ports].filter(port => port.state === 'connected');
  const launchpads = connected.filter(port => /launchpad|lpx/i.test(port.name ?? ''));
  return launchpads.find(port => !/daw/i.test(port.name) && /midi(?:in|out)?2|midi\s*2/i.test(port.name))
    ?? launchpads.find(port => !/daw/i.test(port.name) && /midi/i.test(port.name))
    ?? connected.find(port => !/daw/i.test(port.name ?? ''))
    ?? connected[0];
}

export class MidiController {
  constructor(onInput, onChange, onError) {
    Object.assign(this, { onInput, onChange, onError });
    this.lit = new Set();
    this.input = null;
    this.output = null;
    this.lastInputPitch = null;
  }
  async connect() {
    if (!navigator.requestMIDIAccess) throw new Error('Web MIDI is unavailable. Use Chrome or Edge on localhost/HTTPS, or use the on-screen keys.');
    this.access = await navigator.requestMIDIAccess({ sysex: false });
    this.access.onstatechange = () => {
      if (this.input?.state === 'disconnected') this.setInput('');
      if (this.output?.state === 'disconnected') this.setOutput('');
      this.onChange();
    };
    this.onChange();
    this.setInput(preferredMidiPort(this.access.inputs.values())?.id ?? '');
    this.setOutput(preferredMidiPort(this.access.outputs.values())?.id ?? '');
  }
  setInput(id) {
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
    this.onChange();
  }
  setOutput(id) {
    this.clear();
    this.output = this.access?.outputs.get(id) ?? null;
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
