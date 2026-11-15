import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioEngine } from '../src/audio.js';
import { assetUrl, ENCOURAGEMENT_SAMPLES } from '../src/assets.js';
import { readdir, readFile } from 'node:fs/promises';
import { masteryFanfarePitches, practiceExercise, Progression } from '../src/training.js';
import { Transport } from '../src/transport.js';

const pattern = (level = 1) => ({
  level, maxLevel: 4, ppq: 480, bars: 1, durationTicks: 1920, barTicks: 1920,
  meter: { numerator: 4, denominator: 4 },
  target: [], backing: [], chords: ['C'],
  groups: [{ tick: 0, pitches: [60], notes: [] }],
});
const exerciseAt = (speed, level = 1) =>
  practiceExercise(pattern(level), { bpm: 120, normalBpm: 120, speed });

test('struggling slows one ladder step below 60%, preserves density, and resets the window', () => {
  const progression = new Progression(4);
  progression.selectLevel(2);
  for (const speed of [100, 75]) {
    const exercise = exerciseAt(speed, 2);
    assert.equal(progression.submitExercise(60, exercise), null);
    assert.equal(progression.submitExercise(60, exercise), null);
    assert.equal(progression.submitExercise(60, exercise), null);
    assert.deepEqual(progression.submitExercise(59, exercise), {
      nextSpeed: speed === 100 ? 75 : 50, slowedDown: true,
    });
    assert.equal(progression.level, 2);
    assert.equal(progression.streak, 0);
  }
  for (let i = 0; i < 6; i++) assert.equal(progression.submitExercise(0, exerciseAt(50, 2)), null);
  assert.equal(progression.level, 2);
});

test('practice-only settings never trigger automatic slowdowns', () => {
  for (const options of [{ bar: 0, speed: 100 }, { bpm: 80, speed: 100 }, { speed: 90 }, { speed: 25 }]) {
    const exercise = practiceExercise(pattern(), { bpm: 120, normalBpm: 120, ...options });
    const progression = new Progression(4);
    for (let i = 0; i < 6; i++) assert.equal(progression.submitExercise(0, exercise), null);
    assert.equal(progression.streak, 0);
  }
});

test('density and speed advances require three individually qualifying loops, not an average or a streak', () => {
  for (const speed of [50, 75, 100]) {
    const progression = new Progression(4);
    const exercise = exerciseAt(speed);
    for (const [score, count] of [[80, 1], [75, 1], [85, 2], [79.99, 2]]) {
      assert.equal(progression.submitExercise(score, exercise), null);
      assert.equal(progression.streak, count);
    }
    assert.deepEqual(progression.submitExercise(80, exercise),
      speed === 100 ? { level: 2 } : { nextSpeed: speed === 50 ? 75 : 100 });
    assert.equal(progression.streak, 0);
    assert.equal(progression.qualifyingScores.length, 0);
    assert.equal(progression.scores.length, 0);
  }
});

test('manual resets and automatic slowdowns clear qualifying progress for the changed settings', () => {
  const progression = new Progression(4);
  progression.submit(100);
  progression.streak = 0;
  assert.equal(progression.streak, 0);
  assert.equal(progression.average, 0);
  const exercise = exerciseAt(100);
  progression.submitExercise(90, exercise);
  progression.submitExercise(0, exercise);
  assert.deepEqual(progression.submitExercise(0, exercise), { nextSpeed: 75, slowedDown: true });
  assert.equal(progression.streak, 0);
  assert.equal(progression.qualifyingScores.length, 0);
});

test('mastering the top density at normal speed advances to the 125% bonus without raising density', () => {
  const progression = new Progression(4);
  progression.selectLevel(4);
  const exercise = exerciseAt(100, 4);
  assert.equal(exercise.nextSpeed, 125);
  for (const score of [80, 70, 90, 79.99]) assert.equal(progression.submitExercise(score, exercise), null);
  assert.deepEqual(progression.submitExercise(80, exercise), { nextSpeed: 125 });
  assert.equal(progression.level, 4);
  assert.equal(progression.streak, 0);
  const bonus = exerciseAt(125, 4);
  assert.equal(bonus.nextSpeed, null);
  for (let set = 0; set < 2; set++) {
    assert.equal(progression.submitExercise(80, bonus), null);
    assert.equal(progression.submitExercise(80, bonus), null);
    assert.deepEqual(progression.submitExercise(80, bonus), { level: 4 });
  }
});

