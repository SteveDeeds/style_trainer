import test from 'node:test';
import assert from 'node:assert/strict';
import { MidiController, rememberedMidiPort } from '../src/controller.js';

const port = (id, name = 'Practice controller') => ({
  id, name, manufacturer: 'Test manufacturer', state: 'connected', send() {},
});
const memoryStorage = () => {
  const entries = new Map();
  return { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) };
};
function harness({ storage = memoryStorage(), inputs = [port('input')], outputs = [port('output')], permission = 'granted' } = {}) {
  const access = {
    inputs: new Map(inputs.map(port => [port.id, port])),
    outputs: new Map(outputs.map(port => [port.id, port])),
  };
  const errors = [];
  const received = [];
  const requests = [];
  const navigator = {
    permissions: { query: async options => {
      assert.deepEqual(options, { name: 'midi', sysex: false });
      return { state: permission };
    } },
    requestMIDIAccess: async options => { requests.push(options); return access; },
  };
  const controller = new MidiController((...args) => received.push(args), () => {}, error => errors.push(error),
    { storage, navigator });
  return { controller, access, storage, navigator, errors, received, requests };
}

test('first connection remembers ports and later visits reconnect without an audio gesture', async () => {
  const first = harness();
  assert.equal(await first.controller.autoReconnect(), false);
  assert.equal(first.requests.length, 0, 'a first visit never prompts automatically');
  await first.controller.connect();
  const next = harness({ storage: first.storage });
  assert.equal(await next.controller.autoReconnect(), true);
  assert.equal(next.controller.input.id, 'input');
  assert.equal(next.controller.output.id, 'output');
  assert.deepEqual(next.requests, [{ sysex: false }]);
  next.controller.input.onmidimessage({ data: [0x90, 60, 100], timeStamp: 42 });
  assert.deepEqual(next.received.at(-1), [60, true, 100, 42]);
});

test('manual port choices and explicit Off survive refresh and hotplug', async () => {
  const first = harness({ inputs: [port('a'), port('b', 'Other controller')] });
  await first.controller.connect();
  first.controller.setInput('b');
  first.controller.setOutput('');
  const next = harness({ storage: first.storage, inputs: [port('a'), port('b', 'Other controller')] });
  await next.controller.autoReconnect();
  assert.equal(next.controller.input.id, 'b');
  assert.equal(next.controller.output, null);
  const disconnected = next.controller.input;
  disconnected.state = 'disconnected';
  next.access.onstatechange();
  assert.equal(next.controller.input, null);
  assert.equal(disconnected.onmidimessage, null);
  disconnected.state = 'connected';
  next.access.onstatechange();
  assert.equal(next.controller.input, disconnected);
  assert.equal(next.controller.output, null, 'hotplug must not enable an intentionally disabled LED output');
  next.controller.setInput('');
  next.access.onstatechange();
  assert.equal(next.controller.input, null);
  const stopped = harness({ storage: first.storage });
  await stopped.controller.autoReconnect();
  assert.equal(stopped.controller.input, null);
  assert.equal(stopped.controller.output, null);
});

test('missing preferred devices wait for hotplug rather than choosing an unrelated port', async () => {
  const first = harness();
  await first.controller.connect();
  const next = harness({ storage: first.storage, inputs: [port('other', 'Other controller')], outputs: [] });
  await next.controller.autoReconnect();
  assert.equal(next.controller.input, null);
  assert.equal(next.controller.output, null);
  const returning = port('changed-id');
  next.access.inputs.set(returning.id, returning);
  next.access.onstatechange();
  assert.equal(next.controller.input, returning, 'a unique name/manufacturer match survives port ID changes');
});

test('matching uses IDs first and never guesses between identical devices', () => {
  const identity = { id: 'a', name: 'Practice controller', manufacturer: 'Test manufacturer' };
  const a = port('a');
  const b = port('b');
  assert.equal(rememberedMidiPort([a, b], identity), a);
  assert.equal(rememberedMidiPort([b, port('c')], identity), null);
  assert.equal(rememberedMidiPort([port('d', 'Wrong controller')], identity), null);
  assert.equal(rememberedMidiPort([port('changed', '')], { ...identity, name: '' }), null);
});

test('permission prompt and denied states never request MIDI automatically', async () => {
  const first = harness();
  await first.controller.connect();
  for (const permission of ['prompt', 'denied']) {
    const next = harness({ storage: first.storage, permission });
    assert.equal(await next.controller.autoReconnect(), false);
    assert.equal(next.requests.length, 0);
    assert.equal(next.controller.input, null);
  }
});

test('unsupported permission queries and permission failures leave manual connection available', async () => {
  const first = harness();
  await first.controller.connect();
  const next = harness({ storage: first.storage });
  next.navigator.permissions.query = async () => { throw new Error('Unsupported permission descriptor'); };
  await assert.rejects(next.controller.autoReconnect(), /Use Connect MIDI.*Unsupported/);
  assert.equal(next.requests.length, 0);
  await next.controller.connect();
  assert.equal(next.controller.input.id, 'input');
});

test('storage errors are surfaced but do not prevent MIDI from working', async () => {
  const errors = [];
  const storage = {
    getItem: () => { throw new Error('Storage blocked'); },
    setItem: () => { throw new Error('Storage blocked'); },
  };
  const h = harness({ storage });
  errors.push(...h.errors);
  assert.match(errors[0].message, /Could not read remembered MIDI ports/);
  await h.controller.connect();
  assert.equal(h.controller.input.id, 'input');
  assert.match(h.errors.at(-1).message, /could not be remembered/);
});
