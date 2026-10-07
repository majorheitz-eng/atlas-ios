// Reply playback: ElevenLabs (Major Atlas clone) when configured, on-device TTS fallback.
//
// STREAMING: createStreamingSpeaker() accumulates the streamed reply and
// synthesizes the COMPLETE text in a single ElevenLabs call when finish()
// fires — one network round-trip instead of one per sentence.
// speakReply() is kept for complete (non-streamed) replies; speakGreeting()
// uses instant on-device TTS for the conversation-mode greeting.
import * as Speech from 'expo-speech';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { loadVoiceConfig } from './voice-config-store';
import { ATLAS_VOICE } from '../gateway';
import { synthesizeToFile } from './elevenlabs';

let configured = false;
async function ensureAudioMode() {
  // Re-arm EVERY playback: iOS keeps the speech-recognition audio session
  // (playAndRecord category) alive after recognition stops, which silently
  // mutes or blocks TTS playback. Resetting the mode each time forces the
  // session back to a plain playback category so the clone is audible.
  try {
    await setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: false,
      allowsRecording: false,
      interruptionMode: 'doNotMix',
      interruptionModeAndroid: 'doNotMix',
    });
    configured = true;
  } catch (e) {
    console.warn('setAudioModeAsync failed (native audio may be broken):', e);
  }
}

let currentPlayer: AudioPlayer | null = null;
let generation = 0; // cancels stale chunk queues when a new reply starts

function stopPlayback() {
  generation++;
  try { currentPlayer?.pause(); currentPlayer?.release(); } catch { /* ignore */ }
  currentPlayer = null;
  Speech.stop();
}

/** Play an ElevenLabs mp3 and resolve when playback finishes (or fails).
 *  Fully guarded — if expo-audio's native module crashes (like the Animated
 *  driver did in this EAS local build), we catch it and fall through to
 *  expo-speech instead of killing the app. */
async function playMp3(uri: string, onDone: () => void): Promise<void> {
  return new Promise((resolve) => {
    try {
      // Try to create the audio player — this is where native crashes happen
      let player: AudioPlayer;
      try {
        currentPlayer?.release();
      } catch { /* ignore */ }
      try {
        player = createAudioPlayer({ uri });
      } catch (e) {
        // Native module crash — skip audio playback entirely
        console.warn('expo-audio createAudioPlayer failed:', e);
        onDone();
        resolve();
        return;
      }
      currentPlayer = player;
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        try { player.release(); } catch { /* ignore */ }
        if (currentPlayer === player) currentPlayer = null;
        onDone();
        resolve();
      };
      const timer = setTimeout(finish, 30_000); // hard cap 30s
      // Guard addListener — may crash if native event system is broken
      try {
        player.addListener('playbackStatusUpdate', (status: { didJustFinish?: boolean }) => {
          if (status?.didJustFinish) {
            clearTimeout(timer);
            finish();
          }
        });
      } catch { /* native event system broken — rely on timer + poll */ }
      // Fallback: poll currentTime vs duration
      const poll = setInterval(() => {
        try {
          const p = player as unknown as { duration?: number; currentTime?: number };
          const dur = p.duration ?? 0;
          const cur = p.currentTime ?? 0;
          if (dur > 0 && cur > 0 && cur >= dur - 0.05) {
            clearInterval(poll);
            clearTimeout(timer);
            finish();
          }
          if (settled) clearInterval(poll);
        } catch {
          clearInterval(poll);
          clearTimeout(timer);
          finish();
        }
      }, 500);
      // Guard play() — may crash natively
      try {
        player.play();
      } catch (e) {
        console.warn('expo-audio play() failed:', e);
        clearInterval(poll);
        clearTimeout(timer);
        finish();
      }
    } catch {
      onDone();
      resolve();
    }
  });
}

/** One-shot: speak a complete reply. */
export async function speakReply(text: string, onDone: () => void): Promise<void> {
  stopPlayback();
  const gen = generation;
  const stored = await loadVoiceConfig();
  const cfg = stored ?? { apiKey: ATLAS_VOICE.apiKey, voiceId: ATLAS_VOICE.voiceId };
  if (cfg?.apiKey && cfg?.voiceId) {
    try {
      await ensureAudioMode();
      const uri = await synthesizeToFile(text, cfg);
      if (uri) {
        if (gen !== generation) return; // superseded
        await playMp3(uri, onDone);
        return;
      }
    } catch { /* fall through to expo-speech */ }
  }
  try {
    Speech.speak(text, {
      language: 'en-US',
      rate: 0.96,
      pitch: 0.93,
      onDone,
      onStopped: onDone,
      onError: onDone,
    });
  } catch (e) {
    console.warn('Speech.speak failed:', e);
    onDone();
  }
}

/**
 * Streaming speech: accumulate the full reply text as it streams in, then
 * synthesize the COMPLETE reply in a single ElevenLabs call when finish()
 * fires. Previously each sentence chunk triggered its own API call (N
 * sequential network round-trips), making replies painfully slow. One call
 * for the whole reply is faster overall and lets the voice clone produce
 * natural prosody across sentence boundaries.
 */
