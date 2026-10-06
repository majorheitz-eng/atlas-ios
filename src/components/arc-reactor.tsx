import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

export type ReactorMode = 'idle' | 'listening' | 'thinking' | 'speaking';

// NO Animated API — all motion via useState + setInterval on JS thread.
// EAS cloud builds have a working native driver, but we keep this approach
// for consistency and to avoid any future local-build issues.

// Glass orb with internal particle waveform.
// Inspired by the user's reference: a luminous sphere with a glowing wave
// inside, rim lighting, bloom, and mood colors that shift per state.
// Each mode changes the color, wave amplitude, and animation speed to
// give Atlas personality — calm, electric, deep, warm.

const MOOD = {
  idle: {
    wave: '#23E6FF', glow: '#1A8BCC', rim: '#23E6FF', hot: '#A0F0FF',
    particle: '#5FEFFF', aura: '#23E6FF',
    label: 'TAP TO SPEAK',
    speed: 0.015, amplitude: 0.10, breathRate: 0.008, particleCount: 80,
  },
  listening: {
    wave: '#23E6FF', glow: '#1A8BCC', rim: '#5FEFFF', hot: '#FFFFFF',
    particle: '#C9FBFF', aura: '#23E6FF',
    label: 'LISTENING',
    speed: 0.035, amplitude: 0.20, breathRate: 0.020, particleCount: 100,
  },
  thinking: {
    wave: '#B47CFF', glow: '#7B3FFF', rim: '#D4A5FF', hot: '#F0E0FF',
    particle: '#D4A5FF', aura: '#9966FF',
    label: 'PROCESSING',
    speed: 0.050, amplitude: 0.25, breathRate: 0.035, particleCount: 120,
  },
  speaking: {
    wave: '#64F5BD', glow: '#2DBF88', rim: '#A0FFD8', hot: '#E0FFE8',
    particle: '#A0FFD8', aura: '#4AE6A8',
    label: 'ATLAS ONLINE',
    speed: 0.030, amplitude: 0.18, breathRate: 0.015, particleCount: 90,
  },
} as const;

const ORB_SIZE = 280;
const CENTER = ORB_SIZE / 2;
const RING_RADIUS = 125;     // outer glass rim radius
const WAVE_RADIUS = 95;      // where the internal waveform lives
const RIM_THICKNESS = 3;

/**
 * Glass Orb Reactor — a luminous sphere with an internal particle waveform.
 * The orb has a glass-like rim with specular highlights, a deep dark interior,
 * and a flowing wave made of glowing particles inside. The wave undulates
 * organically, particles shimmer, and colors shift with Atlas's emotional
 * state. Bloom glow radiates outward like real light.
 */
