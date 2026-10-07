import { useCallback, useEffect, useRef, useState } from 'react';
import { palette } from '@/theme/palette';

/**
 * RayNeo BLE connection manager
 * ------------------------------
 * Wraps the native RayNeo module (modules/rayneo) behind a single React
 * hook so every Atlas screen can share one BLE lifecycle. The native module
 * is being built in parallel; until it lands, `RayNeoNative` resolves to a
 * stub that reports "unavailable" so the UI degrades gracefully instead of
 * crashing.
 *
 * No Animated API, no native driver — state is driven by useState + setInterval.
 */

export type RayNeoScanStatus =
  | 'unavailable'      // native module not linked into this build
  | 'idle'             // not scanning, not connected
  | 'scanning'         // actively scanning for glasses
  | 'connecting'       // device selected, BLE handshake in progress
  | 'connected'        // glasses connected and ready to receive frames
  | 'disconnected';    // was connected, lost the link

export type RayNeoDevice = {
  id: string;
  name: string;
  rssi?: number;
};

/** Surface of the native RayNeo module being built at modules/rayneo. */
export interface RayNeoNative {
  startCentral(): Promise<void>;
  connect(deviceId: string): Promise<void>;
  disconnect(): Promise<void>;
  sendText(text: string, isFinal: boolean): Promise<void>;
  sendAnswer(text: string, isFinal: boolean, roundID: string, query: string, timestampMs: number): Promise<void>;
  sendResponseComplete(): Promise<void>;
  sendTeleprompterText(did: string, text: string, speed: number, total: number | null): Promise<void>;
  sendNotification(title: string, content: string, appName: string | null, timestamp: string | null): Promise<void>;
  setBrightness(value: number): Promise<void>;
  setDisplay(height: number, distance: number): Promise<void>;
  refreshSettings(): Promise<void>;
  startScan(timeoutMs?: number): Promise<{ scanning: boolean }>;
  stopScan(): Promise<void>;
  getScanStatus(): Promise<string>;
}

/**
 * Best-effort load of the native module. Any failure (module not registered,
 * new NativeEventEmitter on a non-native build, etc.) returns null and the
 * hook reports `unavailable` so screens keep working without the glasses.
 */
function loadNative(): RayNeoNative | null {
  try {
    // The native module is registered under the name `RayNeo` in the Expo
    // module registry. We avoid a static import so this file compiles even
    // while the module is still in development. This file lives at
    // src/lib/rayneo/connection.ts, so three levels up reaches the repo root
    // before descending into modules/rayneo/src/RayNeoModule (the module has
    // no index.ts, so the file must be named explicitly).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('../../../modules/rayneo/src/RayNeoModule');
    if (mod && typeof mod.connect === 'function') {
      return mod as RayNeoNative;
    }
    return null;
  } catch {
    return null;
  }
}

export type UseRayNeo = {
  status: RayNeoScanStatus;
  connected: boolean;
  unavailable: boolean;
  devices: RayNeoDevice[];
  scan: () => Promise<void>;
  stopScan: () => Promise<void>;
  connect: (deviceId?: string) => Promise<void>;
  disconnect: () => Promise<void>;
  sendText: (text: string) => Promise<void>;
  sendAnswer: (text: string) => Promise<void>;
  sendResponseComplete: () => Promise<void>;
  sendTeleprompterText: (text: string) => Promise<void>;
  sendNotification: (text: string) => Promise<void>;
  setBrightness: (value: number) => Promise<void>;
  setDisplay: (height: number, distance: number) => Promise<void>;
  refreshSettings: () => Promise<void>;
  brightness: number | null;
  battery: number | null;
  displayHeight: number | null;
  displayDistance: number | null;
};

/**
 * Hook sharing one RayNeo BLE lifecycle across the app. Call it from any
 * screen; each call observes the same status because the native module owns
 * the singleton connection — but the React state is per-hook-instance, so
 * the hook re-reads the native status on a 1s cadence via setInterval.
 */
