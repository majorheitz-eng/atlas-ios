import { NativeEventEmitter, Platform } from 'react-native';

// Lazy-load the native module — it may not be available in dev client or if
// the module isn't linked yet. We gracefully degrade.
function getNativeModule(): any | null {
  if (Platform.OS !== 'ios') return null;
  try {
    const { NativeModules } = require('react-native');
    return NativeModules.ExpoRayNeoGlasses ?? null;
  } catch {
    return null;
  }
}

const nativeModule = getNativeModule();

// Create a typed event emitter backed by the native module's events.
export const glassesEventEmitter = nativeModule
  ? new NativeEventEmitter(nativeModule)
  : null;

/**
 * Subscribe to glasses state changes from the native BLE module.
 * Returns an unsubscribe function.
 */
export function onGlassesState(
  listener: (state: string, message?: string) => void
): () => void {
  if (!glassesEventEmitter) return () => {};
  const sub = glassesEventEmitter.addListener(
    'onGlassesState',
    (event: { state: string; message?: string }) => {
      listener(event.state, event.message);
    }
  );
  return () => sub.remove();
}

export { nativeModule as GlassesNativeModule };
