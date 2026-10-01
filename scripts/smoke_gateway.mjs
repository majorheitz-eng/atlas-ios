const endpoint = process.env.ATLAS_GATEWAY_URL;
const token = process.env.ATLAS_GATEWAY_TOKEN;
if (!endpoint || !token) throw new Error('Set ATLAS_GATEWAY_URL and ATLAS_GATEWAY_TOKEN');

const url = new URL(endpoint.replace(/\/$/, '') + '/api/ws');
url.searchParams.set('token', token);
const ws = new WebSocket(url);
let nextId = 0;
let sessionId = '';
let streamed = '';
const waiting = new Map();

const timeout = setTimeout(() => {
  console.error('Timed out waiting for Hermes gateway');
  process.exit(1);
}, 180_000);

function rpc(method, params) {
  return new Promise((resolve, reject) => {
    const id = `smoke-${++nextId}`;
    waiting.set(id, { resolve, reject });
    ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
  });
}

ws.addEventListener('error', () => {
  console.error('WebSocket connection failed');
  process.exit(1);
});

ws.addEventListener('message', async ({ data }) => {
  const frame = JSON.parse(String(data));
  if (frame.id && waiting.has(frame.id)) {
    const pending = waiting.get(frame.id);
    waiting.delete(frame.id);
    if (frame.error) pending.reject(new Error(frame.error.message));
    else pending.resolve(frame.result || {});
    return;
  }
  if (frame.method !== 'event') return;
  const { type, payload = {} } = frame.params || {};
  if (type === 'gateway.ready') {
    const created = await rpc('session.create', {
      source: 'atlas-ios-smoke',
      title: 'Atlas iPhone integration smoke test',
      close_on_disconnect: true,
      cols: 100,
    });
    sessionId = created.session_id;
    await rpc('prompt.submit', {
      session_id: sessionId,
      text: 'This is an automated transport smoke test. Reply with exactly: ATLAS IOS LINK OK',
    });
  } else if (type === 'message.delta' && frame.params.session_id === sessionId) {
    streamed += payload.text || '';
  } else if (type === 'message.complete' && frame.params.session_id === sessionId) {
    const reply = String(payload.text || streamed).trim();
    if (!reply.includes('ATLAS IOS LINK OK')) {
      console.error(`Unexpected response: ${reply}`);
      process.exitCode = 1;
    } else {
      console.log(JSON.stringify({ connected: true, sessionCreated: true, streaming: streamed.length > 0, reply }));
    }
    clearTimeout(timeout);
    ws.close();
  }
});
