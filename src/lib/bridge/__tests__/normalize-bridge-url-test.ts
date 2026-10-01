import { normalizeBridgeUrl } from '@/lib/bridge/normalize-bridge-url';

describe('normalizeBridgeUrl', () => {
  it('requires encrypted websocket transport for remote hosts', () => {
    expect(normalizeBridgeUrl('https://atlas.example.com/hermes')).toBe('wss://atlas.example.com/hermes/api/ws');
    expect(normalizeBridgeUrl('wss://atlas.example.com/hermes/api/ws')).toBe('wss://atlas.example.com/hermes/api/ws');
  });

  it('allows unencrypted websocket only for loopback development', () => {
    expect(normalizeBridgeUrl('http://127.0.0.1:9119')).toBe('ws://127.0.0.1:9119/api/ws');
    expect(() => normalizeBridgeUrl('http://192.168.1.12:9119')).toThrow('HTTPS is required');
  });

  it('rejects unsupported protocols and credential-bearing URLs', () => {
    expect(() => normalizeBridgeUrl('ftp://atlas.example.com')).toThrow('Unsupported bridge protocol');
    expect(() => normalizeBridgeUrl('https://user:secret@atlas.example.com')).toThrow('Credentials must not be embedded');
  });
});