test('125% is freely available at every density, capped, and can slow to 100%', () => {
  for (const level of [1, 2, 3, 4]) {
    const bonus = exerciseAt(125, level);
    assert.equal(bonus.playbackBpm, 150);
    assert.equal(bonus.practiceOnly, false);
    assert.equal(bonus.nextSpeed, null);
    assert.equal(bonus.previousSpeed, 100);
    const progression = new Progression(4);
    progression.selectLevel(level);
    for (let i = 0; i < 2; i++) assert.equal(progression.submitExercise(0, bonus), null);
    assert.deepEqual(progression.submitExercise(0, bonus), { nextSpeed: 100, slowedDown: true });
    assert.equal(progression.level, level);
    assert.equal(progression.submitExercise(80, bonus), null);
    assert.equal(progression.submitExercise(80, bonus), null);
    assert.deepEqual(progression.submitExercise(80, bonus), { level: Math.min(4, level + 1) });
  }
  assert.throws(() => exerciseAt(126), /25% to 125%/);
  for (const options of [{ bar: 0 }, { bpm: 80 }]) {
    const exercise = practiceExercise(pattern(4), { bpm: 120, normalBpm: 120, speed: 125, ...options });
    assert.equal(exercise.practiceOnly, true);
    assert.equal(exercise.nextSpeed, null);
    assert.equal(exercise.previousSpeed, null);
  }
});

test('mastery fanfare follows major and minor keys, including accidentals', () => {
  assert.deepEqual(masteryFanfarePitches('C'), [60, 60, 60, 64, 67, 72, 67, 72]);
  assert.deepEqual(masteryFanfarePitches('Dm'), [62, 62, 62, 65, 69, 74, 69, 74]);
  assert.deepEqual(masteryFanfarePitches('Bb'), [70, 70, 70, 74, 77, 82, 77, 82]);
  assert.deepEqual(masteryFanfarePitches('F#m'), [66, 66, 66, 69, 73, 78, 73, 78]);
  assert.deepEqual(masteryFanfarePitches('Cb'), masteryFanfarePitches('B'));
  assert.throws(() => masteryFanfarePitches('Unknown'), /known major or minor key/);
});

function harness() {
  let now = 0;
  const results = [];
  const silences = [];
  const beats = [];
  const transport = new Transport({
    now: () => now, noteOn: () => {}, noteOff: () => {},
    silence: options => silences.push(options), guide: () => {}, onState: () => {},
    onResult: (result, loop, exercise) => results.push({ ...result, loop, exercise }),
    onLoop: () => {}, onError: error => { throw error; },
    onBeat: (accent, countIn) => beats.push({ accent, countIn }),
  });
  return { transport, results, silences, beats, advance: time => { now = time; transport.tick(); } };
}

test('early loop downbeats keep full/half credit across boundaries without penalizing the outgoing loop', () => {
  for (const latency of [0, 80, 400]) {
    for (const [early, credit] of [[60, 1], [125, .5]]) {
      const h = harness();
      try {
        h.transport.latencyMs = latency;
        const exercise = exerciseAt(100);
        h.transport.start('record', exercise, 120);
        const score = h.transport.scores.get(1);
        const boundary = score.startTime;
        assert.equal(h.transport.input(60, true, boundary - early + latency), true);
        assert.equal(h.transport.feedback.reason, 'hit');
        assert.equal(h.transport.feedback.targetTick, 0);
        assert.equal(h.transport.feedback.targetCycle, 1);
        assert.equal(h.transport.feedback.credit, credit);
        assert.equal(score.expected[0].credit, credit);
        assert.equal(h.transport.scores.get(0).extra, 0);
        h.advance(boundary + 1);
        assert.equal(h.transport.scores.get(1), score);
        assert.equal(score.expected[0].hit, true);
        h.advance(score.endTime + score.halfTolerance + latency + 1);
        assert.equal(h.results.find(result => result.loop === 2).score, credit * 100);
      } finally { h.transport.stop(); }
    }
  }
});

