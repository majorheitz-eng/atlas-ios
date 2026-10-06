import { NativeEventEmitter, Platform } from 'react-native';
import { requireNativeModule } from 'expo';
import type { NativeModule } from 'react-native';

/**
 * Native RayNeo iO module — BLE transport for RayNeo iO glasses.
 *
 * The native Swift module (modules/rayneo/ios/RayNeoModule.swift) scans for
 * the RayNeo iO service (0000B81D-…), connects over CoreBluetooth, and encodes
 * outbound frames using the 0xAA 0x55 transport framing with CRC-16/XMODEM,
 * matching the Turbo-IO reverse-engineered protocol.
 *
 * Connection lifecycle events are emitted via the native `RayNeo` event emitter:
 *   - "connectionState"  { state: 'connected' | 'disconnected' | 'poweredOn' | … }
 *   - "scanResult"      { id: string, name: string }
 *   - "messageReceived" { data: string (base64) }
 *   - "error"           { kind: string, message: string }
 */

export type RayNeoConnectionState =
  | 'unknown'
  | 'resetting'
  | 'unsupported'
  | 'unauthorized'
  | 'poweredOff'
  | 'poweredOn'
  | 'connected'
  | 'disconnected';

export interface RayNeoScanResult {
  id: string;
  name: string;
}

export interface RayNeoErrorEvent {
  kind: string;
  message: string;
}

export interface RayNeoMessageEvent {
  /** Base64-encoded raw inbound BLE bytes (already de-framed by the glasses). */
  data: string;
}

export interface RayNeoConnectionEvent {
  state: RayNeoConnectionState;
  id?: string;
}

/**
 * Settings/status event emitted by the native module after parsing inbound
 * business 15 frames. Fields are present only when the glasses reported them.
 */
export interface RayNeoSettingsEvent {
  /** The business 15 message type: 1 (status), 3 (cmd response), 4 (settings). */
  type: number;
  /** The cmd string from the JSON body, e.g. "general_status", "brightness_change". */
  cmd?: string;
  /** HUD brightness (7 = low, 8 = high). Present on status + brightness_change responses. */
  brightness?: number;
  /** Battery level (0–100). Present on status responses. */
  battery?: number;
  /** Display height (1 = low, 3 = medium, 5 = high). Present on settings responses. */
  displayHeight?: number;
  /** Display distance (1 = near, 2 = far). Present on settings responses. */
  displayDistance?: number;
}

type RayNeoNativeModule = {
  startCentral(): Promise<void>;
  startScan(timeoutMs?: number): Promise<{ scanning: boolean }>;
  stopScan(): Promise<void>;
  connect(identifier: string): Promise<void>;
  disconnect(): Promise<void>;
  sendText(text: string, isFinal: boolean): Promise<void>;
  sendAnswer(
    text: string,
    isFinal: boolean,
    roundID: string,
    query: string,
    timestampMs: number
  ): Promise<void>;
  sendResponseComplete(): Promise<void>;
  sendTeleprompterText(
    did: string,
    text: string,
    speed: number,
    total?: number | null
  ): Promise<void>;
  sendNotification(
    title: string,
    content: string,
    appName?: string | null,
    timestamp?: string | null
  ): Promise<void>;
  setBrightness(value: number): Promise<void>;
  setDisplay(height: number, distance: number): Promise<void>;
  refreshSettings(): Promise<void>;
  getScanStatus(): Promise<string>;
};

const NativeRayNeo = requireNativeModule<RayNeoNativeModule>('RayNeo');

const emitter = new NativeEventEmitter(
  Platform.OS === 'ios' ? (NativeRayNeo as unknown as NativeModule) : undefined
);

/**
 * Initialize the CoreBluetooth central manager. Safe to call repeatedly; the
 * native side no-ops if a manager already exists. Call once at app start or
 * before the first scan.
 */
export function startCentral(): Promise<void> {
  return NativeRayNeo.startCentral();
}

/**
 * Begin scanning for RayNeo iO glasses advertising the service UUID. Discovered
 * devices are reported via the `scanResult` event. Returns immediately with a
 * `{ scanning: true }` snapshot; stop scanning with `stopScan()`.
 */
export function startScan(timeoutMs?: number): Promise<{ scanning: boolean }> {
  return NativeRayNeo.startScan(timeoutMs);
}

/** Stop an active scan. */
export function stopScan(): Promise<void> {
  return NativeRayNeo.stopScan();
}

/**
 * Connect to a discovered peripheral by its UUID string (from a `scanResult`
 * event). Connection success/failure is reported via the `connectionState`
 * event; the returned promise resolves once the connect call is dispatched.
 */
export function connect(identifier: string): Promise<void> {
  return NativeRayNeo.connect(identifier);
}

/** Disconnect from the currently connected glasses, if any. */
export function disconnect(): Promise<void> {
  return NativeRayNeo.disconnect();
}

