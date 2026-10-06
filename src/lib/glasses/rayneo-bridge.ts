import { GlassesNativeModule, onGlassesState } from './glasses-events';

// Re-export the glasses config so consumers can import from one place.
export { ATLAS_GLASSES } from '@/lib/gateway';

export type GlassesConnectionState =
  | 'disconnected'
  | 'scanning'
  | 'connecting'
  | 'connected'
  | 'authenticated';

export interface GlassesEvent {
  state: GlassesConnectionState;
  message?: string;
}

/**
 * RayNeo iO glasses bridge — connects to the paired RayNeo iO glasses via BLE
 * and pushes Atlas responses to the HUD.
 *
 * The glasses use a closed BLE profile (service B81D) with MFi authentication.
 * They must already be bonded through the official RayNeo app. This module
 * connects directly to the bonded peripheral, completes the GATT handshake,
 * and pushes text/notifications to the HUD via the proprietary protocol.
 *
 * If the native module isn't available (dev client, Android, or not linked),
 * all methods gracefully no-op — the app works without glasses.
 */
class RayNeoGlasses {
  private _state: GlassesConnectionState = 'disconnected';
  private _available: boolean;
  private listeners: Set<(event: GlassesEvent) => void> = new Set();
  private unsubscribeState: (() => void) | null = null;
  private connectPromise: Promise<void> | null = null;

  constructor() {
    this._available = GlassesNativeModule != null;
    if (this._available) {
      this.unsubscribeState = onGlassesState((state, message) => {
        this._state = state as GlassesConnectionState;
        const event: GlassesEvent = { state: this._state, message };
        this.listeners.forEach((l) => l(event));
      });
    }
  }

  get available(): boolean { return this._available; }
  get state(): GlassesConnectionState { return this._state; }
  get isConnected(): boolean {
    return this._state === 'connected' || this._state === 'authenticated';
  }

  async connect(): Promise<void> {
    if (!this._available) return;
    if (this.isConnected) return;
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = GlassesNativeModule.connect()
      .catch((err: Error) => { console.warn('[RayNeoGlasses] Connect failed:', err.message); throw err; })
      .finally(() => { this.connectPromise = null; });
    return this.connectPromise!;
  }

  disconnect(): void {
    if (!this._available) return;
    GlassesNativeModule.disconnect();
  }

  async pushText(text: string): Promise<void> {
    if (!this._available || !this.isConnected) return;
    const truncated = text.length > 1024 ? text.slice(0, 1024) : text;
    try { await GlassesNativeModule.pushText(truncated); }
    catch (err) { console.warn('[RayNeoGlasses] pushText failed:', err); }
  }

  async pushNotification(title: string, content: string): Promise<string | null> {
    if (!this._available || !this.isConnected) return null;
    try { return await GlassesNativeModule.pushNotification(title, content); }
    catch (err) { console.warn('[RayNeoGlasses] pushNotification failed:', err); return null; }
  }

  onStateChange(listener: (event: GlassesEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  destroy(): void {
    this.listeners.clear();
    this.unsubscribeState?.();
    this.unsubscribeState = null;
  }
}

export const glasses = new RayNeoGlasses();
