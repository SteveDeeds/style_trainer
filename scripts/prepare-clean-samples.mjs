import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const originals = path.join(root, 'audio-source', 'band-leader');
const output = path.join(root, 'audio-source', 'band-leader-cleaned');
const ffmpeg = process.argv[2] ?? 'ffmpeg';
const segmentsFile = path.join(root, 'audio-source', 'band-leader-segments.json');
const segments = JSON.parse(readFileSync(segmentsFile, 'utf8'));
const fullTrack = path.join(root, '.tools', 'dereverb', 'full-track', segments.modelOutput.file);
if (createHash('sha256').update(readFileSync(fullTrack)).digest('hex') !== segments.modelOutput.sha256) {
  throw new Error('Full-track de-reverb output does not match the saved segment plan.');
}

function run(args) {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', ...args], { maxBuffer: 8 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.toString());
  return result.stdout;
}

function filter(segment) {
  return `pan=mono|c0=0.5*c0+0.5*c1${segment ?
    `,atrim=start_sample=${segment.startFrame}:end_sample=${segment.endFrame},asetpts=PTS-STARTPTS` : ''}`;
}

function decode(file, segment) {
  const bytes = run(['-i', file, '-af', filter(segment), '-ar', '44100', '-f', 'f32le', 'pipe:1']);
  return Array.from({ length: bytes.length / 4 }, (_, index) => bytes.readFloatLE(index * 4));
}

function rms(samples) {
  return Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
}

const files = readdirSync(originals).filter(file => file.endsWith('.wav'));
if (!files.length) throw new Error('No original WAV samples found.');
if (files.length !== Object.keys(segments.clips).length || files.some(file => !segments.clips[file])) {
  throw new Error('Original samples must match the approved full-track segment plan.');
}
mkdirSync(output, { recursive: true });

for (const file of files) {
  const segment = segments.clips[file];
  if (![segment.startFrame, segment.endFrame, segment.referenceStartFrame].every(Number.isInteger) ||
    segment.startFrame < 0 || segment.endFrame <= segment.startFrame || segment.referenceStartFrame < segment.startFrame) {
    throw new Error(`Invalid full-track segment for ${file}.`);
  }
  const source = decode(path.join(originals, file));
  if (createHash('sha256').update(readFileSync(path.join(originals, file))).digest('hex') !== segment.referenceSha256) {
    throw new Error(`Original recording changed; regenerate the full-track segment plan for ${file}.`);
  }
  const clean = decode(fullTrack, segment);
  const offset = segment.referenceStartFrame - segment.startFrame;
  const reference = clean.slice(offset, offset + source.length);
  if (!source.length || reference.length !== source.length ||
    clean.length !== segment.endFrame - segment.startFrame) {
    throw new Error(`De-reverb duration changed for ${file}.`);
  }
  const sourceRms = rms(source);
  const cleanRms = rms(reference);
  if (!(sourceRms > 0) || !(cleanRms > 0)) throw new Error(`Silent or invalid recording: ${file}.`);
  const peak = clean.reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0);
  const gain = Math.min(sourceRms / cleanRms, .95 / peak);
  run(['-y', '-i', fullTrack, '-map_metadata', '-1',
    '-af', `${filter(segment)},volume=${gain}`, '-ar', '44100', '-c:a', 'pcm_s16le', path.join(output, file)]);
}
console.log(`Prepared ${files.length} level-matched, mono cleaned WAV masters; original recordings are unchanged.`);