/**
 * Send an assistant ASR-text message (business 13, type 5). `isFinal` marks the
 * terminal chunk of a recognition stream. Text is limited to 1024 UTF-8 bytes.
 */
export function sendText(text: string, isFinal: boolean): Promise<void> {
  return NativeRayNeo.sendText(text, isFinal);
}

/**
 * Send an assistant answer message (business 13, type 32). Mirrors the
 * `deepseek`/`workflow` chat envelope used by the iOS AssistantAnswerPrototype.
 * `roundID` should be a stable lowercase UUID for the conversation round;
 * `timestampMs` is epoch milliseconds.
 */
export function sendAnswer(
  text: string,
  isFinal: boolean,
  roundID: string,
  query: string,
  timestampMs: number
): Promise<void> {
  return NativeRayNeo.sendAnswer(text, isFinal, roundID, query, timestampMs);
}

/**
 * Signal response completion (business 13, type 12). Send once when an answer
 * stream is finished; the device treats this as the round terminator.
 */
export function sendResponseComplete(): Promise<void> {
  return NativeRayNeo.sendResponseComplete();
}

/**
 * Send teleprompter text (business 20, type 2 "prepare"). The glasses allocate
 * a teleprompter session for `did` and expect the host to push the full body
 * before issuing pause/resume/stop/progress controls. `speed` is WPM (60–240
 * per the reference contract); `total` is the UTF-8 byte length when known.
 */
export function sendTeleprompterText(
  did: string,
  text: string,
  speed: number,
  total?: number | null
): Promise<void> {
  return NativeRayNeo.sendTeleprompterText(did, text, speed, total ?? null);
}

/**
 * Push a notification to the glasses (business 21, type 2 "notify"). Title is
 * limited to 16 chars and content to 48 chars by the device contract. An
 * ISO-8601 timestamp is generated when none is supplied.
 */
export function sendNotification(
  title: string,
  content: string,
  appName?: string | null,
  timestamp?: string | null
): Promise<void> {
  return NativeRayNeo.sendNotification(title, content, appName ?? null, timestamp ?? null);
}

/**
 * Set HUD brightness (business 15, type 2). `value` must be 7 (low) or 8 (high).
 * The glasses confirm the change via a settings event with the new brightness.
 */
export function setBrightness(value: number): Promise<void> {
  return NativeRayNeo.setBrightness(value);
}

/**
 * Set HUD display configuration (business 15, type 5). `height` must be 1 (low),
 * 3 (medium), or 5 (high); `distance` must be 1 (near) or 2 (far). The glasses
 * confirm via a settings event with the new displayHeight/displayDistance.
 */
export function setDisplay(height: number, distance: number): Promise<void> {
  return NativeRayNeo.setDisplay(height, distance);
}

/**
 * Request the current device status and display settings from the glasses
 * (business 15, types 1 + 4). The glasses respond asynchronously via the
 * `settings` event — subscribe with `onSettings()`.
 */
export function refreshSettings(): Promise<void> {
  return NativeRayNeo.refreshSettings();
}

/** Query the current scan status from the native module. */
export function getScanStatus(): Promise<string> {
  return NativeRayNeo.getScanStatus();
}

/**
 * Subscribe to RayNeo connection lifecycle / inbound events.
 *
 *   onConnectionState(callback)
 *   onScanResult(callback)
 *   onMessageReceived(callback)
 *   onError(callback)
 *
 * Each returns an unsubscribe function. Multiple listeners per event are
 * supported.
 */
export function onConnectionState(
  listener: (event: RayNeoConnectionEvent) => void
): () => void {
  const sub = emitter.addListener('connectionState', listener);
  return () => sub.remove();
}

export function onScanResult(
  listener: (event: RayNeoScanResult) => void
): () => void {
  const sub = emitter.addListener('scanResult', listener);
  return () => sub.remove();
}

export function onMessageReceived(
  listener: (event: RayNeoMessageEvent) => void
): () => void {
  const sub = emitter.addListener('messageReceived', listener);
  return () => sub.remove();
}

export function onError(listener: (event: RayNeoErrorEvent) => void): () => void {
  const sub = emitter.addListener('error', listener);
  return () => sub.remove();
}

/**
 * Subscribe to settings/status events. The native module parses inbound
 * business 15 frames and emits a structured event with brightness, battery,
 * and display config when available. Each frame that carries new data
 * triggers one event; fields not present in the frame are omitted.
 */
export function onSettings(
  listener: (event: RayNeoSettingsEvent) => void
): () => void {
  const sub = emitter.addListener('settings', listener);
  return () => sub.remove();
}

export default {
  startCentral,
  startScan,
  stopScan,
  connect,
  disconnect,
  sendText,
  sendAnswer,
  sendResponseComplete,
  sendTeleprompterText,
  sendNotification,
  setBrightness,
  setDisplay,
  refreshSettings,
  onConnectionState,
  onScanResult,
  onMessageReceived,
  onSettings,
  onError,
  getScanStatus,
};
