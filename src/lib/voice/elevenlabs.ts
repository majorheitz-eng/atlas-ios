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

    // Write raw bytes directly — no base64 encoding. The old code built a
    // binary string from char codes and wrote it with encoding:'base64',
    // which corrupted every MP3 and caused the voice clone to be silently
    // inaudible. file.write() accepts Uint8Array natively.
    const bytes = new Uint8Array(await res.arrayBuffer());
    const file = new File(Paths.cache, `atlas_reply_${Date.now()}.mp3`);
    file.write(bytes);
    return file.uri;
  } catch {
    return null;
  }
}