test('out-of-window early downbeats do not consume the next loop target', () => {
  const h = harness();
  try {
    h.transport.start('record', exerciseAt(100), 120);
    const next = h.transport.scores.get(1);
    assert.equal(h.transport.input(60, true, next.startTime - next.halfTolerance - 1), false);
    assert.equal(next.expected[0].hit, false);
    assert.equal(h.transport.scores.get(0).extra, 1);
    assert.equal(h.transport.input(60, true, next.startTime - next.perfectTolerance), true);
    assert.equal(next.expected[0].credit, 1);
  } finally { h.transport.stop(); }
});

test('early downbeat feedback uses the new tempo tolerance when a slowdown is queued', () => {
  const h = harness();
  try {
    h.transport.start('record', exerciseAt(100), 120);
    const next = exerciseAt(75);
    h.transport.queueExercise(next, next.playbackBpm);
    const score = h.transport.scores.get(1);
    assert.equal(h.transport.input(60, true, score.startTime - 150), true);
    assert.equal(h.transport.feedback.reason, 'hit');
    assert.equal(h.transport.feedback.targetCycle, 1);
    assert.equal(score.expected[0].credit, .5);
  } finally { h.transport.stop(); }
});

for (const [from, to] of [[75, 100], [100, 75], [75, 50]]) {
  test(`tempo ${from}% to ${to}% preserves boundary, scoring, latency and count-in`, () => {
    const h = harness();
    const old = exerciseAt(from);
    const next = exerciseAt(to);
    try {
      h.transport.latencyMs = 80;
      h.transport.start('record', old, old.playbackBpm);
      const start = h.transport.origin;
      const duration = h.transport.duration;
      const boundary = start + duration;
      h.advance(start);
      h.transport.input(60, true, start + 80);
      h.transport.queueExercise(next, next.playbackBpm);
      assert.equal(h.transport.exercise, old);
      const nextScore = h.transport.scores.get(1);
      assert.equal(nextScore.startTime, boundary);
      assert.equal(nextScore.msPerTick, 60000 / next.playbackBpm / next.ppq);
      // Early next-loop input must use the new tempo's score without resetting it at the boundary.
      assert.equal(h.transport.input(60, true, boundary + 40), true);
      h.advance(boundary);
      assert.equal(h.transport.mode, 'record');
      assert.equal(h.transport.exercise, next);
      assert.equal(h.transport.origin + h.transport.cycle * h.transport.duration, boundary);
      assert.equal(h.transport.scores.get(1), nextScore);
      assert.equal(h.transport.heardPosition(boundary + 40), (duration - 40) / (60000 / old.playbackBpm / old.ppq));
      h.advance(boundary + 300);
      assert.equal(h.results.length, 1);
      assert.equal(h.results[0].score, 100);
      assert.equal(h.results[0].exercise, old);
      assert.equal(h.transport.heardPosition(boundary + 300), 220 / nextScore.msPerTick);
      h.advance(boundary + h.transport.duration);
      h.advance(boundary + h.transport.duration + 400);
      assert.equal(h.results[1].score, 100);
      assert.equal(h.results[1].exercise, next);
      assert.ok(h.beats.every(beat => !beat.countIn), 'no second count-in');
      assert.ok(h.silences.slice(1).every(options => options.feedback === false));
    } finally { h.transport.stop(); }
  });
}