export function ArcReactor({
  mode,
  onPress,
  level = 0,
}: {
  mode: ReactorMode;
  onPress: () => void;
  level?: number;
}) {
  const [, setTick] = useState(0);
  const phaseRef = useRef(0);
  const breathRef = useRef(0);
  const shimmerRef = useRef(0);
  const smoothLevelRef = useRef(0);
  const tickRef = useRef(0);

  const mood = MOOD[mode];

  useEffect(() => {
    let mounted = true;
    const interval = setInterval(() => {
      if (!mounted) return;
      phaseRef.current += mood.speed;
      breathRef.current += mood.breathRate;
      shimmerRef.current += 0.04;
      smoothLevelRef.current = smoothLevelRef.current * 0.82 + level * 0.18;
      tickRef.current++;
      setTick(tickRef.current);
    }, 50);
    return () => { mounted = false; clearInterval(interval); };
  }, [mode, level]);

  const breath = (Math.sin(breathRef.current) + 1) / 2; // 0..1
  const lvl = smoothLevelRef.current;
  const amp = WAVE_RADIUS * mood.amplitude * (0.6 + breath * 0.5 + lvl * 0.3);

  // Internal waveform particles — the heart of the orb.
  // Arranged along a horizontal sine wave across the center of the sphere,
  // with varying density (more particles at peaks/troughs = concentrated energy).
  const waveParticles: { x: number; y: number; size: number; opacity: number; color: string }[] = [];
  const numWave = mood.particleCount;
  for (let i = 0; i < numWave; i++) {
    const t = i / numWave;
    const xAngle = (t - 0.5) * Math.PI * 2.4; // spans most of the circle horizontally
    // Multi-frequency wave for organic feel
    const wave1 = Math.sin(xAngle * 3 + phaseRef.current * 2);
    const wave2 = Math.sin(xAngle * 5 + phaseRef.current * 1.3) * 0.3;
    const y = wave1 * amp + wave2 * amp * 0.5;
    const x = Math.sin(xAngle) * WAVE_RADIUS * 0.85;

    // Particle shimmer — each blinks independently
    const shimmer = (Math.sin(shimmerRef.current * 3 + i * 0.4) + 1) / 2;
    const heat = (Math.abs(wave1) + 1) / 2; // 0..1, hot at peaks

    // Size: bigger at peaks (concentrated energy), tiny at nodes
    const size = 1 + heat * 3 + shimmer * 1.5;
    // Opacity: bright at peaks, faint at valleys
    const opacity = 0.15 + heat * 0.65 + shimmer * 0.2;

    // Color: hot at peaks, mid-tone at mid, cool at valleys
    const color = heat > 0.66 ? mood.hot : heat > 0.33 ? mood.wave : mood.glow;

    waveParticles.push({ x, y, size, opacity, color });
  }

  // Glass rim — a ring of subtle dots that catch light, like specular highlights
  const rimHighlights: { x: number; y: number; opacity: number }[] = [];
  const numRim = 60;
  for (let i = 0; i < numRim; i++) {
    const angle = (i / numRim) * Math.PI * 2;
    const x = Math.cos(angle) * RING_RADIUS;
    const y = Math.sin(angle) * RING_RADIUS;
    // Specular highlights: bright at top-left and bottom-right (like light hitting glass)
    const lightAngle = Math.cos(angle - Math.PI * 1.25); // light from upper-left
    const opacity = Math.max(0, lightAngle) * 0.6 + 0.1;
    rimHighlights.push({ x, y, opacity });
  }

  // Slow orbiting particles inside the orb (depth)
  const orbitParticles: { x: number; y: number; size: number; opacity: number }[] = [];
  const numOrbit = 20;
  for (let i = 0; i < numOrbit; i++) {
    const angle = (i / numOrbit) * Math.PI * 2 + phaseRef.current * 0.5;
    const r = WAVE_RADIUS * (0.3 + 0.4 * Math.sin(phaseRef.current + i));
    const x = Math.cos(angle) * r;
    const y = Math.sin(angle) * r * 0.4; // flattened orbit for 3D feel
    const shimmer = (Math.sin(shimmerRef.current * 2 + i * 0.7) + 1) / 2;
    orbitParticles.push({ x, y, size: 1 + shimmer * 1.5, opacity: 0.1 + shimmer * 0.3 });
  }

  const glowOpacity = 0.12 + breath * 0.18;
  const glowScale = 1 + breath * 0.05;
  const rimOpacity = 0.3 + breath * 0.2;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={mood.label}
      onPress={onPress}
      style={styles.hitbox}
    >
      {/* External bloom — the light spilling out onto the black background */}
      <View
        style={[
          styles.bloom,
          {
            opacity: glowOpacity,
            transform: [{ scale: glowScale }],
            backgroundColor: mood.aura,
            shadowColor: mood.aura,
          },
        ]}
      />

      {/* Orb interior — deep dark sphere */}
      <View style={styles.orbInterior}>
        <LinearGradient
          colors={[`${mood.glow}08`, `${mood.glow}03`, '#000000']}
          style={styles.orbInteriorFill}
        />
      </View>

      {/* Orbiting depth particles — slow-moving stars inside the orb */}
      <View style={styles.layer}>
        {orbitParticles.map((p, i) => (
          <View
            key={`o${i}`}
            style={[
              styles.orbitParticle,
              {
                transform: [{ translateX: p.x }, { translateY: p.y }],
                width: p.size,
                height: p.size,
                borderRadius: p.size / 2,
                backgroundColor: mood.particle,
                opacity: p.opacity,
                shadowColor: mood.particle,
              },
            ]}
          />
        ))}
      </View>

      {/* Internal waveform — the living wave of light particles */}
      <View style={styles.layer}>
        {waveParticles.map((p, i) => (
          <View
            key={`w${i}`}
            style={[
              styles.waveParticle,
              {
                transform: [{ translateX: p.x }, { translateY: p.y }],
                width: p.size,
                height: p.size,
                borderRadius: p.size / 2,
                backgroundColor: p.color,
                opacity: p.opacity,
                shadowColor: p.color,
              },
            ]}
          />
        ))}
      </View>

      {/* Glass rim — the outer ring with specular highlights */}
      <View style={styles.layer}>
        {rimHighlights.map((h, i) => (
          <View
            key={`r${i}`}
            style={[
              styles.rimDot,
              {
                transform: [{ translateX: h.x }, { translateY: h.y }],
                opacity: h.opacity * rimOpacity,
                backgroundColor: mood.rim,
                shadowColor: mood.rim,
              },
            ]}
          />
        ))}
      </View>

      {/* Inner glow — soft gradient giving the orb volume */}
      <View style={[styles.innerGlow, { opacity: 0.06 + breath * 0.08 }]}>
        <LinearGradient
          colors={[`${mood.wave}10`, `${mood.glow}08`, 'transparent']}
          style={styles.innerGlowFill}
        />
      </View>

      <Text style={[styles.status, { color: mood.particle }]}>{mood.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hitbox: {
    width: ORB_SIZE,
    height: ORB_SIZE + 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bloom: {
    position: 'absolute',
    width: 240,
    height: 240,
    borderRadius: 120,
    shadowOpacity: 0.6,
    shadowRadius: 65,
    shadowOffset: { width: 0, height: 0 },
  },
  orbInterior: {
    position: 'absolute',
    width: RING_RADIUS * 2 - 6,
    height: RING_RADIUS * 2 - 6,
    borderRadius: RING_RADIUS - 3,
    overflow: 'hidden',
  },
  orbInteriorFill: {
    width: RING_RADIUS * 2 - 6,
    height: RING_RADIUS * 2 - 6,
    borderRadius: RING_RADIUS - 3,
  },
  layer: {
    position: 'absolute',
    width: ORB_SIZE,
    height: ORB_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  waveParticle: {
    position: 'absolute',
    top: CENTER,
    left: CENTER,
    shadowOpacity: 0.9,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
  orbitParticle: {
    position: 'absolute',
    top: CENTER,
    left: CENTER,
    shadowOpacity: 0.5,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 0 },
  },
  rimDot: {
    position: 'absolute',
    top: CENTER - 1.5,
    left: CENTER - 1.5,
    width: 3,
    height: 3,
    borderRadius: 1.5,
    shadowOpacity: 0.7,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
  },
  innerGlow: {
    position: 'absolute',
    width: 140,
    height: 140,
    borderRadius: 70,
    alignItems: 'center',
    justifyContent: 'center',
  },
  innerGlowFill: {
    width: 140,
    height: 140,
    borderRadius: 70,
  },
  status: {
    position: 'absolute',
    bottom: 0,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 3.5,
    opacity: 0.8,
  },
});
