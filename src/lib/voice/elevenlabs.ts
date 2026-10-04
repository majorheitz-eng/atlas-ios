// ElevenLabs TTS — Major Atlas voice clone playback.
// API key + voice id are stored in SecureStore (Settings → Voice).
import { File, Paths } from 'expo-file-system';

const API_BASE = 'https://api.elevenlabs.io/v1';

export type VoiceConfig = { apiKey: string; voiceId: string };

export async function synthesizeToFile(text: string, cfg: VoiceConfig): Promise<string | null> {
  const safeText = text.slice(0, 4000);
  const url = `${API_BASE}/text-to-speech/${cfg.voiceId}?output_format=mp3_44100_128`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': cfg.apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: safeText,
        model_id: 'eleven_turbo_v2_5',
        voice_settings: { stability: 0.4, similarity_boost: 0.85, style: 0.1, use_speaker_boost: true },
      }),
    });
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const file = new File(Paths.cache, `atlas_reply_${Date.now()}.mp3`);
    file.write(binary, { encoding: 'base64' });
    return file.uri;
  } catch {
    return null;
  }
}
