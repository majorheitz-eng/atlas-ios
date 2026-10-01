import { buildRpcRequest, parseGatewayFrame } from '@/lib/bridge/gateway-protocol';

describe('gateway protocol', () => {
  it('builds Hermes JSON-RPC requests', () => {
    expect(buildRpcRequest('ios-1', 'session.create', { source: 'atlas-ios' })).toEqual({
      jsonrpc: '2.0',
      id: 'ios-1',
      method: 'session.create',
      params: { source: 'atlas-ios' },
    });
  });

  it('parses streamed Hermes events', () => {
    expect(
      parseGatewayFrame(
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'event',
          params: {
            type: 'message.delta',
            session_id: 'abc123',
            payload: { text: 'Hello' },
          },
        }),
      ),
    ).toEqual({
      kind: 'event',
      type: 'message.delta',
      sessionId: 'abc123',
      payload: { text: 'Hello' },
    });
  });

  it('parses RPC errors without exposing an unknown payload', () => {
    expect(
      parseGatewayFrame(
        JSON.stringify({ jsonrpc: '2.0', id: 'ios-2', error: { code: 401, message: 'Unauthorized' } }),
      ),
    ).toEqual({ kind: 'response', id: 'ios-2', error: { code: 401, message: 'Unauthorized' } });
  });

  it('rejects malformed frames', () => {
    expect(() => parseGatewayFrame('{oops')).toThrow('Invalid Atlas gateway frame');
    expect(() => parseGatewayFrame(JSON.stringify({ hello: 'world' }))).toThrow('Unsupported Atlas gateway frame');
  });
});
