import { createHash } from 'node:crypto';
import { readdir, readFile, copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { copySynth } from './copy-synth.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicRelease = path.join(root, 'public-release');
const synthDirectory = path.join(publicRelease, 'synth');
const expectedSoundfont = '9575028C7A1F589F5770FCCC8CFF2734566AF40CD26ED836944E9A5152688CFE';
const expectedSourceArchives = new Map([
  [
    'licenses/source/fluidsynth-emscripten-public-2.4.6.zip',
    'C0FDC9842CD2B296C876C1551482454C6485D7E292CFD65D4E20747A04A9DDDC',
  ],
  [
    'licenses/source/fluidsynth-emscripten-v2.4.6-em-2.zip',
    '63A090960B027FCF492314393D73C53073C1BB46A1E8FD7A01BCC9329DFDE510',
  ],
  [
    'licenses/source/js-synthesizer-v1.11.0.zip',
    '875ABF3285EB8295CDA2570F50164F17DE5FA86D6BE5BED7DFE9216EBE92CD6B',
  ],
]);
const expectedSynthAssets = new Map([
  [
    'dist/js-synthesizer.worklet.js',
    '27B90E41364DCFE89B7A4E45C41A9BF67CAA383C8C02D7246F9059EF56EF3560',
  ],
]);

function fail(message) {
  throw new Error(`Public release check failed: ${message}`);
}

async function sha256(file) {
  return createHash('sha256').update(await readFile(file)).digest('hex').toUpperCase();
}

async function listFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(fullPath));
    else if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

async function requireVersion(packageName, version) {
  const packagePath = path.join(root, 'node_modules', packageName, 'package.json');
  const packageData = JSON.parse(await readFile(packagePath, 'utf8'));
  if (packageData.version !== version) {
    fail(`expected ${packageName} ${version}, found ${packageData.version}`);
  }
}

async function copy(from, to) {
  await mkdir(path.dirname(to), { recursive: true });
  await copyFile(from, to);
}

async function validateManifest() {
  const manifestPath = path.join(publicRelease, 'library.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const font = manifest.soundfonts?.[0];
  if (
    manifest.edition !== 'public'
    || !Array.isArray(manifest.styles)
    || manifest.styles.length !== 0
    || manifest.soundfonts?.length !== 1
    || font.name !== 'GeneralUser GS'
    || font.url !== 'soundfonts/generaluser-gs.sf2'
    || font.version !== '2.0.3'
    || font.sha256 !== expectedSoundfont
  ) {
    fail('public-release/library.json is not the approved public manifest');
  }

  const soundfontPath = path.join(publicRelease, 'soundfonts', 'generaluser-gs.sf2');
  if (await sha256(soundfontPath) !== expectedSoundfont) {
    fail('GeneralUser GS SoundFont is missing or its SHA-256 does not match');
  }
  for (const [relativePath, expectedHash] of expectedSourceArchives) {
    if (await sha256(path.join(publicRelease, relativePath)) !== expectedHash) {
      fail(`source archive checksum mismatch: ${relativePath}`);
    }
  }
}

async function stageAssetsAndNotices() {
  const synthesizerPackage = path.join(root, 'node_modules', 'js-synthesizer');
  await requireVersion('js-synthesizer', '1.11.0');
  await requireVersion('vexflow', '4.2.5');
  await requireVersion('vite', '6.4.3');
  await mkdir(synthDirectory, { recursive: true });
  if (await sha256(path.join(synthDirectory, 'fluid.js')) !== '8EDC335DA1728DBE6B8BB9978852300C35DDDD8EFDA2003AA85141533E4BB5EF') {
    fail('public FluidSynth runtime does not match the approved source rebuild');
  }
  for (const [relativePath, expectedHash] of expectedSynthAssets) {
    if (await sha256(path.join(synthesizerPackage, relativePath)) !== expectedHash) {
      fail(`unexpected js-synthesizer asset: ${relativePath}`);
    }
  }

  await copy(path.join(root, 'LICENSE'), path.join(publicRelease, 'LICENSE'));
  await copy(
    path.join(root, 'THIRD-PARTY-NOTICES.md'),
    path.join(publicRelease, 'THIRD-PARTY-NOTICES.md'),
  );
  await copy(
    path.join(root, 'node_modules', 'vexflow', 'LICENSE'),
    path.join(publicRelease, 'licenses', 'LICENSE-VexFlow.txt'),
  );
  await copy(
    path.join(root, 'node_modules', 'vite', 'LICENSE.md'),
    path.join(publicRelease, 'licenses', 'LICENSE-Vite.txt'),
  );
  await copySynth(synthDirectory);
}

async function verifyOutput() {
  const dist = path.join(root, 'dist');
  const files = await listFiles(dist);
  const relativeFiles = files.map(file => path.relative(dist, file).split(path.sep).join('/'));
  const badStyle = relativeFiles.find(file => file.toLowerCase().endsWith('.sty'));
  if (badStyle) fail(`private style asset was published: ${badStyle}`);

  const badSoundFont = relativeFiles.find(file => path.posix.basename(file).toLowerCase() === 'default.sf2');
  if (badSoundFont) fail(`private default SoundFont was published: ${badSoundFont}`);

  const soundfonts = relativeFiles.filter(file => /\.(?:sf2|sf3)$/i.test(file));
  if (soundfonts.length !== 1 || soundfonts[0] !== 'soundfonts/generaluser-gs.sf2') {
    fail(`unexpected SoundFont assets in output: ${soundfonts.join(', ') || '(none)'}`);
  }
  if (await sha256(path.join(dist, soundfonts[0])) !== expectedSoundfont) {
    fail('built GeneralUser GS file does not match the approved checksum');
  }

  const publishedManifest = JSON.parse(await readFile(path.join(dist, 'library.json'), 'utf8'));
  if (publishedManifest.edition !== 'public' || publishedManifest.styles.length !== 0) {
    fail('built output does not contain the empty-style public manifest');
  }

  const jjazzUrls = /(?:https?:)?\/\/[^\s"'<>\\)]*jjazz[^\s"'<>\\)]*/gi;
  const allowedAttributionUrl = 'https://www.jjazzlab.org/en/resources/';
  for (const file of files) {
    if (/\.(?:html|js|mjs|css|json|md|txt|svg|map)$/i.test(file)) {
      const content = await readFile(file, 'utf8');
      for (const match of content.matchAll(jjazzUrls)) {
        if (match[0] !== allowedAttributionUrl) {
          fail(`unapproved JJazz URL found in published file: ${path.relative(dist, file)}`);
        }
      }
    }
  }
  console.log(`Verified safe public output (${files.length} files; base ${process.env.PAGES_BASE}).`);
}

await validateManifest();
await stageAssetsAndNotices();

process.env.STYLE_TRAINER_PUBLIC = '1';
if (!process.env.PAGES_BASE) process.env.PAGES_BASE = '/style_trainer/';

const { build } = await import('vite');
await build({
  root,
  configFile: path.join(root, 'vite.config.js'),
  build: { emptyOutDir: true },
});
await verifyOutput();