test('density progression continues and ignores outgoing loops until the new density starts', () => {
  const h = harness();
  const progression = new Progression(2);
  const first = exerciseAt(100);
  let changes = 0;
  h.transport.onResult = (result, loop, exercise) => {
    if (h.transport.pending || exercise !== h.transport.exercise) return;
    if (progression.submitExercise(result.score, exercise)) {
      changes++;
      h.transport.queueExercise(exerciseAt(100, progression.level), 120);
    }
  };
  try {
    h.transport.start('record', first, 120);
    for (let cycle = 0; cycle < 5; cycle++) {
      const start = 2000 + cycle * 2000;
      h.advance(start);
      h.transport.input(60, true, start);
      h.advance(start + 2000);
      h.advance(start + 2200);
      assert.equal(h.transport.mode, 'record');
    }
    assert.equal(changes, 1);
    assert.equal(progression.level, 2);
    assert.equal(h.transport.exercise.level, 2);
    assert.equal(progression.streak, 1, 'only a fully played loop at the new density qualifies');
  } finally { h.transport.stop(); }
});

test('loop off still stops after scoring even when a tempo change is queued', () => {
  const h = harness();
  try {
    const first = exerciseAt(100);
    h.transport.loop = false;
    h.transport.start('record', first, 120);
    h.transport.onResult = () => h.transport.queueExercise(exerciseAt(75), 90);
    h.advance(2000);
    h.advance(4000);
    h.advance(4200);
    assert.equal(h.transport.mode, 'stop');
    assert.equal(h.transport.pending, null);
  } finally { h.transport.stop(); }
});

test('encouragement uses the correct sample groups, avoids repeats, and respects Stop and loop boundaries', () => {
  const audio = new AudioEngine();
  const sources = [];
  const gains = [];
  audio.context = {
    createGain: () => {
      const gain = {
        gain: { value: 1 },
        connect(output) { this.output = output; },
        disconnect() { this.disconnected = true; },
      };
      gains.push(gain);
      return gain;
    },
    createBufferSource: () => {
      const source = {
        connect(gain) { this.output = gain; }, disconnect() { this.disconnected = true; },
        start() { this.started = true; },
        stop() { this.stopped = true; },
      };
      sources.push(source);
      return source;
    },
  };
  audio.gain = {};
  for (const file of Object.values(ENCOURAGEMENT_SAMPLES).flat()) audio.encouragementBuffers.set(file, file);
  for (const kind of Object.keys(ENCOURAGEMENT_SAMPLES)) {
    let previous;
    for (let i = 0; i < 10; i++) {
      if (kind === 'up' || kind === 'down') audio.tempoChange(kind);
      else audio.encourage(kind);
      const source = sources.at(-1);
      assert.ok(ENCOURAGEMENT_SAMPLES[kind].includes(source.buffer));
      assert.notEqual(source.buffer, previous);
      assert.equal(source.output, gains.at(-1));
      assert.equal(source.output.gain.value, .4, 'all band-leader cues use 40% gain');
      assert.equal(source.output.output, audio.gain, 'speech still follows master volume');
      assert.equal(source.started, true);
      assert.equal(audio.celebrationVoices.size, 1, 'speech never overlaps');
      if (sources.length > 1) assert.equal(sources.at(-2).stopped, true);
      audio.silence({ feedback: false });
      assert.notEqual(source.stopped, true, 'loop boundaries preserve the sample');
      previous = source.buffer;
    }
  }
  audio.silence();
  assert.equal(audio.celebrationVoices.size, 0);
  assert.equal(sources.at(-1).stopped, true);
  sources.forEach(source => source.onended());
  assert.ok(sources.every(source => source.disconnected));
  assert.ok(gains.every(gain => gain.disconnected));
  assert.throws(() => audio.tempoChange('sideways'), /up or down/);
  assert.throws(() => audio.encourage('unknown'), /up, down, qualifying or advance/);
  assert.throws(() => new AudioEngine().encourage('up'), /Load encouragement/);
});