export function createStreamingSpeaker() {
  let myGeneration = -1;
  let fullText = '';
  let onAllDone: (() => void) | null = null;

  const resolveDone = () => {
    if (onAllDone) {
      const cb = onAllDone;
      onAllDone = null;
      cb();
    }
  };

  /** Synthesize + play the entire reply in one shot. */
  const playAll = async () => {
    if (generation !== myGeneration) { resolveDone(); return; }
    const text = fullText.trim();
    if (!text) { resolveDone(); return; }

    const stored = await loadVoiceConfig();
    const cfg = stored ?? { apiKey: ATLAS_VOICE.apiKey, voiceId: ATLAS_VOICE.voiceId };
    if (cfg?.apiKey && cfg?.voiceId) {
      try {
        await ensureAudioMode();
        const uri = await synthesizeToFile(text, cfg);
        if (uri) {
          if (generation !== myGeneration) { resolveDone(); return; }
          await playMp3(uri, () => {});
          resolveDone();
          return;
        }
      } catch { /* fall through to expo-speech */ }
    }
    // expo-speech fallback for the whole reply (single call)
    await new Promise<void>((resolve) => {
      try {
        Speech.speak(text, {
          language: 'en-US',
          rate: 0.96,
          pitch: 0.93,
          onDone: () => resolve(),
          onStopped: () => resolve(),
          onError: () => resolve(),
        });
      } catch (e) {
        console.warn('Speech.speak (full reply) failed:', e);
        resolve();
      }
    });
    resolveDone();
  };

  return {
    start() {
      myGeneration = ++generation;
      fullText = '';
      onAllDone = null;
    },
    /** Track the full accumulated reply text; no synthesis during streaming. */
    push(accumulated: string) {
      if (generation !== myGeneration) return;
      fullText = accumulated;
    },
    /** Synthesize the complete reply in one call and resolve when done. */
    finish(accumulated: string, onDone: () => void) {
      if (generation !== myGeneration) { onDone(); return; }
      fullText = accumulated;
      onAllDone = onDone;
      void playAll();
    },
    cancel() {
      stopPlayback();
    },
  };
}

/** Instant on-device greeting — bypasses ElevenLabs entirely so the
 *  greeting starts immediately and finishes reliably. This arms the
 *  auto-listen loop without waiting for a network TTS round-trip. */
export function speakGreeting(text: string, onDone: () => void): void {
  stopPlayback();
  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    onDone();
  };
  // Hard cap — onDone is not always called on iOS (expo-speech quirk).
  const timer = setTimeout(finish, 15_000);
  try {
    Speech.speak(text, {
      language: 'en-US',
      rate: 0.96,
      pitch: 0.93,
      onDone: () => { clearTimeout(timer); finish(); },
      onStopped: () => { clearTimeout(timer); finish(); },
      onError: () => { clearTimeout(timer); finish(); },
    });
  } catch (e) {
    console.warn('Speech.speak (greeting) failed:', e);
    clearTimeout(timer);
    finish();
  }
}


// ============================================================================
// VOICE DIAGNOSTICS — used by Settings → Test voice. Returns step-by-step
// results so device-side voice failures are visible instead of silent.
// ============================================================================
export type VoiceDiagStep = { step: string; ok: boolean; detail?: string };

export async function runVoiceDiagnostics(): Promise<VoiceDiagStep[]> {
  const results: VoiceDiagStep[] = [];
  const log = (step: string, ok: boolean, detail?: string) => {
    results.push({ step, ok, detail });
  };

  // 1. Config present?
  const stored = await loadVoiceConfig();
  const cfg = stored ?? { apiKey: ATLAS_VOICE.apiKey, voiceId: ATLAS_VOICE.voiceId };
  log('config', Boolean(cfg?.apiKey && cfg?.voiceId), cfg?.apiKey ? 'key present' : 'no API key');

  // 2. ElevenLabs reachable?
  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/user`, {
      headers: { 'xi-api-key': cfg.apiKey },
    });
    log('elevenlabs-auth', res.ok, `HTTP ${res.status}`);
  } catch (e) {
    log('elevenlabs-auth', false, e instanceof Error ? e.message : String(e));
  }

  // 3. Synthesis?
  let uri: string | null = null;
  try {
    uri = await synthesizeToFile('Voice test. This is the Major Atlas clone.', cfg);
    log('synthesize', Boolean(uri), uri ? 'audio file written' : 'synthesize returned null');
  } catch (e) {
    log('synthesize', false, e instanceof Error ? e.message : String(e));
  }

  // 4. Playback?
  if (uri) {
    try {
      await playMp3(uri, () => {});
      log('playback', true, 'played to completion');
    } catch (e) {
      log('playback', false, e instanceof Error ? e.message : String(e));
    }
  }

  return results;
}
