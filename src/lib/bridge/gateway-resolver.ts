// Bulletproof gateway resolution with automatic fallback ordering.
//
//   1. Saved Keychain config (user's explicit choice from Settings)
//   2. Portable default URLs from src/lib/gateway.ts, tried in order —
//      first one that completes a real WebSocket handshake wins
//   3. Any URL the user typed in Settings (saved to Keychain, becomes tier 1)
//
// The winning URL is returned so the main screen banner can show exactly which
// transport actually connected.

import { HermesGatewayClient } from './hermes-gateway-client';
import { loadBridgeConfigWithSource, type BridgeConfig } from './secure-config-store';
import { ATLAS_GATEWAY_CONFIG } from '../gateway';
import { HermesLongPollClient } from './hermes-lp-client';

async function lpProbeOk(config: BridgeConfig): Promise<boolean> {
  try {
    const root = config.baseUrl.replace(/\/+$/, '').replace(/\/api\/ws$/, '');
    const res = await fetch(`${root}/api/ws`, { headers: { Authorization: `Bearer ${config.token}` } });
    return res.status !== 0 && res.status < 500 || res.status === 502 ? false : true;
  } catch {
    return false;
  }
}

export type GatewayResolution = {
  config: BridgeConfig;
  /** The URL that actually answered the WebSocket handshake. */
  connectedUrl: string;
  /** How the URL was picked: saved config, portable default, or last resort. */
  source: 'saved' | 'default' | 'fallback';
  /** True when only the long-poll (non-WS) transport works for this URL. */
  transport: 'ws' | 'lp';
};

function wsHandshakeOk(config: BridgeConfig, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const client = new HermesGatewayClient(config);
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      client.disconnect();
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    client
      .connect()
      .then(() => finish(true))
      .catch(() => finish(false));
  });
}

export async function resolveGateway(): Promise<GatewayResolution> {
  const timeoutMs = ATLAS_GATEWAY_CONFIG.connectTimeoutMs;

  // Tier 1: saved Keychain config is authoritative — try it first.
  const saved = await loadBridgeConfigWithSource();
  if (saved.source === 'saved' && (await wsHandshakeOk(saved.config, timeoutMs))) {
    return { config: saved.config, connectedUrl: saved.config.baseUrl, source: 'saved', transport: 'ws' };
  }

  // Tier 2: walk the portable defaults until one answers.
  for (const candidate of ATLAS_GATEWAY_CONFIG.fallbackUrls) {
    const config = { baseUrl: candidate, token: ATLAS_GATEWAY_CONFIG.token };
    if (await wsHandshakeOk(config, timeoutMs)) {
      return { config, connectedUrl: candidate, source: 'default', transport: 'ws' };
    }
  }

  // Tier 3: no WS answered anywhere. Try long-poll HTTP — works wherever
  // fetch works, no WebSocket upgrade required.
  const lpCandidates = [saved.config.baseUrl, ...ATLAS_GATEWAY_CONFIG.fallbackUrls];
  for (const candidate of lpCandidates) {
    const config = { baseUrl: candidate, token: ATLAS_GATEWAY_CONFIG.token };
    if (await lpProbeOk(config)) {
      return { config, connectedUrl: candidate, source: 'fallback', transport: 'lp' };
    }
  }
  return {
    config: saved.config,
    connectedUrl: saved.config.baseUrl,
    source: 'fallback',
    transport: 'ws',
  };
}