test('all original samples have a unique mono MP3 in the cue rotation, under a 512 KiB delivery budget', async () => {
  const files = Object.values(ENCOURAGEMENT_SAMPLES).flat();
  const originals = await readdir(new URL('../audio-source/band-leader/', import.meta.url));
  const cleaned = await readdir(new URL('../audio-source/band-leader-cleaned/', import.meta.url));
  const published = await readdir(new URL('../public/samples/', import.meta.url));
  assert.equal(files.length, 30, 'Only the 30 approved full-track clips remain');
  for (const group of Object.values(ENCOURAGEMENT_SAMPLES)) assert.ok(group.length >= 2, 'Each cue group can avoid immediate repeats');
  assert.equal(new Set(files).size, files.length);
  assert.deepEqual([...files].sort(), originals.map(file => file.replace(/\.wav$/, '.mp3')).sort());
  assert.deepEqual(cleaned.sort(), [...originals].sort(), 'Every original has a cleaned master');
  assert.deepEqual(published.sort(), [...files].sort(), 'Only compressed samples belong in public assets');
  let bytes = 0;
  for (const file of files) {
    const master = await readFile(new URL(`../audio-source/band-leader-cleaned/${encodeURIComponent(file.replace(/\.mp3$/, '.wav'))}`, import.meta.url));
    assert.equal(master.toString('ascii', 0, 4), 'RIFF');
    assert.equal(master.toString('ascii', 8, 12), 'WAVE');
    assert.equal(master.readUInt16LE(22), 1, `${file} has a mono lossless master`);
    const data = await readFile(new URL(`../public/samples/${encodeURIComponent(file)}`, import.meta.url));
    const header = data.readUInt32BE(0);
    assert.equal(header >>> 21, 0x7ff, `${file} has an MPEG audio frame`);
    assert.equal((header >>> 19) & 3, 3, `${file} uses MPEG-1`);
    assert.equal((header >>> 17) & 3, 1, `${file} uses Layer III (MP3)`);
    assert.equal((header >>> 6) & 3, 3, `${file} is mono`);
    bytes += data.length;
  }
  assert.ok(bytes <= 512 * 1024, `Compressed sample total is ${bytes} bytes`);
  assert.ok(ENCOURAGEMENT_SAMPLES.up.every(file => /^(come on|pick it up)/.test(file)));
  assert.ok(ENCOURAGEMENT_SAMPLES.down.every(file => /^(drop it back|drop it down|lay back)/.test(file)));
  assert.ok(ENCOURAGEMENT_SAMPLES.advance.every(file => /^(feel the pocket|lets go|lock it in|yeah like that)/.test(file)));
});

test('full-track phrase cuts preserve names, require confident matches, and include the planned natural tail', async () => {
  const plan = JSON.parse(await readFile(new URL('../audio-source/band-leader-segments.json', import.meta.url), 'utf8'));
  const expected = Object.values(ENCOURAGEMENT_SAMPLES).flat().map(file => file.replace(/\.mp3$/, '.wav')).sort();
  assert.deepEqual(Object.keys(plan.clips).sort(), expected, 'Every playable sample comes from the approved full track');
  assert.ok(Object.keys(plan.clips).length > 0);
  assert.equal(plan.sampleRate, 44100);
  assert.equal(plan.leadMilliseconds, 25);
  assert.equal(plan.tailMilliseconds, 150);
  const frames = bytes => {
    let align = 0;
    let dataSize;
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const size = bytes.readUInt32LE(offset + 4);
      const kind = bytes.toString('ascii', offset, offset + 4);
      assert.ok(offset + 8 + size <= bytes.length, 'WAV chunks are complete');
      if (kind === 'fmt ') align = bytes.readUInt16LE(offset + 20);
      if (kind === 'data') dataSize = size;
      offset += 8 + size + size % 2;
    }
    assert.ok(align > 0 && dataSize > 0);
    return dataSize / align;
  };
  for (const file of expected) {
    const source = await readFile(new URL(`../audio-source/band-leader/${encodeURIComponent(file)}`, import.meta.url));
    const master = await readFile(new URL(`../audio-source/band-leader-cleaned/${encodeURIComponent(file)}`, import.meta.url));
    const originalFrames = frames(source);
    const segment = plan.clips[file];
    assert.ok(segment.correlation >= .85 && segment.correlation <= 1, `${file} has a confident name match`);
    assert.equal(segment.referenceFrames, originalFrames);
    assert.equal(segment.startFrame, Math.max(0, segment.referenceStartFrame - Math.round(44100 * .025)));
    assert.equal(segment.endFrame, Math.min(plan.modelOutput.frames, segment.referenceStartFrame + originalFrames + 6615));
    assert.equal(frames(master), segment.endFrame - segment.startFrame, `${file} includes its full phrase and tail`);
  }
});

