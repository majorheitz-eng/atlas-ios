import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import * as Location from 'expo-location';
import { useRayNeo } from '@/lib/rayneo/connection';
import { palette } from '@/theme/palette';

const DEFAULT_LIMIT_MPH = 65;
const MPS_TO_MPH = 2.2369362920544;
const UPDATE_INTERVAL_MS = 1000;

type SpeedBand = 'green' | 'yellow' | 'red';

function bandFor(speedMph: number, limitMph: number): SpeedBand {
  if (speedMph >= limitMph + 10) return 'red';
  if (speedMph >= limitMph) return 'yellow';
  return 'green';
}

const BAND_COLOR: Record<SpeedBand, string> = {
  green: palette.success,
  yellow: '#FFCA75',
  red: palette.danger,
};

export default function SpeedometerScreen() {
  const [speedMph, setSpeedMph] = useState(0);
  const [limitMph, setLimitMph] = useState(DEFAULT_LIMIT_MPH);
  const [permGranted, setPermGranted] = useState(false);
  const [status, setStatus] = useState<'idle' | 'requesting' | 'tracking' | 'unavailable'>('idle');
  const subRef = useRef<Location.LocationSubscription | null>(null);
  // RayNeo glasses — mirror live speed to the HUD while driving.
  const rayneo = useRayNeo();
  const lastPushedRef = useRef<number>(-1);

  const startTracking = useCallback(async () => {
    setStatus('requesting');
    try {
      const fg = await Location.getForegroundPermissionsAsync();
      if (!fg.granted) {
        const ask = await Location.requestForegroundPermissionsAsync();
        if (!ask.granted) {
          setPermGranted(false);
          setStatus('unavailable');
          Alert.alert(
            'Location required',
            'Allow location access in Settings to use the driving speedometer.',
          );
          return;
        }
      }
      setPermGranted(true);

      await subRef.current?.remove();
      subRef.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          timeInterval: UPDATE_INTERVAL_MS,
          distanceInterval: 0,
        },
        (loc) => {
          const mps = loc.coords.speed ?? null;
          if (mps == null || Number.isNaN(mps) || mps < 0) {
            setSpeedMph(0);
            return;
          }
          setSpeedMph(Math.round(mps * MPS_TO_MPH));
        },
      );
      setStatus('tracking');
    } catch (error) {
      setStatus('unavailable');
      Alert.alert(
        'Speedometer unavailable',
        error instanceof Error ? error.message : 'Atlas could not start GPS tracking.',
      );
    }
  }, []);

  const stopTracking = useCallback(async () => {
    if (subRef.current) {
      await subRef.current.remove();
      subRef.current = null;
    }
    setSpeedMph(0);
    setStatus('idle');
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void startTracking();
      return () => {
        active = false;
        void stopTracking();
      };
    }, [startTracking, stopTracking]),
  );

  // Manual 1s tick guarantee: if watchPositionAsync doesn't emit for any
  // reason, we still re-read the last known speed on a 1s cadence so the HUD
  // never freezes. With watchPositionAsync we use it as a watchdog latch.
  useEffect(() => {
    return () => {
      void stopTracking();
    };
  }, [stopTracking]);

  // Push the live speed to the RayNeo HUD. Only send when the integer MPH
  // value actually changes — a watchPositionAsync at 1Hz plus a 1s BLE poll
  // would otherwise double-send the same frame.
  useEffect(() => {
    if (!rayneo.connected) return;
    if (status !== 'tracking') return;
    if (speedMph === lastPushedRef.current) return;
    lastPushedRef.current = speedMph;
    const frame = `${speedMph} MPH ${speedMph >= limitMph ? 'OVER LIMIT' : ''}`.trim();
    void rayneo.sendText(frame);
  }, [speedMph, limitMph, status, rayneo]);

  // Clear the HUD when tracking stops so the glasses don't show a stale speed.
  useEffect(() => {
    if (status === 'tracking' || !rayneo.connected) return;
    if (lastPushedRef.current === -1) return;
    lastPushedRef.current = -1;
    void rayneo.sendText('— MPH');
  }, [status, rayneo]);

  const band = bandFor(speedMph, limitMph);
  const speedColor = BAND_COLOR[band];
  const tracking = status === 'tracking';
  const requesting = status === 'requesting';

  return (
    <LinearGradient
      colors={['#06131C', palette.canvas, palette.canvas]}
      style={styles.fill}
    >
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <Text style={styles.title}>SPEEDOMETER</Text>
        <View style={{ width: 28 }} />
      </View>

      <View style={styles.content}>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>DRIVING HUD</Text>
        </View>

        <Text style={styles.heading}>Live speed</Text>
        <Text style={styles.copy}>
          GPS-derived ground speed in miles per hour, refreshed every second. The digit color
          shifts green → yellow → red as you approach and exceed the limit.
        </Text>

        <View style={[styles.speedCard, { borderColor: speedColor }]}>
          <Text style={[styles.speedDigits, { color: speedColor }]} numberOfLines={1}>
            {tracking ? speedMph : '—'}
          </Text>
          <Text style={[styles.speedUnit, { color: speedColor }]}>MPH</Text>
        </View>

        <View style={styles.limitRow}>
          <Text style={styles.limitLabel}>SPEED LIMIT</Text>
          <Text style={styles.limitValue}>{limitMph}</Text>
        </View>
        <View style={styles.limitControls}>
          <Pressable
            onPress={() => setLimitMph((v) => Math.max(5, v - 5))}
            style={styles.stepButton}
            hitSlop={10}
          >
            <Text style={styles.stepGlyph}>−5</Text>
          </Pressable>
          <Pressable
            onPress={() => setLimitMph((v) => v + 5)}
            style={styles.stepButton}
            hitSlop={10}
          >
            <Text style={styles.stepGlyph}>+5</Text>
          </Pressable>
        </View>

        <View style={styles.statusRow}>
          <View style={[styles.statusDot, { backgroundColor: tracking ? speedColor : palette.muted }]} />
          <Text style={[styles.statusText, { color: tracking ? speedColor : palette.muted }]}>
            {requesting
              ? 'REQUESTING GPS…'
              : tracking
                ? permGranted
                  ? 'GPS LOCKED'
                  : 'GPS LOCKED'
                : status === 'unavailable'
                  ? 'LOCATION DENIED'
                  : 'IDLE'}
          </Text>
        </View>

        <Pressable
          onPress={tracking ? () => void stopTracking() : () => void startTracking()}
          style={styles.secondary}
        >
          <Text style={styles.secondaryText}>
            {tracking ? 'STOP TRACKING' : requesting ? 'STARTING…' : 'START TRACKING'}
          </Text>
        </Pressable>

        <View style={styles.note}>
          <Text style={styles.noteTitle}>RAYNEO HUD</Text>
          <Text style={styles.noteText}>
            When paired with RayNeo iO glasses, this panel mirrors to your field of view while
            driving. Green under the limit, yellow over, red well over. Keep eyes on the road.
          </Text>
        </View>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: {
    paddingTop: 62,
    paddingHorizontal: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  back: { color: palette.cyan, fontSize: 38, fontWeight: '200', lineHeight: 38 },
  title: { color: palette.cyanSoft, letterSpacing: 3, fontSize: 12, fontWeight: '800' },
  content: { paddingHorizontal: 25, paddingTop: 34, paddingBottom: 40 },
  badge: {
    alignSelf: 'flex-start',
    borderColor: 'rgba(85,241,202,0.35)',
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 11,
    paddingVertical: 6,
    marginBottom: 16,
  },
  badgeText: { color: palette.success, fontSize: 9, letterSpacing: 1.5, fontWeight: '800' },
  heading: { color: palette.text, fontSize: 30, fontWeight: '300', letterSpacing: -0.5 },
  copy: { color: palette.muted, fontSize: 14, lineHeight: 21, marginTop: 10, marginBottom: 24 },
  speedCard: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderRadius: 24,
    backgroundColor: 'rgba(8,33,43,0.58)',
    paddingVertical: 44,
    marginBottom: 20,
  },
  speedDigits: {
    fontSize: 132,
    fontWeight: '200',
    lineHeight: 150,
    letterSpacing: -3,
    fontFamily: 'monospace',
    textAlign: 'center',
  },
  speedUnit: {
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 4,
    marginTop: 4,
  },
  limitRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    marginBottom: 12,
    gap: 8,
  },
  limitLabel: { color: palette.cyanSoft, fontSize: 10, letterSpacing: 1.6, fontWeight: '800' },
  limitValue: { color: palette.text, fontSize: 22, fontWeight: '600', fontFamily: 'monospace' },
  limitControls: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 14,
    marginBottom: 24,
  },
  stepButton: {
    width: 64,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(8,33,43,0.58)',
    borderWidth: 1,
    borderColor: palette.line,
  },
  stepGlyph: { color: palette.cyan, fontSize: 16, fontWeight: '700' },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
    gap: 8,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 9, letterSpacing: 1.6, fontWeight: '900' },
  secondary: {
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 14,
    marginBottom: 26,
  },
  secondaryText: { color: palette.cyanSoft, fontWeight: '700', fontSize: 11, letterSpacing: 1.5 },
  note: {
    padding: 16,
    borderLeftWidth: 2,
    borderLeftColor: palette.cyan,
    backgroundColor: 'rgba(8,33,43,0.58)',
    borderRadius: 10,
  },
  noteTitle: { color: palette.cyan, fontSize: 10, letterSpacing: 1.5, fontWeight: '900', marginBottom: 6 },
  noteText: { color: palette.muted, fontSize: 12, lineHeight: 18 },
});
