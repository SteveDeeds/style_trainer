import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioEngine } from '../src/audio.js';
import { assetUrl, ENCOURAGEMENT_SAMPLES } from '../src/assets.js';
import { readFile } from 'node:fs/promises';
import { practiceExercise, Progression } from '../src/training.js';
import { Transport } from '../src/transport.js';

const pattern = (level = 1) => ({
  level, ppq: 480, bars: 1, durationTicks: 1920, barTicks: 1920,
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
  audio.context = {
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
      assert.equal(source.output, audio.gain);
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
  assert.throws(() => audio.tempoChange('sideways'), /up or down/);
  assert.throws(() => audio.encourage('unknown'), /up, down, qualifying or advance/);
  assert.throws(() => new AudioEngine().encourage('up'), /Load encouragement/);
});

test('encouragement preloads and decodes each WAV once, using encoded asset URLs', async t => {
  const requested = [];
  t.mock.method(globalThis, 'fetch', async url => {
    requested.push(url);
    const file = decodeURIComponent(url.split('/').at(-1));
    const data = await readFile(new URL(`../public/samples/${encodeURIComponent(file)}`, import.meta.url));
    assert.equal(data.toString('ascii', 0, 4), 'RIFF');
    assert.equal(data.toString('ascii', 8, 12), 'WAVE');
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
