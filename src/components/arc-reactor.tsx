import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

export type ReactorMode =
  | 'idle' | 'listening' | 'thinking' | 'responding'
  | 'creative' | 'happy' | 'focused' | 'caution'
  | 'empathetic' | 'analyzing' | 'neutral' | 'sleep' | 'personalized';

// Glass Orb Reactor — matches the user's reference design:
// A 3D glass lens with a THICK beveled glass bezel ring, specular crescent
// highlights on the upper rim, layered bloom halo, pure black interior,
// and a living internal particle waveform well inside the ring.
// 13 mood states with distinct colors including a rainbow personalized mode.

interface Mood {
  wave: string; glow: string; rim: string; hot: string;
  particle: string; aura: string; label: string;
  speed: number; amplitude: number; breathRate: number;
  particleCount: number; intensity: number;
}

const MOOD: Record<ReactorMode, Mood> = {
  idle: {
    wave: '#F0F8FF', glow: '#C0C0C0', rim: '#C0C0C0', hot: '#FFFFFF',
    particle: '#F0F8FF', aura: '#C0C0C0', label: 'TAP TO SPEAK',
    speed: 0.012, amplitude: 0.08, breathRate: 0.006, particleCount: 60, intensity: 0.5,
  },
  listening: {
    wave: '#4DA6FF', glow: '#007BFF', rim: '#007BFF', hot: '#87CEFA',
    particle: '#4DA6FF', aura: '#007BFF', label: 'LISTENING',
    speed: 0.035, amplitude: 0.20, breathRate: 0.020, particleCount: 90, intensity: 1.0,
  },
  thinking: {
    wave: '#87CEFA', glow: '#00BFFF', rim: '#00BFFF', hot: '#B0E0FF',
    particle: '#87CEFA', aura: '#00BFFF', label: 'THINKING',
    speed: 0.045, amplitude: 0.22, breathRate: 0.030, particleCount: 100, intensity: 1.0,
  },
  responding: {
    wave: '#32CD32', glow: '#00FF7F', rim: '#00FF7F', hot: '#90EE90',
    particle: '#32CD32', aura: '#00FF7F', label: 'RESPONDING',
    speed: 0.030, amplitude: 0.18, breathRate: 0.015, particleCount: 85, intensity: 0.9,
  },
  creative: {
    wave: '#DA70D6', glow: '#9400D3', rim: '#9400D3', hot: '#E6B8F2',
    particle: '#DA70D6', aura: '#9400D3', label: 'CREATIVE',
    speed: 0.040, amplitude: 0.25, breathRate: 0.025, particleCount: 110, intensity: 1.0,
  },
  happy: {
    wave: '#FFA500', glow: '#FFD700', rim: '#FFD700', hot: '#FFE066',
    particle: '#FFA500', aura: '#FFD700', label: 'HAPPY',
    speed: 0.035, amplitude: 0.20, breathRate: 0.018, particleCount: 90, intensity: 0.9,
  },
  focused: {
    wave: '#FF4500', glow: '#FF8C00', rim: '#FF8C00', hot: '#FFAA33',
    particle: '#FF4500', aura: '#FF8C00', label: 'FOCUSED',
    speed: 0.025, amplitude: 0.15, breathRate: 0.012, particleCount: 75, intensity: 0.8,
  },
  caution: {
    wave: '#FF6347', glow: '#FF0000', rim: '#FF0000', hot: '#FF9999',
    particle: '#FF6347', aura: '#FF0000', label: 'CAUTION',
    speed: 0.050, amplitude: 0.28, breathRate: 0.040, particleCount: 95, intensity: 1.0,
  },
  empathetic: {
    wave: '#FF69B4', glow: '#FF1493', rim: '#FF1493', hot: '#FFB3D9',
    particle: '#FF69B4', aura: '#FF1493', label: 'EMPATHETIC',
    speed: 0.020, amplitude: 0.12, breathRate: 0.010, particleCount: 70, intensity: 0.7,
  },
  analyzing: {
    wave: '#40E0D0', glow: '#008080', rim: '#008080', hot: '#7FFFD4',
    particle: '#40E0D0', aura: '#008080', label: 'ANALYZING',
    speed: 0.040, amplitude: 0.22, breathRate: 0.028, particleCount: 100, intensity: 0.9,
  },
  neutral: {
    wave: '#F0F8FF', glow: '#C0C0C0', rim: '#C0C0C0', hot: '#FFFFFF',
    particle: '#F0F8FF', aura: '#C0C0C0', label: 'NEUTRAL',
    speed: 0.015, amplitude: 0.10, breathRate: 0.008, particleCount: 65, intensity: 0.5,
  },
  sleep: {
    wave: '#555555', glow: '#333333', rim: '#333333', hot: '#666666',
    particle: '#555555', aura: '#333333', label: 'SLEEP MODE',
    speed: 0.005, amplitude: 0.04, breathRate: 0.003, particleCount: 30, intensity: 0.15,
  },
  personalized: {
    // Rainbow gradient mood — rim uses a representative gradient color.
    // The full rainbow effect comes from the layered bloom + particles.
    wave: '#FF00FF', glow: '#FF0000', rim: '#FF00FF', hot: '#00FFFF',
    particle: '#FF00FF', aura: '#800080', label: 'PERSONALIZED',
    speed: 0.040, amplitude: 0.24, breathRate: 0.022, particleCount: 100, intensity: 1.0,
  },
};