test('encouragement preloads and decodes each MP3 once, using encoded asset URLs', async t => {
  const requested = [];
  t.mock.method(globalThis, 'fetch', async url => {
    requested.push(url);
    const file = decodeURIComponent(url.split('/').at(-1));
    const data = await readFile(new URL(`../public/samples/${encodeURIComponent(file)}`, import.meta.url));
    assert.equal(data.readUInt32BE(0) >>> 21, 0x7ff);
    return new Response(data);
  });
  const audio = new AudioEngine();
  let decoded = 0;
  audio.context = { decodeAudioData: async bytes => { decoded++; return { bytes }; } };
  await Promise.all([audio.loadEncouragement(), audio.loadEncouragement()]);
  await audio.loadEncouragement();
  const files = Object.values(ENCOURAGEMENT_SAMPLES).flat();
  assert.deepEqual(requested.sort(), files.map(file => assetUrl(`samples/${encodeURIComponent(file)}`)).sort());
  assert.equal(decoded, files.length);
  assert.equal(audio.encouragementBuffers.size, files.length);
});

test('sample load errors are explicit and a later attempt can retry', async t => {
  const audio = new AudioEngine();
  audio.context = { decodeAudioData: async () => ({}) };
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 404 }));
  await assert.rejects(audio.loadEncouragement(), /Encouragement sample .*HTTP 404/);
  fetch.mock.mockImplementation(async () => new Response(new Uint8Array([1])));
  await audio.loadEncouragement();
  assert.equal(audio.encouragementBuffers.size, Object.values(ENCOURAGEMENT_SAMPLES).flat().length);
  audio.encouragementBuffers.clear();
  audio.context.decodeAudioData = async () => { throw new Error('Invalid WAV'); };
  await assert.rejects(audio.loadEncouragement(), /Invalid WAV/);
});

test('None mutes every SFX cue without stopping instruments or metronome clicks', async t => {
  const audio = new AudioEngine();
  let stopped = 0;
  audio.celebrationVoices.add({ stop: () => stopped++ });
  audio.clickVoices.add({ stop: () => { throw new Error('SFX preferences must not stop the click'); } });
  audio.voices.set('instrument', {});
  audio.setSfxType('none');
  assert.equal(stopped, 1);
  assert.equal(audio.celebrationVoices.size, 0);
  assert.equal(audio.voices.size, 1);
  assert.equal(audio.clickVoices.size, 1);
  t.mock.method(globalThis, 'fetch', () => { throw new Error('None must not fetch samples'); });
  await audio.loadEncouragement();
  for (const kind of Object.keys(ENCOURAGEMENT_SAMPLES)) audio.encourage(kind);
  audio.masteryFanfare(masteryFanfarePitches('Dm'));
  assert.equal(audio.celebrationVoices.size, 0);
  assert.throws(() => audio.setSfxType('invalid'), /Band leader, Video game or None/);
  assert.equal(audio.sfxType, 'none');
});

