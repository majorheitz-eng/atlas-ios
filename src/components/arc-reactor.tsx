import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

export type ReactorMode =
  | 'idle' | 'listening' | 'thinking' | 'responding'
  | 'creative' | 'happy' | 'focused' | 'caution'
  | 'empathetic' | 'analyzing' | 'neutral' | 'sleep';

// Glass Orb Reactor — matches the user's reference design:
// A 3D glass lens with a continuous refractive rim, specular crescent
// highlights, layered bloom halo, deep dark interior, and a living
// internal particle waveform. 12 mood states with distinct colors.

interface Mood {
  wave: string; glow: string; rim: string; hot: string;
  particle: string; aura: string; label: string;
  speed: number; amplitude: number; breathRate: number;
  particleCount: number; intensity: number;
}

const MOOD: Record<ReactorMode, Mood> = {
  idle: {
    wave: '#DDDDDD', glow: '#888888', rim: '#DDDDDD', hot: '#FFFFFF',
    particle: '#CCCCCC', aura: '#AAAAAA', label: 'TAP TO SPEAK',
    speed: 0.012, amplitude: 0.08, breathRate: 0.006, particleCount: 60, intensity: 0.5,
  },
  listening: {
    wave: '#0066FF', glow: '#0044CC', rim: '#3388FF', hot: '#AADDFF',
    particle: '#3388FF', aura: '#0066FF', label: 'LISTENING',
    speed: 0.035, amplitude: 0.20, breathRate: 0.020, particleCount: 90, intensity: 1.0,
  },
  thinking: {
    wave: '#00CCFF', glow: '#0088CC', rim: '#33DDFF', hot: '#AAEEFF',
    particle: '#33DDFF', aura: '#00CCFF', label: 'THINKING',
    speed: 0.045, amplitude: 0.22, breathRate: 0.030, particleCount: 100, intensity: 1.0,
  },
  responding: {
    wave: '#00FF77', glow: '#00CC55', rim: '#33FFAA', hot: '#AAFFCC',
    particle: '#33FFAA', aura: '#00FF77', label: 'RESPONDING',
    speed: 0.030, amplitude: 0.18, breathRate: 0.015, particleCount: 85, intensity: 0.9,
  },
  creative: {
    wave: '#9933FF', glow: '#6600CC', rim: '#BB66FF', hot: '#DDAAFF',
    particle: '#BB66FF', aura: '#9933FF', label: 'CREATIVE',
    speed: 0.040, amplitude: 0.25, breathRate: 0.025, particleCount: 110, intensity: 1.0,
  },
  happy: {
    wave: '#FFCC00', glow: '#CC9900', rim: '#FFDD33', hot: '#FFEEAA',
    particle: '#FFDD33', aura: '#FFCC00', label: 'HAPPY',
    speed: 0.035, amplitude: 0.20, breathRate: 0.018, particleCount: 90, intensity: 0.9,
  },
  focused: {
    wave: '#FF8800', glow: '#CC6600', rim: '#FFAA33', hot: '#FFCCAA',
    particle: '#FFAA33', aura: '#FF8800', label: 'FOCUSED',
    speed: 0.025, amplitude: 0.15, breathRate: 0.012, particleCount: 75, intensity: 0.8,
  },
  caution: {
    wave: '#FF3333', glow: '#CC0000', rim: '#FF6666', hot: '#FFAAAA',
    particle: '#FF6666', aura: '#FF3333', label: 'CAUTION',
    speed: 0.050, amplitude: 0.28, breathRate: 0.040, particleCount: 95, intensity: 1.0,
  },
  empathetic: {
    wave: '#FF3399', glow: '#CC0066', rim: '#FF66BB', hot: '#FFAADD',
    particle: '#FF66BB', aura: '#FF3399', label: 'EMPATHETIC',
    speed: 0.020, amplitude: 0.12, breathRate: 0.010, particleCount: 70, intensity: 0.7,
  },
  analyzing: {
    wave: '#00FFCC', glow: '#00CCAA', rim: '#33FFDD', hot: '#AAFFEE',
    particle: '#33FFDD', aura: '#00FFCC', label: 'ANALYZING',
    speed: 0.040, amplitude: 0.22, breathRate: 0.028, particleCount: 100, intensity: 0.9,
  },
  neutral: {
    wave: '#DDDDDD', glow: '#999999', rim: '#EEEEEE', hot: '#FFFFFF',
    particle: '#CCCCCC', aura: '#BBBBBB', label: 'NEUTRAL',
    speed: 0.015, amplitude: 0.10, breathRate: 0.008, particleCount: 65, intensity: 0.5,
  },
  sleep: {
    wave: '#333333', glow: '#222222', rim: '#444444', hot: '#555555',
    particle: '#3A3A3A', aura: '#2A2A2A', label: 'SLEEP MODE',
    speed: 0.005, amplitude: 0.04, breathRate: 0.003, particleCount: 30, intensity: 0.15,
  },
};

