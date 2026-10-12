import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function copySynth(destination) {
  await mkdir(destination, { recursive: true });
  if (path.resolve(destination) !== path.join(root, 'public-release', 'synth')) {
    await copyFile(
      path.join(root, 'node_modules', 'js-synthesizer', 'externals', 'libfluidsynth-2.4.6.js'),
      path.join(destination, 'fluid.js'),
    );
  }
  for (const [source, target] of [
    ['dist/js-synthesizer.worklet.js', 'synth.worklet.js'],
    ['externals/LICENSE.fluidsynth.txt', 'LICENSE.fluidsynth.txt'],
    ['LICENSE', 'LICENSE.js-synthesizer.txt'],
  ]) {
    await copyFile(path.join(root, 'node_modules', 'js-synthesizer', source), path.join(destination, target));
  }
  await copyFile(path.join(root, 'THIRD-PARTY-NOTICES.md'), path.join(destination, 'THIRD-PARTY-NOTICES.md'));
  await copyFile(
    path.join(root, 'public-release', 'licenses', 'FLUIDSYNTH-SOURCE-AND-BUILD.md'),
    path.join(destination, 'SOURCE-AND-BUILD.md'),
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await copySynth(path.join(root, 'public', 'synth'));
  await copySynth(path.join(root, 'public-release', 'synth'));
}