test('Video game synthesizes short, long, rising and falling cues without loading samples', async t => {
  const audio = new AudioEngine();
  const oscillators = [];
  audio.context = {
    currentTime: 10,
    createOscillator: () => {
      const oscillator = {
        frequency: {}, connect() {}, disconnect() {},
        start(time) { this.startTime = time; },
        stop(time) { this.stopTime = time; },
      };
      oscillators.push(oscillator);
      return oscillator;
    },
    createGain: () => ({
      gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
      connect(output) { assert.equal(output, audio.gain); }, disconnect() {},
    }),
  };
  audio.gain = {};
  audio.setSfxType('video-game');
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Video game must not fetch samples'); });
  await audio.loadEncouragement();
  const durations = {};
  for (const kind of ['qualifying', 'advance', 'up', 'down']) {
    const before = oscillators.length;
    audio.encourage(kind);
    const notes = oscillators.slice(before);
    assert.equal(notes.length, kind === 'qualifying' ? 2 : kind === 'advance' ? 5 : 4);
    durations[kind] = notes.at(-1).stopTime - 10;
    if (kind === 'up' || kind === 'down') {
      const frequencies = notes.map(note => note.frequency.value);
      assert.deepEqual(frequencies, [...frequencies].sort((a, b) => kind === 'up' ? a - b : b - a));
    }
    audio.silence({ feedback: false });
    assert.equal(audio.celebrationVoices.size, notes.length, 'loop boundaries preserve game cues');
    audio.silence();
    assert.equal(audio.celebrationVoices.size, 0, 'Stop cancels game cues');
    assert.ok(notes.every(note => note.stopTime === undefined));
    notes.forEach(note => note.onended());
  }
  assert.ok(durations.advance > durations.qualifying);
  audio.setSfxType('band-leader');
  assert.throws(() => audio.encourage('qualifying'), /Load encouragement samples/);
});

test('brass mastery fanfare is scheduled in key without touching MIDI channels and survives only normal loop boundaries', () => {
  for (const type of ['band-leader', 'video-game']) {
    const audio = new AudioEngine();
    audio.setSfxType(type);
    const oscillators = [];
    const wave = {};
    audio.context = {
      currentTime: 10,
      createPeriodicWave(real, imaginary) {
        assert.ok(real instanceof Float32Array && imaginary instanceof Float32Array);
        assert.ok(imaginary.filter(value => value > 0).length > 4, 'Brass has a rich harmonic spectrum');
        return wave;
      },
      createOscillator() {
        const oscillator = {
          frequency: {}, connect() {}, disconnect() {},
          setPeriodicWave(value) { assert.equal(value, wave); },
          start(time) { this.startTime = time; },
          stop(time) { this.stopTime = time; },
        };
        oscillators.push(oscillator);
        return oscillator;
      },
      createGain: () => ({
        gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect(output) { assert.equal(output, audio.gain); }, disconnect() {},
      }),
    };
    audio.gain = {};
    audio.synth = { midiProgramSelect() { assert.fail('Fanfare must not change backing instruments'); } };
    let replaced = false;
    audio.celebrationVoices.add({ stop() { replaced = true; } });
    const pitches = masteryFanfarePitches('Dm');
    audio.masteryFanfare(pitches);
    assert.equal(replaced, true, 'Fanfare replaces, rather than overlaps, ordinary encouragement');
    assert.deepEqual(oscillators.map(note => note.frequency.value), pitches.map(pitch => 440 * 2 ** ((pitch - 69) / 12)));
    assert.equal(audio.celebrationVoices.size, pitches.length);
    assert.equal(oscillators[0].startTime, 10);
    assert.ok(oscillators.at(-1).stopTime - oscillators.at(-1).startTime > .6, 'Final trumpet note is sustained');
    audio.silence({ feedback: false });
    assert.equal(audio.celebrationVoices.size, pitches.length);
    audio.silence();
    assert.equal(audio.celebrationVoices.size, 0);
    assert.ok(oscillators.every(note => note.stopTime === undefined), 'Stop cancels even future scheduled notes');
    oscillators.forEach(note => note.onended());
    audio.masteryFanfare(pitches);
    audio.setSfxType('none');
    assert.equal(audio.celebrationVoices.size, 0, 'Switching to None cancels the fanfare');
    assert.throws(() => audio.masteryFanfare([]), /valid MIDI pitches/);
    assert.throws(() => audio.masteryFanfare([128]), /valid MIDI pitches/);
  }
});