export function useRayNeo(): UseRayNeo {
  const nativeRef = useRef<RayNeoNative | null>(null);
  if (nativeRef.current === null) {
    nativeRef.current = loadNative();
  }
  const native = nativeRef.current;

  const [status, setStatus] = useState<RayNeoScanStatus>(
    native ? 'idle' : 'unavailable',
  );
  const [devices, setDevices] = useState<RayNeoDevice[]>([]);
  const [brightness, setBrightnessState] = useState<number | null>(null);
  const [battery, setBatteryState] = useState<number | null>(null);
  const [displayHeight, setDisplayHeightState] = useState<number | null>(null);
  const [displayDistance, setDisplayDistanceState] = useState<number | null>(null);

  // Poll the native module's status every second while the hook is mounted.
  // This is the watchdog: even if the native side changes state without an
  // event (older build), the React state stays in sync.
  useEffect(() => {
    if (!native) return;
    let active = true;
    const tick = setInterval(async () => {
      try {
        const s = await native.getScanStatus();
        if (active && ['idle','scanning','connecting','connected','disconnected','unavailable'].includes(s)) {
          // Don't override 'scanning' or 'connecting' status from the poll —
          // these are set by user actions and should persist until the action completes.
          setStatus((prev) => {
            if (prev === 'scanning' || prev === 'connecting') return prev;
            return s as RayNeoScanStatus;
          });
        }
      } catch {
        /* swallow — keep last known status */
      }
    }, 1000);
    return () => {
      active = false;
      clearInterval(tick);
    };
  }, [native]);

  // Subscribe to scanResult events so discovered devices populate the list.
  // The native module emits "scanResult" for each peripheral found during a
  // scan, but without this listener the devices array stays empty and the
  // user sees "scanning" with no results.
  useEffect(() => {
    if (!native) return;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('../../../modules/rayneo/src/RayNeoModule');
    if (!mod || typeof mod.onScanResult !== 'function') return;
    const unsubscribe = mod.onScanResult((event: { id: string; name: string; rssi?: number }) => {
      setDevices((prev) => {
        // Dedupe by id — the same device can be discovered multiple times.
        if (prev.some((d) => d.id === event.id)) return prev;
        return [...prev, { id: event.id, name: event.name, rssi: event.rssi }];
      });
    });
    return unsubscribe;
  }, [native]);

  // Subscribe to settings/status events from the native module. Each inbound
  // business 15 frame that the Swift parser can decode fires a "settings"
  // event with whatever fields the glasses reported. We merge into React
  // state so the UI updates incrementally (e.g. brightness from a status
  // frame, then displayHeight from a settings frame a few ms later).
  useEffect(() => {
    if (!native) return;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('../../../modules/rayneo/src/RayNeoModule');
    if (!mod || typeof mod.onSettings !== 'function') return;
    const unsubscribe = mod.onSettings((event: Record<string, unknown>) => {
      if (typeof event.brightness === 'number') setBrightnessState(event.brightness);
      if (typeof event.battery === 'number') setBatteryState(event.battery);
      if (typeof event.displayHeight === 'number') setDisplayHeightState(event.displayHeight);
      if (typeof event.displayDistance === 'number') setDisplayDistanceState(event.displayDistance);
    });
    return unsubscribe;
  }, [native]);

  const scan = useCallback(async () => {
    if (!native) return;
    try {
      setDevices([]);
      setStatus('scanning');
      await native.startCentral();
      await native.startScan(10000);
      // The native scan auto-stops after the timeout. Reset status after
      // a delay so the UI doesn't stay in "scanning" forever if no devices
      // are found.
      setTimeout(() => {
        setStatus((s) => (s === 'scanning' ? 'idle' : s));
      }, 11000);
    } catch {
      setStatus('idle');
    }
  }, [native]);

  const stopScan = useCallback(async () => {
    if (!native) return;
    try {
      await native.stopScan();
    } finally {
      setStatus((s) => (s === 'scanning' ? 'idle' : s));
    }
  }, [native]);

  const connect = useCallback(async (deviceId?: string) => {
    if (!native || !deviceId) return;
    try {
      setStatus('connecting');
      await native.connect(deviceId);
      setStatus('connected');
    } catch {
      setStatus('idle');
    }
  }, [native]);

  const disconnect = useCallback(async () => {
    if (!native) return;
    try {
      await native.disconnect();
    } finally {
      setStatus('idle');
    }
  }, [native]);

  const sendText = useCallback(
    async (text: string) => {
      if (!native || status !== 'connected') return;
      try {
        await native.sendText(text, true);
      } catch {
        /* frame lost — don't disrupt the app */
      }
    },
    [native, status],
  );

  const sendAnswer = useCallback(
    async (text: string) => {
      if (!native || status !== 'connected') return;
      try {
        const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        await native.sendAnswer(text, true, id, '', Date.now());
      } catch {
        /* ignore */
      }
    },
    [native, status],
  );

  const sendResponseComplete = useCallback(async () => {
    if (!native || status !== 'connected') return;
    try {
      await native.sendResponseComplete();
    } catch {
      /* ignore */
    }
  }, [native, status]);

  const sendTeleprompterText = useCallback(
    async (text: string) => {
      if (!native || status !== 'connected') return;
      try {
        const did = `atlas-${Date.now()}`;
        await native.sendTeleprompterText(did, text, 120, null);
      } catch {
        /* ignore */
      }
    },
    [native, status],
  );

  const sendNotification = useCallback(
    async (text: string) => {
      if (!native || status !== 'connected') return;
      try {
        await native.sendNotification('Atlas', text, null, null);
      } catch {
        /* ignore */
      }
    },
    [native, status],
  );

  const setBrightness = useCallback(
    async (value: number) => {
      if (!native || status !== 'connected') return;
      try {
        await native.setBrightness(value);
      } catch {
        /* ignore */
      }
    },
    [native, status],
  );

  const setDisplay = useCallback(
    async (height: number, distance: number) => {
      if (!native || status !== 'connected') return;
      try {
        await native.setDisplay(height, distance);
      } catch {
        /* ignore */
      }
    },
    [native, status],
  );

  const refreshSettings = useCallback(async () => {
    if (!native || status !== 'connected') return;
    try {
      await native.refreshSettings();
    } catch {
      /* ignore */
    }
  }, [native, status]);

  return {
    status,
    connected: status === 'connected',
    unavailable: status === 'unavailable',
    devices,
    scan,
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
    brightness,
    battery,
    displayHeight,
    displayDistance,
  };
}

/** Status → palette color, used by every screen's glasses indicator. */
export const rayNeoStatusColor: Record<RayNeoScanStatus, string> = {
  unavailable: palette.muted,
  idle: palette.muted,
  scanning: palette.cyan,
  connecting: '#FFCA75',
  connected: palette.success,
  disconnected: palette.danger,
};

/** Short uppercase label for the status, sized for HUD chips. */
export const rayNeoStatusLabel: Record<RayNeoScanStatus, string> = {
  unavailable: 'NO BLE',
  idle: 'GLASSES OFF',
  scanning: 'SCANNING',
  connecting: 'LINKING',
  connected: 'GLASSES ON',
  disconnected: 'LINK LOST',
};
