const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function isPrivateLanHost(hostname: string): boolean {
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname);
}

export function normalizeBridgeUrl(input: string): string {
  let raw = input.trim();
  // Accept bare "host:port" / "host" forms with no scheme typed.
  if (raw && !/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    const host = raw.split('/')[0].split(':')[0];
    raw = (isPrivateLanHost(host) || host === 'localhost' ? 'http://' : 'https://') + raw;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Enter a valid Atlas bridge URL');
  }

  if (url.username || url.password) {
    throw new Error('Credentials must not be embedded in the bridge URL');
  }

  if (!['https:', 'wss:', 'http:', 'ws:'].includes(url.protocol)) {
    throw new Error('Unsupported bridge protocol');
  }

  const loopback = LOOPBACK_HOSTS.has(url.hostname);
  const privateLan = isPrivateLanHost(url.hostname);
  const portableHost = /\.lhr\.life$/.test(url.hostname);
  if (!loopback && !privateLan && !portableHost && ['http:', 'ws:'].includes(url.protocol)) {
    throw new Error('HTTPS is required for a remote Atlas bridge');
  }

  url.protocol = ['https:', 'wss:'].includes(url.protocol) ? 'wss:' : 'ws:';
  url.hash = '';
  url.search = '';
  url.pathname = url.pathname.replace(/\/$/, '');
  if (!url.pathname.endsWith('/api/ws')) {
    url.pathname = `${url.pathname}/api/ws`.replace('//', '/');
  }
  return url.toString().replace(/\/$/, '');
}
