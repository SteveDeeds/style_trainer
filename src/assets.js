export const ENCOURAGEMENT_SAMPLES = {
  up: ['bring it up.wav', 'come on.wav'],
  down: ['drop it back.wav', 'drop it down.wav', 'lay back.wav'],
  qualifying: ['huh.wav', 'yeah.wav'],
  advance: ['lets go.wav', 'yeah like that.wav'],
};

export function assetUrl(path, base = import.meta.env?.BASE_URL ?? '/') {
  if (typeof path !== 'string' || !path || /^(?:[a-z]+:)?\/\//i.test(path)) {
    throw new Error('Public assets must use a site-relative path.');
  }
  return `${base.replace(/\/?$/, '/')}${path.replace(/^\/+/, '')}`;
}
