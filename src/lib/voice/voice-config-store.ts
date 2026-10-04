import * as SecureStore from 'expo-secure-store';

const KEY_KEY = 'atlas.voice.key';
const ID_KEY = 'atlas.voice.id';

export type VoiceCfg = { apiKey: string; voiceId: string } | null;

export async function loadVoiceConfig(): Promise<VoiceCfg> {
  const [apiKey, voiceId] = await Promise.all([
    SecureStore.getItemAsync(KEY_KEY),
    SecureStore.getItemAsync(ID_KEY),
  ]);
  return apiKey && voiceId ? { apiKey, voiceId } : null;
}

export async function saveVoiceConfig(cfg: { apiKey: string; voiceId: string }): Promise<void> {
  await SecureStore.setItemAsync(KEY_KEY, cfg.apiKey.trim());
  await SecureStore.setItemAsync(ID_KEY, cfg.voiceId.trim());
}