const ORB_SIZE = 280;
const CENTER = ORB_SIZE / 2;
const RING_RADIUS = 122;
const WAVE_RADIUS = 88;

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

      {/* Layer 3: Orb interior — deep dark sphere with subtle gradient */}
      <View style={styles.orbInterior}>
        <LinearGradient
          colors={[`${mood.glow}0C`, `${mood.glow}04`, '#000000']}
          style={styles.orbFill}
        />
      </View>

      {/* Layer 4: Continuous glass rim — a ring border with the mood color */}
      <View
        style={[
          styles.rimRing,
          {
            borderColor: mood.rim,
            shadowColor: mood.rim,
            opacity: intensity * 0.9,
          },
        ]}
      />

      {/* Layer 5: Refractive inner edge — thin gradient ring inside the rim */}
      <View
        style={[
          styles.refractRing,
          {
            borderColor: `${mood.wave}60`,
            opacity: 0.5 * intensity,
          },
        ]}
      />

      {/* Layer 6: Specular crescent — bright highlight upper-left */}
      <View style={[styles.specular, { opacity: specularOpacity * intensity }]}>
        <LinearGradient
          colors={[`${mood.hot}CC`, `${mood.hot}33`, 'transparent']}
          start={{ x: 0.15, y: 0.1 }}
          end={{ x: 0.6, y: 0.6 }}
          style={styles.specularFill}
        />
      </View>

      {/* Layer 7: Counter-specular — dimmer highlight lower-right */}
      <View style={[styles.counterSpecular, { opacity: 0.15 * intensity }]}>
        <LinearGradient
          colors={['transparent', `${mood.rim}22`, `${mood.rim}44`]}
          start={{ x: 0.4, y: 0.4 }}
          end={{ x: 0.85, y: 0.9 }}
          style={styles.specularFill}
        />
      </View>

      {/* Layer 8: Orbiting depth particles */}
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

      {/* Layer 9: Internal waveform — the living wave */}
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

      {/* Layer 10: Inner volumetric glow */}
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

const RING_DIAMETER = RING_RADIUS * 2;

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
  // Deep dark interior
  orbInterior: {
    position: 'absolute',
    width: RING_DIAMETER - 4,
    height: RING_DIAMETER - 4,
    borderRadius: RING_RADIUS - 2,
    overflow: 'hidden',
  },
  orbFill: {
    width: RING_DIAMETER - 4,
    height: RING_DIAMETER - 4,
    borderRadius: RING_RADIUS - 2,
  },
  // Continuous glass rim — bordered ring with glow
  rimRing: {
    position: 'absolute',
    width: RING_DIAMETER,
    height: RING_DIAMETER,
    borderRadius: RING_RADIUS,
    borderWidth: 2.5,
    shadowOpacity: 0.8,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
  },
  // Refractive inner edge — thin ring just inside the rim
  refractRing: {
    position: 'absolute',
    width: RING_DIAMETER - 10,
    height: RING_DIAMETER - 10,
    borderRadius: RING_RADIUS - 5,
    borderWidth: 1,
  },
  // Specular crescent — bright highlight on upper-left of orb surface
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
