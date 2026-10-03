import { buildRpcRequest, parseGatewayFrame, type GatewayEvent } from './gateway-protocol';
import { normalizeBridgeUrl } from './normalize-bridge-url';
import type { BridgeConfig } from './secure-config-store';

type PendingRequest = {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

type ActiveTurn = {
  sessionId: string;
  resolve: (text: string) => void;
  reject: (error: Error) => void;
  streamedText: string;
  onDelta?: (text: string) => void;
  onApproval?: (request: ApprovalRequest) => Promise<ApprovalChoice>;
};

export type ApprovalChoice = 'once' | 'session' | 'always' | 'deny';
export type ApprovalRequest = {
  command?: string;
  description?: string;
  choices: ApprovalChoice[];
};

export type ConnectionState = 'disconnected' | 'connecting' | 'connected';

export class HermesGatewayClient {
  private socket: WebSocket | null = null;
  private counter = 0;
  private pending = new Map<string, PendingRequest>();
  private activeTurn: ActiveTurn | null = null;
  private sessionId: string | null = null;
  private readyPromise: Promise<void> | null = null;
  private readyResolve: (() => void) | null = null;
  private readyReject: ((error: Error) => void) | null = null;
  private state: ConnectionState = 'disconnected';

  constructor(
    private readonly config: BridgeConfig,
    private readonly onStateChange?: (state: ConnectionState) => void,
  ) {}

  get connectionState(): ConnectionState {
    return this.state;
  }

  async connect(): Promise<void> {
    if (this.state === 'connected') return;
    if (this.readyPromise) return this.readyPromise;

    this.setState('connecting');
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });

    const url = new URL(normalizeBridgeUrl(this.config.baseUrl));
    url.searchParams.set('token', this.config.token);
    this.socket = new WebSocket(url.toString());
    this.socket.onmessage = (event) => this.handleMessage(String(event.data));
    this.socket.onerror = (event) => {
      const native = (() => { try { return (event as unknown as { error?: { message?: string } }).error?.message ?? 'no native error'; } catch { return 'unknown'; } })();
      this.failConnection(new Error(`Could not reach the Atlas bridge | dialed: ${url.toString()} | native: ${native}`));
    };
    this.socket.onclose = () => this.failConnection(new Error('Atlas bridge disconnected'));

    const timeout = setTimeout(
      () => this.failConnection(new Error('Atlas bridge connection timed out')),
      15_000,
    );
    try {
      await this.readyPromise;
    } finally {
      clearTimeout(timeout);
    }
  }

  async ask(
    text: string,
    options: {
      onDelta?: (text: string) => void;
      onApproval?: (request: ApprovalRequest) => Promise<ApprovalChoice>;
    } = {},
  ): Promise<string> {
    await this.connect();
    const sessionId = await this.ensureSession();
    if (this.activeTurn) throw new Error('Atlas is already handling a request');

    return new Promise<string>((resolve, reject) => {
      this.activeTurn = {
        sessionId,
        resolve,
        reject,
        streamedText: '',
        ...options,
      };
      this.request('prompt.submit', { session_id: sessionId, text }).catch((error) => {
        this.activeTurn = null;
        reject(error);
      });
    });
  }

  disconnect(): void {
    this.socket?.close();
    this.socket = null;
    this.sessionId = null;
    this.readyPromise = null;
    this.setState('disconnected');
  }

  private async ensureSession(): Promise<string> {
    if (this.sessionId) return this.sessionId;
    const result = await this.request('session.create', {
      source: 'atlas-ios',
      title: 'Atlas iPhone',
      close_on_disconnect: false,
      cols: 100,
    });
    const sessionId = result.session_id;
    if (typeof sessionId !== 'string' || !sessionId) {
      throw new Error('Atlas did not create a conversation session');
    }
    this.sessionId = sessionId;
    return sessionId;
  }

  private request(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('Atlas bridge is not connected'));
    }
    const id = `ios-${++this.counter}`;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Atlas request timed out: ${method}`));
      }, 120_000);
      this.pending.set(id, { resolve, reject, timeout });
      socket.send(JSON.stringify(buildRpcRequest(id, method, params)));
    });
  }

  private handleMessage(raw: string): void {
    let frame;
    try {
      frame = parseGatewayFrame(raw);
    } catch {
      return;
    }

    if (frame.kind === 'response') {
      const pending = this.pending.get(frame.id);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.pending.delete(frame.id);
      if (frame.error) pending.reject(new Error(frame.error.message));
      else pending.resolve(frame.result ?? {});
      return;
    }

    if (frame.type === 'gateway.ready') {
      this.setState('connected');
      this.readyResolve?.();
      this.readyResolve = null;
      this.readyReject = null;
      return;
    }
    this.handleEvent(frame);
  }

  private handleEvent(event: GatewayEvent): void {
    const turn = this.activeTurn;
    if (!turn || (event.sessionId && event.sessionId !== turn.sessionId)) return;

    if (event.type === 'message.delta') {
      const delta = typeof event.payload.text === 'string' ? event.payload.text : '';
      turn.streamedText += delta;
      turn.onDelta?.(turn.streamedText);
      return;
    }

    if (event.type === 'approval.request') {
      const available: ApprovalChoice[] = Array.isArray(event.payload.choices)
        ? event.payload.choices.filter((item): item is ApprovalChoice =>
            ['once', 'session', 'always', 'deny'].includes(String(item)),
          )
        : ['once', 'deny'];
      const request: ApprovalRequest = {
        command: typeof event.payload.command === 'string' ? event.payload.command : undefined,
        description:
          typeof event.payload.description === 'string' ? event.payload.description : undefined,
        choices: available,
      };
      (turn.onApproval?.(request) ?? Promise.resolve<ApprovalChoice>('deny'))
        .then((choice) =>
          this.request('approval.respond', {
            session_id: turn.sessionId,
            choice,
          }),
        )
        .catch(() => undefined);
      return;
    }

    if (event.type === 'message.complete') {
      const status = typeof event.payload.status === 'string' ? event.payload.status : 'complete';
      const finalText =
        typeof event.payload.text === 'string' && event.payload.text.trim()
          ? event.payload.text
          : turn.streamedText;
      this.activeTurn = null;
      if (status === 'error') turn.reject(new Error(finalText || 'Atlas request failed'));
      else turn.resolve(finalText.trim());
    }
  }

  private failConnection(error: Error): void {
    if (this.state === 'disconnected' && !this.readyPromise) return;
    this.setState('disconnected');
    this.readyReject?.(error);
    this.readyResolve = null;
    this.readyReject = null;
    this.readyPromise = null;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
    this.activeTurn?.reject(error);
    this.activeTurn = null;
  }

  private setState(state: ConnectionState): void {
    this.state = state;
    this.onStateChange?.(state);
  }
}