const ORB_SIZE = 280;
const CENTER = ORB_SIZE / 2;
const RING_RADIUS = 128;
const RING_DIAMETER = RING_RADIUS * 2;
const BEZEL_WIDTH = 10;
const WAVE_RADIUS = 78;
const INTERIOR_RADIUS = RING_RADIUS - BEZEL_WIDTH;
const INTERIOR_DIAMETER = INTERIOR_RADIUS * 2;

export function ArcReactor({
  mode,
  onPress,
  onPressIn,
  onPressOut,
  level = 0,
}: {
  mode: ReactorMode;
  onPress: () => void;
  onPressIn?: () => void;
  onPressOut?: () => void;
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

  const breath = (Math.sin(breathRef.current) + 1) / 2;
  const lvl = smoothLevelRef.current;
  const amp = WAVE_RADIUS * mood.amplitude * (0.6 + breath * 0.5 + lvl * 0.3);
  const intensity = mood.intensity * (0.7 + breath * 0.3);

  // Internal waveform particles — the living wave of light
  const waveParticles: { x: number; y: number; size: number; opacity: number; color: string }[] = [];
  const numWave = mood.particleCount;
  for (let i = 0; i < numWave; i++) {
    const t = i / numWave;
    const xAngle = (t - 0.5) * Math.PI * 2.4;
    const wave1 = Math.sin(xAngle * 3 + phaseRef.current * 2);
    const wave2 = Math.sin(xAngle * 5 + phaseRef.current * 1.3) * 0.3;
    const y = wave1 * amp + wave2 * amp * 0.5;
    const x = Math.sin(xAngle) * WAVE_RADIUS * 0.85;
    const shimmer = (Math.sin(shimmerRef.current * 3 + i * 0.4) + 1) / 2;
    const heat = (Math.abs(wave1) + 1) / 2;
    const size = 1 + heat * 2.5 + shimmer * 1.2;
    const opacity = (0.12 + heat * 0.6 + shimmer * 0.18) * intensity;
    const color = heat > 0.66 ? mood.hot : heat > 0.33 ? mood.wave : mood.glow;
    waveParticles.push({ x, y, size, opacity, color });
  }

  // Orbiting depth particles
  const orbitParticles: { x: number; y: number; size: number; opacity: number }[] = [];
  const numOrbit = 15;
  for (let i = 0; i < numOrbit; i++) {
    const angle = (i / numOrbit) * Math.PI * 2 + phaseRef.current * 0.5;
    const r = WAVE_RADIUS * (0.3 + 0.35 * Math.sin(phaseRef.current + i));
    const x = Math.cos(angle) * r;
    const y = Math.sin(angle) * r * 0.4;
    const shimmer = (Math.sin(shimmerRef.current * 2 + i * 0.7) + 1) / 2;
    orbitParticles.push({ x, y, size: 1 + shimmer * 1.2, opacity: (0.08 + shimmer * 0.2) * intensity });
  }

  // Compute specular highlight opacity (shifts with breath)
  const specularOpacity = 0.35 + breath * 0.25;
  const innerGlowOpacity = 0.05 + breath * 0.08;

  // Bloom opacity (layered)
  const bloomOpacity1 = (0.08 + breath * 0.12) * intensity;
  const bloomOpacity2 = (0.04 + breath * 0.06) * intensity;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={mood.label}
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      style={styles.hitbox}
    >
      {/* Layer 1: Outer bloom — large diffuse halo */}
      <View
        style={[
          styles.bloomOuter,
          {
            opacity: bloomOpacity1,
            backgroundColor: mood.aura,
            shadowColor: mood.aura,
          },
        ]}
      />

      {/* Layer 2: Inner bloom — tighter glow */}
      <View
        style={[
          styles.bloomInner,
          {
            opacity: bloomOpacity2,
            backgroundColor: mood.aura,
            shadowColor: mood.aura,
          },
        ]}
      />

      {/* Layer 3: Orb interior — pure black with subtle mood gradient */}
      <View style={styles.orbInterior}>
        <LinearGradient
          colors={[`${mood.glow}08`, '#000000', '#000000']}
          style={styles.orbFill}
        />
      </View>

      {/* Layer 4: Thick glass ring — the main beveled bezel */}
      <View
        style={[
          styles.glassRing,
          {
            borderColor: mood.rim,
            shadowColor: mood.rim,
            opacity: intensity * 0.9,
          },
        ]}
      />

      {/* Layer 5: Outer bevel highlight — light catching the outer edge */}
      <View
        style={[
          styles.bevelOuter,
          { borderColor: '#FFFFFF', opacity: 0.15 * intensity },
        ]}
      />

      {/* Layer 6: Inner bevel — refractive inner edge of the bezel */}
      <View
        style={[
          styles.bevelInner,
          { borderColor: mood.hot, opacity: 0.4 * intensity },
        ]}
      />

      {/* Layer 7: Specular crescent — bright highlight on upper rim */}
      <View style={[styles.specular, { opacity: specularOpacity * intensity }]}>
        <LinearGradient
          colors={[`${mood.hot}DD`, `${mood.hot}44`, 'transparent']}
          start={{ x: 0.15, y: 0.05 }}
          end={{ x: 0.5, y: 0.5 }}
          style={styles.specularFill}
        />
      </View>

      {/* Layer 8: Counter-specular — dimmer reflection lower-right */}
      <View style={[styles.counterSpecular, { opacity: 0.12 * intensity }]}>
        <LinearGradient
          colors={['transparent', `${mood.rim}22`, `${mood.rim}44`]}
          start={{ x: 0.4, y: 0.4 }}
          end={{ x: 0.85, y: 0.9 }}
          style={styles.specularFill}
        />
      </View>

      {/* Layer 9: Orbiting depth particles */}
      <View style={styles.layer}>
        {orbitParticles.map((p, i) => (
          <View
            key={`o${i}`}
            style={[
              styles.particle,
              {
                transform: [{ translateX: p.x }, { translateY: p.y }],
                width: p.size, height: p.size, borderRadius: p.size / 2,
                backgroundColor: mood.particle, opacity: p.opacity,
                shadowColor: mood.particle,
              },
            ]}
          />
        ))}
      </View>

      {/* Layer 10: Internal waveform — the living wave */}
      <View style={styles.layer}>
        {waveParticles.map((p, i) => (
          <View
            key={`w${i}`}
            style={[
              styles.particle,
              {
                transform: [{ translateX: p.x }, { translateY: p.y }],
                width: p.size, height: p.size, borderRadius: p.size / 2,
                backgroundColor: p.color, opacity: p.opacity,
                shadowColor: p.color,
              },
            ]}
          />
        ))}
      </View>

      {/* Layer 11: Inner volumetric glow */}
      <View style={[styles.innerGlow, { opacity: innerGlowOpacity }]}>
        <LinearGradient
          colors={[`${mood.wave}18`, `${mood.glow}0A`, 'transparent']}
          style={styles.innerGlowFill}
        />
      </View>

      <Text style={[styles.status, { color: mood.particle, opacity: intensity * 0.85 }]}>
        {mood.label}
      </Text>
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
  // Outer bloom — large diffuse halo (big shadowRadius)
  bloomOuter: {
    position: 'absolute',
    width: 260,
    height: 260,
    borderRadius: 130,
    shadowOpacity: 0.5,
    shadowRadius: 80,
    shadowOffset: { width: 0, height: 0 },
  },
  // Inner bloom — tighter glow layer
  bloomInner: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100,
    shadowOpacity: 0.4,
    shadowRadius: 40,
    shadowOffset: { width: 0, height: 0 },
  },
  // Orb interior — pure black, clipped to inside the thick ring
  orbInterior: {
    position: 'absolute',
    width: INTERIOR_DIAMETER,
    height: INTERIOR_DIAMETER,
    borderRadius: INTERIOR_RADIUS,
    overflow: 'hidden',
  },
  orbFill: {
    width: INTERIOR_DIAMETER,
    height: INTERIOR_DIAMETER,
    borderRadius: INTERIOR_RADIUS,
  },
  // Thick glass ring — the main beveled bezel (10px border)
  glassRing: {
    position: 'absolute',
    width: RING_DIAMETER,
    height: RING_DIAMETER,
    borderRadius: RING_RADIUS,
    borderWidth: BEZEL_WIDTH,
    shadowOpacity: 0.8,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
  },
  // Outer bevel highlight — light catching the outer edge of the bezel
  bevelOuter: {
    position: 'absolute',
    width: RING_DIAMETER + 4,
    height: RING_DIAMETER + 4,
    borderRadius: RING_RADIUS + 2,
    borderWidth: 1,
  },
  // Inner bevel — refractive inner edge of the bezel
  bevelInner: {
    position: 'absolute',
    width: INTERIOR_DIAMETER - 4,
    height: INTERIOR_DIAMETER - 4,
    borderRadius: INTERIOR_RADIUS - 2,
    borderWidth: 2,
  },
  // Specular crescent — bright highlight on upper rim of orb surface
  specular: {
    position: 'absolute',
    width: RING_DIAMETER,
    height: RING_DIAMETER,
    borderRadius: RING_RADIUS,
    overflow: 'hidden',
  },
  specularFill: {
    width: RING_DIAMETER,
    height: RING_DIAMETER,
    borderRadius: RING_RADIUS,
  },
  // Counter-specular — dimmer reflection lower-right
  counterSpecular: {
    position: 'absolute',
    width: RING_DIAMETER,
    height: RING_DIAMETER,
    borderRadius: RING_RADIUS,
    overflow: 'hidden',
  },
  // Particle layer (orbiting + waveform)
  layer: {
    position: 'absolute',
    width: ORB_SIZE,
    height: ORB_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  particle: {
    position: 'absolute',
    top: CENTER,
    left: CENTER,
    shadowOpacity: 0.9,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 0 },
  },
  // Inner volumetric glow
  innerGlow: {
    position: 'absolute',
    width: 130,
    height: 130,
    borderRadius: 65,
    alignItems: 'center',
    justifyContent: 'center',
  },
  innerGlowFill: {
    width: 130,
    height: 130,
    borderRadius: 65,
  },
  status: {
    position: 'absolute',
    bottom: 0,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 3.5,
  },
});
