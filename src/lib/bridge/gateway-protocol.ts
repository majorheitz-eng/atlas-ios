export type GatewayEvent = {
  kind: 'event';
  type: string;
  sessionId: string;
  payload: Record<string, unknown>;
};

export type GatewayResponse = {
  kind: 'response';
  id: string;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
};

export type GatewayFrame = GatewayEvent | GatewayResponse;

export function buildRpcRequest(id: string, method: string, params: Record<string, unknown>) {
  return { jsonrpc: '2.0' as const, id, method, params };
}

export function parseGatewayFrame(raw: string): GatewayFrame {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('Invalid Atlas gateway frame');
  }

  if (!value || typeof value !== 'object') {
    throw new Error('Unsupported Atlas gateway frame');
  }
  const frame = value as Record<string, unknown>;

  if (frame.method === 'event' && frame.params && typeof frame.params === 'object') {
    const params = frame.params as Record<string, unknown>;
    if (typeof params.type !== 'string') {
      throw new Error('Unsupported Atlas gateway frame');
    }
    return {
      kind: 'event',
      type: params.type,
      sessionId: typeof params.session_id === 'string' ? params.session_id : '',
      payload:
        params.payload && typeof params.payload === 'object'
          ? (params.payload as Record<string, unknown>)
          : {},
    };
  }

  if (typeof frame.id === 'string') {
    const response: GatewayResponse = { kind: 'response', id: frame.id };
    if (frame.result && typeof frame.result === 'object') {
      response.result = frame.result as Record<string, unknown>;
    }
    if (frame.error && typeof frame.error === 'object') {
      const error = frame.error as Record<string, unknown>;
      response.error = {
        code: typeof error.code === 'number' ? error.code : -1,
        message: typeof error.message === 'string' ? error.message : 'Atlas gateway error',
      };
    }
    return response;
  }

  throw new Error('Unsupported Atlas gateway frame');
}
