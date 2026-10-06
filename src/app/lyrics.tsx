import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useRayNeo } from '@/lib/rayneo/connection';
import { palette } from '@/theme/palette';

/**
 * Atlas Lyrics HUD
 * ----------------
 * Synced-lyrics overlay that fetches LRC-format lyrics from lrclib.net
 * and auto-advances the highlighted line based on playback position.
 *
 * Now-playing detection: no iOS media API is available in the Expo SDK
 * bundle on this build, so the user enters the track title + artist.
 * The lrclib.net GET endpoint returns synced lyrics (LRC with
 * [mm:ss.xx] timestamps) which we parse into timed lines.
 *
 * Motion is driven entirely by useState + setInterval — the EAS local
 * build has a broken native animation module, so the Animated API and
 * useNativeDriver are forbidden here.
 */

type SyncedLine = {
  time: number; // seconds
  text: string;
};

type Status = 'idle' | 'loading' | 'ready' | 'error';

const LRCLIB_ENDPOINT = 'https://lrclib.net/api/get';

/** Parse LRC text into ordered, timestamped lines. */
function parseLrc(lrc: string): SyncedLine[] {
  const lines: SyncedLine[] = [];
  const tagRe = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
  for (const raw of lrc.split(/\r?\n/)) {
    let match: RegExpExecArray | null;
    const stamps: number[] = [];
    let lastIndex = 0;
    tagRe.lastIndex = 0;
    while ((match = tagRe.exec(raw)) !== null) {
      const min = parseInt(match[1], 10);
      const sec = parseInt(match[2], 10);
      const fracRaw = match[3] ?? '0';
      const frac = parseInt(fracRaw, 10) / Math.pow(10, fracRaw.length);
      stamps.push(min * 60 + sec + frac);
      lastIndex = tagRe.lastIndex;
    }
    if (stamps.length === 0) continue;
    const text = raw.slice(lastIndex).trim();
    for (const t of stamps) lines.push({ time: t, text });
  }
  lines.sort((a, b) => a.time - b.time);
  return lines;
}

/** Fetch synced lyrics from lrclib.net for a track. */
async function fetchSyncedLyrics(
  trackName: string,
  artistName: string,
): Promise<{ plain: string; synced: SyncedLine[]; duration?: number }> {
  const url = `${LRCLIB_ENDPOINT}?track_name=${encodeURIComponent(
    trackName,
  )}&artist_name=${encodeURIComponent(artistName)}`;
  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 404) throw new Error('No lyrics found for this track.');
    throw new Error(`lrclib returned ${res.status}`);
  }
  const data = await res.json();
  const syncedRaw = typeof data?.syncedLyrics === 'string' ? data.syncedLyrics : '';
  const plain = typeof data?.plainLyrics === 'string' ? data.plainLyrics : '';
  const duration = typeof data?.duration === 'number' ? data.duration : undefined;
  const synced = syncedRaw ? parseLrc(syncedRaw) : [];
  if (synced.length === 0 && !plain) {
    throw new Error('No lyrics returned for this track.');
  }
  return { plain, synced, duration };
}

/** Track the active line index from a playback position (seconds). */
function activeIndexFor(lines: SyncedLine[], position: number): number {
  if (lines.length === 0) return -1;
  let lo = 0;
  let hi = lines.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].time <= position) {
      idx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return idx;
}

