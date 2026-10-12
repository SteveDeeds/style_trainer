import { Notation } from '../src/notation.js';
import { createDemo } from '../src/midi.js';
import { buildExercise, styleTracks } from '../src/training.js';
import { clearSavedSounds, readSavedSounds, saveSounds, validateStarter } from '../src/soundfont-cache.js';
import { AudioEngine } from '../src/audio.js';

// Run on a fresh dev page; captures audio calls without needing MIDI hardware.
export async function verifyPreviews() {
  const $ = id => document.getElementById(id);
  const waitFor = async predicate => {
    const until = performance.now() + 15000;
    while (!predicate()) {
      if (performance.now() > until) throw new Error('Preview check timed out.');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  };
  const checks = [];
  const check = (condition, message) => {
    if (!condition) throw new Error(message);
    checks.push(message);
  };
  const on = AudioEngine.prototype.on;
  const off = AudioEngine.prototype.off;
  const played = [];
  const released = [];
  AudioEngine.prototype.on = function(note) { played.push(note); };
  AudioEngine.prototype.off = function(note) { released.push(note); };
  try {
    $('open-devices').click();
    $('preview').checked = true;
    $('preview').dispatchEvent(new Event('change'));
    $('devices-dialog').close();
    const before = $('notation').querySelector('svg').getAttribute('aria-label');
    $('open-style').click();
    $('demo').click();
    await waitFor(() => played.length > 0);
    check($('notice').textContent.includes('C → G → Am → F'), 'Style preview uses the requested pop progression');
    check($('stop').getAttribute('aria-pressed') === 'true', 'Style preview does not start practice transport');
    check($('notation').querySelector('svg').getAttribute('aria-label') === before, 'Style preview preserves exercise harmony');
    await waitFor(() => $('notice').textContent.startsWith('Preview ended:'));
    const completed = played.length;
    await new Promise(resolve => setTimeout(resolve, 300));
    check(played.length === completed, 'Style preview ends after four bars instead of looping');
    $('demo').click();
    await waitFor(() => played.length > completed);
    $('style-dialog').close();
    const count = played.length;
    await new Promise(resolve => setTimeout(resolve, 300));
    check(played.length === count && released.length > 0, 'Closing the style menu releases and cancels preview notes');
    played.length = 0;
    const head = $('notation').querySelector('.vf-notehead[role="button"]');
    const pitch = Number(head.getAttribute('aria-label').split(' ').at(-1));
    head.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await waitFor(() => played.length > 0);
    check(played[0].pitch === pitch && played[0].part === undefined && played[0].channel === 15, 'Click auditions the sounding bass pitch rather than its octave-up written pitch');
    check($('stop').getAttribute('aria-pressed') === 'true', 'Clicking notation does not start or score practice');
    played.length = 0;
    head.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await waitFor(() => played.length > 0);
    check(played[0].pitch === pitch, 'Keyboard activation auditions the same note');
    $('stop').click();
    for (const part of ['Piano', 'Drums']) {
      const option = [...$('focus').options].find(option => option.textContent.startsWith(part));
      $('focus').value = option.value;
      $('focus').dispatchEvent(new Event('change'));
      played.length = 0;
      const note = $('notation').querySelector('.vf-notehead[role="button"]');
      note.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await waitFor(() => played.length > 0);
      check(played.length === 1, `${part} notehead plays one note, not the entire chord or beat`);
      check(played[0].channel === (part === 'Drums' ? 9 : 15), `${part} audition uses the correct melodic/percussion channel`);
      $('stop').click();
    }
    return checks;
  } finally {
    $('stop').click();
    AudioEngine.prototype.on = on;
    AudioEngine.prototype.off = off;
  }
}

// Use a disposable browser profile: this deliberately replaces its starter cache.
export async function verifySavedSounds() {
  const buffer = new TextEncoder().encode('RIFF0000sfbk1234').buffer;
  const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
  const font = { version: 'test', sha256 };
  try {
    await clearSavedSounds();
    if (await readSavedSounds(font)) throw new Error('Saved sounds were not cleared.');
    await saveSounds(font, buffer);
    const saved = await readSavedSounds(font);
    await validateStarter(saved, font);
    if (await readSavedSounds({ ...font, version: 'changed' })) throw new Error('Cache version was ignored.');
    await saveSounds(font, new ArrayBuffer(12));
    let corrupt = false;
    try { await validateStarter(await readSavedSounds(font), font); } catch { corrupt = true; }
    if (!corrupt) throw new Error('Corrupt cached audio was accepted.');
    return ['clear', 'save/read', 'integrity', 'version isolation', 'corrupt rejection'];
  } finally { await clearSavedSounds(); }
}

export async function verifyPublicUI() {
  const $ = id => document.getElementById(id);
  const waitFor = async predicate => {
    const limit = performance.now() + 5000;
    while (!predicate()) {
      if (performance.now() > limit) throw new Error('Public UI check timed out.');
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  };
  const checks = [];
  const check = (condition, message) => {
    if (!condition) throw new Error(`Public UI regression: ${message}`);
    checks.push(message);
  };
  await waitFor(() => !$('starter-setup').hidden);
  check($('library-style').closest('label').hidden && $('load-style').hidden, 'Public library intentionally excludes private styles');
  check($('style-dialog').querySelector('a[href="https://www.jjazzlab.org/en/resources/"]'), 'Style resources page is linked without mirroring files');
  check(!$('preview').checked, 'Preview is opt-in');
  $('play').click();
  await waitFor(() => $('devices-dialog').open);
  check($('stop').getAttribute('aria-pressed') === 'true', 'First Play waits for a sound choice');
  $('stop').click();
  $('preview').checked = true;
  $('preview').dispatchEvent(new Event('change'));
  check($('stop').getAttribute('aria-pressed') === 'true', 'Stop cancels deferred transport start');
  $('play').click();
  await waitFor(() => $('play').getAttribute('aria-pressed') === 'true');
  check($('device-summary').textContent.includes('Preview'), 'Explicit Preview plays with honest readiness');
  $('stop').click();
  $('preview').checked = false;
  $('preview').dispatchEvent(new Event('change'));
  $('devices-dialog').close();
  return checks;
}

export async function verifyNotationLayout() {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;height:400px;overflow:auto';
  document.body.append(host);
  let checks = 0;
  const check = (condition, message) => {
    if (!condition) throw new Error(`Notation regression: ${message}`);
    checks++;
  };
  try {
    const style = createDemo();
    for (const width of [360, 1200]) for (const bars of [1, 4, 8]) for (const track of styleTracks(style)) {
      host.style.width = `${width}px`;
      const exercise = buildExercise(style, { bars, trackId: track.id, level: 4 });
      const notation = new Notation(host);
      notation.render(exercise, 'C');
      notation.positions.forEach((position, bar) => {
        const previous = notation.positions[bar - 1];
        if (previous && previous.y === position.y) position.staves.forEach((stave, i) => {
          const before = previous.staves[i];
          check(Math.abs(before.getX() + before.getWidth() - stave.getX()) < 1e-7, 'Adjacent staff lines meet');
        });
        for (const [fraction, x] of position.anchors) {
          if (fraction === 1) continue;
          notation.update((bar + fraction) * exercise.barTicks, exercise.barTicks);
          check(Math.abs(Number(notation.cursor.getAttribute('x')) - x) < 1e-7, 'Playhead aligns with engraved attacks/rests');
          check(Number(notation.cursor.getAttribute('y')) === position.y, 'Playhead follows the correct row');
        }
      });
      notation.feedback(61, exercise.barTicks / 2, false);
      check(notation.feedbackMarks.length === 1, 'Wrong-note overlay still renders');
      const head = notation.feedbackMarks[0].querySelector('.vf-notehead path').getBBox();
      check(Math.abs(head.x - notation.positionX(notation.positions[0], .5)) < 2, 'Wrong-note head follows the playhead timing map');
      notation.clearFeedback();
      check(notation.feedbackMarks.length === 0, 'Wrong-note overlay clears');
    }
    return checks;
  } finally {
    host.remove();
  }
}

// Run on a fresh dev-server page; this smoke test changes practice settings.
export async function verifyUI() {
  const $ = id => document.getElementById(id);
  const results = [];
  const check = (condition, message) => {
    if (!condition) throw new Error(`UI regression: ${message}`);
    results.push(message);
  };
  const change = (id, value) => {
    $(id).value = value;
    $(id).dispatchEvent(new Event('change', { bubbles: true }));
  };
  const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  check($('stop').getAttribute('aria-pressed') === 'true', 'Start with transport stopped');
  const ids = [...document.querySelectorAll('[id]')].map(node => node.id);
  check(new Set(ids).size === ids.length, 'Every control has a unique ID');
  check($('keys-panel').hidden, 'On-screen keys are hidden initially');
  const before = $('notation').querySelector('svg').getAttribute('aria-label');
  for (const [trigger, dialog] of [['open-style', 'style-dialog'], ['open-devices', 'devices-dialog']]) {
    $(trigger).click();
    check($(dialog).open, `${dialog} opens`);
    check(!$('stop').matches(':disabled') && !$('stop').closest('[inert]'), 'Stop remains usable with setup open');
    $(dialog).querySelector('[data-close]').click();
    await settle();
    check(document.activeElement === $(trigger), `${dialog} restores trigger focus`);
    check($('notation').querySelector('svg').getAttribute('aria-label') === before, 'Setup disclosure preserves the exercise');
  }
  $('show-keys').checked = true;
  $('show-keys').dispatchEvent(new Event('change'));
  check(!$('keys-panel').hidden && $('practice-pads').children.length > 0, 'Keys toggle reveals playable pads');
  $('show-keys').checked = false;
  $('show-keys').dispatchEvent(new Event('change'));
  check($('keys-panel').hidden, 'Keys toggle hides pads');
  $('open-harmony').click();
  await settle();
  check($('harmony-popover').matches(':popover-open'), 'Harmony popover opens');
  $('randomize-chords').click();
  check($('open-harmony').textContent.includes('Randomized'), 'Harmony trigger reflects randomization');
  check($('harmony-summary').textContent.includes('7'), 'Harmony summary shows generated seventh chords');
  $('restore-chords').click();
  check($('open-harmony').textContent === 'Harmony: Original', 'Restore updates harmony summary');
  $('harmony-popover').hidePopover();
  await settle();
  $('open-harmony').click();
  await settle();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await settle();
  check(!$('harmony-popover').matches(':popover-open') && document.activeElement === $('open-harmony'), 'Escape closes harmony and restores focus');
  $('open-devices').click();
  $('stop').focus();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await settle();
  check(!$('devices-dialog').open, 'Escape closes setup even after focus moves to transport');
  change('practice-speed', '50');
  check($('practice-status').textContent.includes('speed-up to 75%'), '50% shows speed-up eligibility');
  change('practice-bar', '0');
  check($('practice-status').textContent.includes('Practice only'), 'Single-bar drill shows practice-only status');
  change('practice-bar', '');
  change('practice-speed', '100');
  check($('practice-status').textContent.includes('eligible for level-up'), 'Full-speed full-pattern level eligibility is restored');
  check(document.documentElement.scrollWidth <= innerWidth, 'No body-level horizontal overflow');
  if (innerWidth >= 1300 && innerHeight >= 768) {
    const score = $('notation').getBoundingClientRect();
    check(score.top <= 260, 'Laptop notation starts within 260 pixels');
    check(score.top + 180 < document.querySelector('.transport-shell').getBoundingClientRect().top, 'First notation row fits above transport');
  }
  return results;
}
