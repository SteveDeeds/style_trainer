export function assetUrl(path, base = import.meta.env?.BASE_URL ?? '/') {
  if (typeof path !== 'string' || !path || /^(?:[a-z]+:)?\/\//i.test(path)) {
    throw new Error('Public assets must use a site-relative path.');
  }
  return `${base.replace(/\/?$/, '/')}${path.replace(/^\/+/, '')}`;
}