export default function LyricsHudScreen() {
  const [track, setTrack] = useState('');
  const [artist, setArtist] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [synced, setSynced] = useState<SyncedLine[]>([]);
  const [plain, setPlain] = useState('');
  const [duration, setDuration] = useState<number | undefined>(undefined);

  // Playback simulation: position advances in real time from a base timestamp.
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const positionRef = useRef(0);
  const playingRef = useRef(false);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Manual offset (seconds) for hand-tuning sync.
  const [offset, setOffset] = useState(0);
  const offsetRef = useRef(0);

  const [activeIndex, setActiveIndex] = useState(-1);
  const scrollRef = useRef<ScrollView>(null);
  const lineTopsRef = useRef<number[]>([]);
  // RayNeo glasses — push the active lyric line as teleprompter text.
  const rayneo = useRayNeo();

  const stopTick = useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  // Advance the simulated playback clock 4× per second.
  const startTick = useCallback(() => {
    stopTick();
    tickRef.current = setInterval(() => {
      if (!playingRef.current) return;
      const next = positionRef.current + 0.25;
      positionRef.current = next;
      setPosition(next);
    }, 250);
  }, [stopTick]);

  useEffect(() => () => stopTick(), [stopTick]);

  const loadLyrics = useCallback(async () => {
    const t = track.trim();
    const a = artist.trim();
    if (!t) {
      Alert.alert('Track required', 'Enter a song title to fetch synced lyrics.');
      return;
    }
    setStatus('loading');
    setError(null);
    setPlaying(false);
    playingRef.current = false;
    stopTick();
    setPosition(0);
    positionRef.current = 0;
    setActiveIndex(-1);
    try {
      const result = await fetchSyncedLyrics(t, a);
      setSynced(result.synced);
      setPlain(result.plain);
      setDuration(result.duration);
      setStatus('ready');
      // Auto-start playback at the first synced line if we have timestamps.
      if (result.synced.length > 0) {
        const start = result.synced[0].time;
        positionRef.current = start;
        setPosition(start);
        playingRef.current = true;
        setPlaying(true);
        startTick();
      }
    } catch (e) {
      setStatus('error');
      setError(e instanceof Error ? e.message : 'Could not fetch lyrics.');
    }
  }, [artist, track, startTick, stopTick]);

  // Recompute the active line whenever position or offset changes.
  useEffect(() => {
    if (synced.length === 0) {
      setActiveIndex(-1);
      return;
    }
    const adj = position + offsetRef.current;
    const idx = activeIndexFor(synced, adj);
    setActiveIndex((prev) => {
      if (idx !== prev && idx >= 0) {
        scrollRef.current?.scrollTo({
          y: lineTopsRef.current[idx] ?? 0,
          animated: false,
        });
      }
      return idx;
    });
  }, [position, synced]);

  // Push the active lyric line to the RayNeo HUD as teleprompter text.
  useEffect(() => {
    if (activeIndex < 0 || synced.length === 0) return;
    const line = synced[activeIndex]?.text ?? '';
    if (line) void rayneo.sendTeleprompterText(line);
  }, [activeIndex, synced, rayneo]);

  const togglePlay = useCallback(() => {
    if (playingRef.current) {
      playingRef.current = false;
      setPlaying(false);
      return;
    }
    playingRef.current = true;
    setPlaying(true);
    startTick();
  }, [synced.length, startTick]);

  const restart = useCallback(() => {
    if (synced.length === 0) return;
    const start = synced[0].time;
    positionRef.current = start;
    setPosition(start);
    if (!playingRef.current) {
      playingRef.current = true;
      setPlaying(true);
      startTick();
    }
  }, [synced, startTick]);

  const bumpOffset = useCallback((delta: number) => {
    offsetRef.current = Math.max(-30, Math.min(30, offsetRef.current + delta));
    setOffset(offsetRef.current);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const onLineLayout = useCallback(
    (index: number) => (event: { nativeEvent: { layout: { y: number } } }) => {
      lineTopsRef.current[index] = event.nativeEvent.layout.y;
    },
    [],
  );

  const totalDuration = useMemo(() => {
    if (duration && duration > 0) return duration;
    if (synced.length > 0) return synced[synced.length - 1].time + 10;
    return 0;
  }, [duration, synced]);

  const progress = totalDuration > 0 ? Math.min(1, position / totalDuration) : 0;

  const fmtTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const headerTitle = useMemo(() => {
    if (status !== 'ready') return 'LYRICS HUD';
    const t = track.trim();
    const a = artist.trim();
    return a ? `${t} — ${a}` : t;
  }, [status, track, artist]);

  return (
    <LinearGradient colors={['#06131C', palette.canvas, '#020609']} style={styles.fill}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {headerTitle}
        </Text>
        <View style={{ width: 30 }} />
      </View>

      {status !== 'ready' && (
        <View style={styles.searchPanel}>
          <Text style={styles.panelLabel}>NOW-PLAYING DETECTION</Text>
          <Text style={styles.panelHint}>
            No iOS media session is exposed in this build — enter the track playing
            on your device and Atlas fetches synced lyrics from lrclib.net.
          </Text>
          <TextInput
            value={track}
            onChangeText={setTrack}
            placeholder="Song title"
            placeholderTextColor="#49636D"
            style={styles.input}
            returnKeyType="next"
          />
          <TextInput
            value={artist}
            onChangeText={setArtist}
            placeholder="Artist (optional)"
            placeholderTextColor="#49636D"
            style={styles.input}
            returnKeyType="search"
            onSubmitEditing={() => void loadLyrics()}
          />
          <Pressable
            disabled={status === 'loading' || !track.trim()}
            onPress={() => void loadLyrics()}
            style={[styles.loadButton, (!track.trim() || status === 'loading') && styles.loadButtonDisabled]}
          >
            {status === 'loading' ? (
              <ActivityIndicator color="#02202A" size="small" />
            ) : (
              <Text style={styles.loadGlyph}>FETCH LYRICS</Text>
            )}
          </Pressable>
          {status === 'error' && error && (
            <Text style={styles.errorText}>{error}</Text>
          )}
        </View>
      )}

      {status === 'ready' && (
        <>
          <ScrollView
            ref={scrollRef}
            style={styles.lyrics}
            contentContainerStyle={styles.lyricsContent}
            showsVerticalScrollIndicator={false}
          >
            {synced.length > 0 ? (
              synced.map((line, index) => {
                const isActive = index === activeIndex;
                const isPast = index < activeIndex;
                return (
                  <Text
                    key={`${line.time}-${index}`}
                    onLayout={onLineLayout(index)}
                    style={[
                      styles.line,
                      isActive && styles.lineActive,
                      isPast && styles.linePast,
                      !isActive && !isPast && styles.lineUpcoming,
                    ]}
                  >
                    {line.text || '♪'}
                  </Text>
                );
              })
            ) : (
              plain.split(/\n/).map((l, i) => (
                <Text key={i} style={styles.line}>
                  {l || ' '}
                </Text>
              ))
            )}
            <View style={{ height: 160 }} />
          </ScrollView>

          <View style={styles.controls}>
            <View style={styles.progressRow}>
              <Text style={styles.timeText}>{fmtTime(position)}</Text>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { flex: progress }]} />
                <View style={{ flex: 1 - progress }} />
              </View>
              <Text style={styles.timeText}>{fmtTime(totalDuration)}</Text>
            </View>
            <View style={styles.buttonRow}>
              <Pressable onPress={restart} style={styles.iconButton} accessibilityLabel="Restart track">
                <Text style={styles.iconGlyph}>⏮</Text>
              </Pressable>
              <Pressable onPress={togglePlay} style={styles.playButton} accessibilityLabel={playing ? 'Pause' : 'Play'}>
                <Text style={styles.playGlyph}>{playing ? '❚❚' : '▶'}</Text>
              </Pressable>
              <Pressable
                onPress={() => bumpOffset(-1)}
                style={styles.iconButton}
                accessibilityLabel="Sync earlier by 1s"
              >
                <Text style={styles.iconGlyph}>−1s</Text>
              </Pressable>
              <Pressable
                onPress={() => bumpOffset(1)}
                style={styles.iconButton}
                accessibilityLabel="Sync later by 1s"
              >
                <Text style={styles.iconGlyph}>+1s</Text>
              </Pressable>
            </View>
            {offset !== 0 && (
              <Text style={styles.offsetText}>
                SYNC OFFSET {offset > 0 ? '+' : ''}{offset}s
              </Text>
            )}
          </View>
        </>
      )}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: {
    paddingTop: 58,
    paddingHorizontal: 22,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  back: { color: palette.cyan, fontSize: 38, fontWeight: '200', lineHeight: 38 },
  title: { color: palette.cyanSoft, letterSpacing: 1.5, fontSize: 12, fontWeight: '800', flex: 1, textAlign: 'center' },
  searchPanel: { paddingHorizontal: 22, paddingTop: 12 },
  panelLabel: { color: palette.cyan, fontSize: 9, letterSpacing: 1.4, fontWeight: '900', marginBottom: 6 },
  panelHint: { color: '#5E7D88', fontSize: 11, lineHeight: 16, marginBottom: 16 },
  input: {
    backgroundColor: 'rgba(8,31,42,0.9)',
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 13,
    color: palette.text,
    fontSize: 14,
    paddingHorizontal: 14,
    paddingVertical: 13,
    marginBottom: 10,
  },
  loadButton: {
    backgroundColor: palette.cyan,
    borderRadius: 13,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadButtonDisabled: { opacity: 0.4 },
  loadGlyph: { color: '#02202A', fontSize: 12, fontWeight: '900', letterSpacing: 1.4 },
  errorText: { color: palette.danger, fontSize: 12, marginTop: 12, textAlign: 'center' },
  lyrics: { flex: 1 },
  lyricsContent: { paddingHorizontal: 26, paddingTop: 12, paddingBottom: 40 },
  line: {
    color: '#4E6E7A',
    fontSize: 20,
    lineHeight: 32,
    fontWeight: '400',
    marginBottom: 8,
    textAlign: 'center',
  },
  linePast: { color: '#39525C' },
  lineActive: { color: palette.cyan, fontWeight: '700', fontSize: 22 },
  lineUpcoming: { color: '#3D5A66' },
  controls: {
    paddingHorizontal: 20,
    paddingBottom: 26,
    backgroundColor: 'rgba(3,8,13,0.88)',
    borderTopWidth: 1,
    borderTopColor: palette.line,
  },
  progressRow: { flexDirection: 'row', alignItems: 'center', marginTop: 14, gap: 10 },
  timeText: { color: palette.muted, fontSize: 10, fontWeight: '800', letterSpacing: 0.6 },
  progressTrack: { flex: 1, height: 4, borderRadius: 2, backgroundColor: 'rgba(77,224,240,0.16)', flexDirection: 'row' },
  progressFill: { borderRadius: 2, backgroundColor: palette.cyan, minWidth: 0 },
  buttonRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 14, gap: 14 },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: palette.line,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(5,25,34,0.8)',
  },
  iconGlyph: { color: palette.cyanSoft, fontSize: 14, fontWeight: '800' },
  playButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: palette.cyan,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playGlyph: { color: '#02202A', fontSize: 22, fontWeight: '700', marginTop: -2 },
  offsetText: { color: palette.cyanSoft, fontSize: 9, letterSpacing: 1.4, fontWeight: '900', textAlign: 'center', marginTop: 10 },
});
