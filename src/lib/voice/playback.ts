// Reply playback: ElevenLabs (Major Atlas clone) when configured, on-device TTS fallback.
import * as Speech from 'expo-speech';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { loadVoiceConfig } from './voice-config-store';
import { synthesizeToFile } from './elevenlabs';

let configured = false;
async function ensureAudioMode() {
  if (configured) return;
  try {
    await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: false });
    configured = true;
  } catch { /* ignore */ }
}

let currentPlayer: AudioPlayer | null = null;

export async function speakReply(text: string, onDone: () => void): Promise<void> {
  const cfg = await loadVoiceConfig();
  if (cfg?.apiKey && cfg?.voiceId) {
    try {
      await ensureAudioMode();
      const uri = await synthesizeToFile(text, cfg);
      if (uri) {
        currentPlayer?.release();
        const player = createAudioPlayer({ uri });
        currentPlayer = player;
        player.addListener?.('playbackStatusUpdate', (st: { didJustFinish?: boolean }) => {
          if (st?.didJustFinish) onDone();
        });
        player.play();
        return;
      }
    } catch { /* fall through to expo-speech */ }
  }
  Speech.speak(text, {
    language: 'en-US',
    rate: 0.96,
    pitch: 0.93,
    onDone,
    onStopped: onDone,
    onError: onDone,
  });
}
