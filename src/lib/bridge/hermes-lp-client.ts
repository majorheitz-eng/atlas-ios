// Long-poll HTTP transport for the Hermes gateway — no WebSocket required.
// Works everywhere fetch works: iOS ATS off-road, cellular, locked wifi, and
// inside React Native where the WS stack misbehaves. Same JSON-RPC frames as
// the WS transport, delivered via POST /api/lp/send + GET /api/lp/poll.

import { buildRpcRequest, parseGatewayFrame } from './gateway-protocol';
import type { BridgeConfig } from './secure-config-store';

export type ConnectionState = 'disconnected' | 'connecting' | 'connected';

type Pending = { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

export class HermesLongPollClient {
  private counter = 0;
  private pending = new Map<string, Pending>();
  private sessionId: string | null = null;
  private polling = false;
  private pollAbort: AbortController | null = null;
  private cursor = 0;
  private state: ConnectionState = 'disconnected';
  private activeTurn: { resolve: (t: string) => void; reject: (e: Error) => void; streamed: string; onDelta?: (t: string) => void } | null = null;
  private onStateChange?: (s: ConnectionState) => void;

  constructor(private readonly config: BridgeConfig, onStateChange?: (s: ConnectionState) => void) {
    this.onStateChange = onStateChange;
  }

  private setState(s: ConnectionState) {
    this.state = s;
    this.onStateChange?.(s);
  }

  private root(): string {
    return this.config.baseUrl.replace(/\/+$/, '').replace(/\/api\/ws$/, '');
  }

  async connect(): Promise<void> {
    if (this.state === 'connected') return;
    this.setState('connecting');
    // Probe: plain GET — auth middleware answers 401/404 = reachable.
    const probe = await fetch(`${this.root()}/api/ws`, { headers: { Authorization: `Bearer ${this.config.token}` } });
    if (probe.status === 0) throw new Error('Atlas bridge unreachable');
    this.setState('connected');
    this.polling = true;
    void this.pollLoop();
  }

  disconnect(): void {
    this.polling = false;
    this.pollAbort?.abort();
    this.setState('disconnected');
  }

  async ask(text: string, opts: { onDelta?: (t: string) => void } = {}): Promise<string> {
    await this.connect();
    if (!this.sessionId) {
      const r = await this.request('session.create', { source: 'atlas-ios-lp', title: 'Atlas iPhone', close_on_disconnect: false, cols: 100 });
      this.sessionId = String(r.session_id || '');
      if (!this.sessionId) throw new Error('Atlas did not create a session');
    }
    return new Promise<string>((resolve, reject) => {
      this.activeTurn = { resolve, reject, streamed: '', onDelta: opts.onDelta };
      this.request('prompt.submit', { session_id: this.sessionId, text }).catch((e) => {
        this.activeTurn = null;
        reject(e);
      });
    });
  }

  private request(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const id = `lp-${++this.counter}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Atlas timed out: ${method}`));
      }, 120_000);
      this.pending.set(id, { resolve, reject, timer });
      fetch(`${this.root()}/api/lp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.config.token}` },
        body: JSON.stringify(buildRpcRequest(id, method, params)),
      }).then((res) => {
        if (!res.ok) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(new Error(`Atlas send failed: HTTP ${res.status}`));
        }
      }).catch((e) => {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e instanceof Error ? e : new Error(String(e)));
      });
    });
  }

  private async pollLoop(): Promise<void> {
    this.pollAbort = new AbortController();
    while (this.polling) {
      try {
        const res = await fetch(
          `${this.root()}/api/lp/poll?session=${encodeURIComponent(this.sessionId || '__all__')}&since=${this.cursor}`,
          { headers: { Authorization: `Bearer ${this.config.token}` }, signal: this.pollAbort.signal },
        );
        if (!res.ok) throw new Error(`poll ${res.status}`);
        const data = (await res.json()) as { frames: string[]; cursor: number };
        this.cursor = data.cursor ?? this.cursor;
        for (const raw of data.frames || []) {
          try {
            const frame = parseGatewayFrame(raw);
            this.handleFrame(frame);
          } catch { /* skip unparsable */ }
        }
      } catch {
        if (!this.polling) return;
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }

  private handleFrame(frame: ReturnType<typeof parseGatewayFrame>): void {
    if (frame.kind === 'response') {
      const p = this.pending.get(frame.id);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(frame.id);
      if (frame.error) p.reject(new Error(frame.error.message));
      else p.resolve(frame.result ?? {});
      return;
    }
    const turn = this.activeTurn;
    if (!turn) return;
    if (frame.type === 'message.delta') {
      const delta = typeof frame.payload.text === 'string' ? frame.payload.text : '';
      if (delta) {
        turn.streamed += delta;
        turn.onDelta?.(turn.streamed);
      }
    } else if (frame.type === 'message.complete') {
      const reply = String(frame.payload.text || turn.streamed).trim();
      this.activeTurn = null;
      turn.resolve(reply);
    }
  }
}
