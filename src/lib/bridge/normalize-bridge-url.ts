const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function normalizeBridgeUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
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
  const privateLan = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname);
  if (!loopback && !privateLan && ['http:', 'ws:'].includes(url.protocol)) {
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
