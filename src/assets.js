export const ENCOURAGEMENT_SAMPLES = {
  up: ['come on2.mp3', 'pick it up.mp3', 'pick it up2.mp3'],
  down: [
    'drop it back2.mp3', 'drop it back3.mp3',
    'drop it down2.mp3', 'drop it down3.mp3',
    'lay back2.mp3', 'lay back3.mp3',
  ],
  qualifying: [
    'ah2.mp3', 'ah3.mp3', 'huh2.mp3', 'huh3.mp3', 'huh4.mp3',
    'oh.mp3', 'yeah2.mp3', 'yeah3.mp3', 'snap.mp3',
    'groovy.mp3', 'groovy2.mp3', 'smooth.mp3', 'smooth2.mp3', 'right there.mp3', 'right there2.mp3',
  ],
  advance: [
    'feel the pocket.mp3', 'feel the pocket2.mp3', 'lets go2.mp3',
    'lock it in.mp3', 'lock it in2.mp3', 'yeah like that2.mp3',
  ],
};

export function assetUrl(path, base = import.meta.env?.BASE_URL ?? '/') {
  if (typeof path !== 'string' || !path || /^(?:[a-z]+:)?\/\//i.test(path)) {
    throw new Error('Public assets must use a site-relative path.');
  }
  return `${base.replace(/\/?$/, '/')}${path.replace(/^\/+/, '')}`;
}
