import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Slider from '@react-native-community/slider';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  getDoc,
  loadPosition,
  savePosition,
  type ReadingDoc,
} from '@/lib/reading/store';
import { palette } from '@/theme/palette';

const WPM_MIN = 100;
const WPM_MAX = 700;
const SPEED_SWIPE_STEP = 25;

export default function ReadingViewScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [doc, setDoc] = useState<ReadingDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [wpm, setWpm] = useState(220);
  const [lineIndex, setLineIndex] = useState(0);

  const scrollRef = useRef<ScrollView>(null);
  const lineTopsRef = useRef<number[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lineIndexRef = useRef(0);
  const wpmRef = useRef(220);
  const playingRef = useRef(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (!id) {
        setLoading(false);
        return () => undefined;
      }
      void (async () => {
        const [loadedDoc, position] = await Promise.all([getDoc(id), loadPosition(id)]);
        if (!active) return;
        setDoc(loadedDoc);
        setWpm(position.wpm);
        setLineIndex(position.scrollIndex);
        lineIndexRef.current = position.scrollIndex;
        wpmRef.current = position.wpm;
        setLoading(false);
      })();
      return () => {
        active = false;
      };
    }, [id]),
  );

  // Split text into teleprompter lines (~9 words per line reads well at speed).
  const lines = useMemo(() => {
    if (!doc) return [] as string[];
    const words = doc.text.trim().split(/\s+/);
    const perLine = 9;
    const out: string[] = [];
    for (let i = 0; i < words.length; i += perLine) {
      out.push(words.slice(i, i + perLine).join(' '));
    }
    return out.length ? out : [''];
  }, [doc]);

  const persist = useCallback(
    (scrollIndex: number, currentWpm: number) => {
      if (!id) return;
      void savePosition(id, { scrollIndex, wpm: currentWpm });
    },
    [id],
  );

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const pause = useCallback(() => {
    playingRef.current = false;
    setPlaying(false);
    stopTimer();
    persist(lineIndexRef.current, wpmRef.current);
  }, [persist, stopTimer]);

  const play = useCallback(() => {
    if (playingRef.current || lines.length === 0) return;
    playingRef.current = true;
    setPlaying(true);
    const msPerLine = 60_000 / wpmRef.current;
    stopTimer();
    timerRef.current = setInterval(() => {
      if (lineIndexRef.current < lines.length - 1) {
        lineIndexRef.current += 1;
        setLineIndex(lineIndexRef.current);
        scrollRef.current?.scrollTo({ y: lineTopsRef.current[lineIndexRef.current] ?? 0, animated: true });
      } else {
        playingRef.current = false;
        setPlaying(false);
        stopTimer();
        persist(lineIndexRef.current, wpmRef.current);
      }
    }, msPerLine);
  }, [lines.length, persist, stopTimer]);

  // Restart the interval whenever WPM changes while playing.
  useEffect(() => {
    if (!playing) return;
    const msPerLine = 60_000 / wpmRef.current;
    stopTimer();
    timerRef.current = setInterval(() => {
      if (lineIndexRef.current < lines.length - 1) {
        lineIndexRef.current += 1;
        setLineIndex(lineIndexRef.current);
        scrollRef.current?.scrollTo({ y: lineTopsRef.current[lineIndexRef.current] ?? 0, animated: true });
      } else {
        playingRef.current = false;
        setPlaying(false);
        stopTimer();
        persist(lineIndexRef.current, wpmRef.current);
      }
    }, msPerLine);
    return stopTimer;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, wpm]);

  // Persist position when leaving the screen.
  useFocusEffect(
    useCallback(() => () => {
      if (timerRef.current) clearInterval(timerRef.current);
      playingRef.current = false;
      if (id) persist(lineIndexRef.current, wpmRef.current);
    }, [id, persist]),
  );

  const applyWpm = useCallback(
    (next: number) => {
      const clamped = Math.min(WPM_MAX, Math.max(WPM_MIN, Math.round(next)));
      wpmRef.current = clamped;
      setWpm(clamped);
      if (id) persist(lineIndexRef.current, clamped);
    },
    [id, persist],
  );

  const adjustSpeed = useCallback(
    (delta: number) => {
      applyWpm(wpmRef.current + delta);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
    [applyWpm],
  );

  const onLineLayout = useCallback((index: number) => (event: { nativeEvent: { layout: { y: number } } }) => {
    lineTopsRef.current[index] = event.nativeEvent.layout.y;
  }, []);

  if (loading) {
    return (
      <LinearGradient colors={['#06131C', palette.canvas]} style={[styles.fill, styles.center]}>
        <ActivityIndicator color={palette.cyan} size="large" />
      </LinearGradient>
    );
  }

  if (!doc) {
    return (
      <LinearGradient colors={['#06131C', palette.canvas]} style={[styles.fill, styles.center]}>
        <Text style={styles.missingTitle}>Document not found</Text>
        <Pressable onPress={() => router.back()} style={styles.missingButton}>
          <Text style={styles.missingButtonText}>Back to library</Text>
        </Pressable>
      </LinearGradient>
    );
  }

  const progress = lines.length > 1 ? lineIndex / (lines.length - 1) : 0;

  return (
    <LinearGradient colors={['#020609', palette.canvas, '#06131C']} style={styles.fill}>
      <View style={styles.header}>
        <Pressable
          onPress={() => {
            pause();
            router.back();
          }}
          hitSlop={12}
        >
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {doc.title}
        </Text>
        <View style={{ width: 30 }} />
      </View>

      {/* Teleprompter: tap anywhere to pause/play, swipe up/down adjusts speed. */}
      <ScrollView
        ref={scrollRef}
        style={styles.reader}
        contentContainerStyle={styles.readerContent}
        onResponderRelease={() => undefined}
        onStartShouldSetResponder={() => true}
        showsVerticalScrollIndicator={false}
      >
        {lines.map((line, index) => (
          <Text
            key={index}
            onLayout={onLineLayout(index)}
            style={[styles.line, index === lineIndex && styles.lineActive, index < lineIndex && styles.linePast]}
          >
            {line}
          </Text>
        ))}
        <View style={{ height: 140 }} />
      </ScrollView>

      {/* Tap / speed controls over the reading surface. */}
      <View style={styles.touchLayer} pointerEvents="box-none">
        <Pressable
          accessibilityLabel={playing ? 'Pause reading' : 'Start reading'}
          onPress={() => (playing ? pause() : play())}
          style={styles.tapZone}
          hitSlop={0}
        >
          <Text style={styles.tapGlyph}>{playing ? '❚❚' : '▶'}</Text>
        </Pressable>
        <Pressable
          accessibilityLabel="Faster (swipe up)"
          onPress={() => adjustSpeed(SPEED_SWIPE_STEP)}
          style={[styles.swipeZone, styles.swipeUp]}
        >
          <Text style={styles.swipeGlyph}>▲</Text>
        </Pressable>
        <Pressable
          accessibilityLabel="Slower (swipe down)"
          onPress={() => adjustSpeed(-SPEED_SWIPE_STEP)}
          style={[styles.swipeZone, styles.swipeDown]}
        >
          <Text style={styles.swipeGlyph}>▼</Text>
        </Pressable>
      </View>

      <View style={styles.controls}>
        <View style={styles.progressRow}>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { flex: progress }]} />
            <View style={{ flex: 1 - progress }} />
          </View>
          <Text style={styles.progressText}>
            {lineIndex + 1}/{lines.length}
          </Text>
        </View>
        <View style={styles.sliderRow}>
          <Text style={styles.sliderLabel}>SLOWER</Text>
          <Slider
            style={styles.slider}
            minimumValue={WPM_MIN}
            maximumValue={WPM_MAX}
            step={5}
            value={wpm}
            onValueChange={applyWpm}
            minimumTrackTintColor={palette.cyan}
            maximumTrackTintColor={palette.line}
            thumbTintColor={palette.cyan}
            accessibilityLabel="Reading speed in words per minute"
          />
          <Text style={styles.sliderLabel}>FASTER</Text>
          <Text style={styles.wpmValue}>{wpm} WPM</Text>
        </View>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
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
  reader: { flex: 1 },
  readerContent: { paddingHorizontal: 26, paddingTop: 12, paddingBottom: 40 },
  line: { color: '#4E6E7A', fontSize: 19, lineHeight: 30, fontWeight: '400', marginBottom: 8 },
  linePast: { color: '#39525C' },
  lineActive: { color: palette.text, fontWeight: '700' },
  touchLayer: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 },
  tapZone: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 190 },
  tapGlyph: {
    color: 'rgba(35,230,255,0.5)',
    fontSize: 17,
    fontWeight: '800',
    backgroundColor: 'rgba(3,8,13,0.6)',
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 8,
    overflow: 'hidden',
  },
  swipeZone: { position: 'absolute', right: 18, width: 40, height: 56, alignItems: 'center', justifyContent: 'center' },
  swipeUp: { top: '30%' },
  swipeDown: { bottom: '32%' },
  swipeGlyph: { color: 'rgba(138,245,255,0.55)', fontSize: 20, fontWeight: '700' },
  controls: {
    paddingHorizontal: 20,
    paddingBottom: 26,
    backgroundColor: 'rgba(3,8,13,0.88)',
    borderTopWidth: 1,
    borderTopColor: palette.line,
  },
  progressRow: { flexDirection: 'row', alignItems: 'center', marginTop: 14, gap: 10 },
  progressTrack: { flex: 1, height: 4, borderRadius: 2, backgroundColor: 'rgba(77,224,240,0.16)', flexDirection: 'row' },
  progressFill: { borderRadius: 2, backgroundColor: palette.cyan, minWidth: 0 },
  progressText: { color: palette.muted, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  sliderRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 8 },
  slider: { flex: 1, height: 40 },
  sliderLabel: { color: '#5E7D88', fontSize: 8, letterSpacing: 1.4, fontWeight: '900' },
  wpmValue: { color: palette.cyanSoft, fontSize: 11, fontWeight: '900', minWidth: 74, textAlign: 'right' },
  missingTitle: { color: palette.text, fontSize: 18, fontWeight: '400', marginBottom: 18 },
  missingButton: {
    borderColor: palette.cyan,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 22,
    paddingVertical: 12,
  },
  missingButtonText: { color: palette.cyan, fontSize: 12, fontWeight: '800', letterSpacing: 1.2 },
});
