import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

export type BridgeConfig = {
  baseUrl: string;
  token: string;
};

const URL_KEY = 'atlas.bridge.url';
const TOKEN_KEY = 'atlas.bridge.token';

// Built-in default connection — Atlas connects out of the box with no setup.
const DEFAULT_BASE_URL = 'https://atlas-hermes.majorpropertymanagement.com';
const DEFAULT_TOKEN = 'atlas-iphone-2026';
const secureOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

function webStorage(): Storage | null {
  return Platform.OS === 'web' && typeof localStorage !== 'undefined' ? localStorage : null;
}

export async function loadBridgeConfig(): Promise<BridgeConfig | null> {
  const storage = webStorage();
  const [baseUrl, token] = storage
    ? [storage.getItem(URL_KEY), storage.getItem(TOKEN_KEY)]
    : await Promise.all([
        SecureStore.getItemAsync(URL_KEY, secureOptions),
        SecureStore.getItemAsync(TOKEN_KEY, secureOptions),
      ]);
  return baseUrl && token ? { baseUrl, token } : { baseUrl: DEFAULT_BASE_URL, token: DEFAULT_TOKEN };
}

export async function saveBridgeConfig(config: BridgeConfig): Promise<void> {
  const storage = webStorage();
  if (storage) {
    storage.setItem(URL_KEY, config.baseUrl.trim());
    storage.setItem(TOKEN_KEY, config.token.trim());
    return;
  }
  await Promise.all([
    SecureStore.setItemAsync(URL_KEY, config.baseUrl.trim(), secureOptions),
    SecureStore.setItemAsync(TOKEN_KEY, config.token.trim(), secureOptions),
  ]);
}

export async function clearBridgeConfig(): Promise<void> {
  const storage = webStorage();
  if (storage) {
    storage.removeItem(URL_KEY);
    storage.removeItem(TOKEN_KEY);
    return;
  }
  await Promise.all([
    SecureStore.deleteItemAsync(URL_KEY, secureOptions),
    SecureStore.deleteItemAsync(TOKEN_KEY, secureOptions),
  ]);
}
