import { useEffect, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { palette } from '@/theme/palette';

export type ReactorMode = 'idle' | 'listening' | 'thinking' | 'speaking';

export function ArcReactor({ mode, onPress }: { mode: ReactorMode; onPress: () => void }) {
  const [spin] = useState(() => new Animated.Value(0));
  const [pulse] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const spinAnimation = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: mode === 'thinking' ? 1500 : 8000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    const pulseAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: mode === 'listening' ? 450 : 1200,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: mode === 'listening' ? 450 : 1200,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    spinAnimation.start();
    pulseAnimation.start();
    return () => {
      spinAnimation.stop();
      pulseAnimation.stop();
    };
  }, [mode, pulse, spin]);

  const rotation = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, mode === 'listening' ? 1.11 : 1.04] });
  const status = {
    idle: 'TAP TO SPEAK',
    listening: 'LISTENING',
    thinking: 'PROCESSING',
    speaking: 'ATLAS ONLINE',
  }[mode];

  return (
    <Pressable accessibilityRole="button" accessibilityLabel={status} onPress={onPress} style={styles.hitbox}>
      <Animated.View style={[styles.glow, { transform: [{ scale }], opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.8] }) }]} />
      <Animated.View style={[styles.outerRing, { transform: [{ rotate: rotation }] }]}>
        {Array.from({ length: 12 }).map((_, index) => (
          <View key={index} style={[styles.tick, { transform: [{ rotate: `${index * 30}deg` }, { translateY: -93 }] }]} />
        ))}
      </Animated.View>
      <View style={styles.midRing}>
        <LinearGradient colors={['#092632', '#061015']} style={styles.coreShell}>
          <LinearGradient colors={['#E5FEFF', '#24E8FF', '#047D9C']} style={styles.core}>
            <View style={styles.coreInner}>
              <Text style={styles.mark}>A</Text>
            </View>
          </LinearGradient>
        </LinearGradient>
      </View>
      <Text style={styles.status}>{status}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hitbox: { width: 244, height: 274, alignItems: 'center', justifyContent: 'center' },
  glow: {
    position: 'absolute', width: 188, height: 188, borderRadius: 94,
    backgroundColor: palette.cyan, shadowColor: palette.cyan, shadowOpacity: 1,
    shadowRadius: 38, shadowOffset: { width: 0, height: 0 },
  },
  outerRing: {
    position: 'absolute', top: 25, width: 206, height: 206, borderRadius: 103,
    borderWidth: 1, borderColor: 'rgba(66,235,255,0.32)', alignItems: 'center',
  },
  tick: { position: 'absolute', top: 99, width: 3, height: 13, borderRadius: 2, backgroundColor: palette.cyan },
  midRing: {
    width: 165, height: 165, borderRadius: 83, borderWidth: 2,
    borderColor: 'rgba(113,246,255,0.75)', padding: 13, backgroundColor: '#031017',
  },
  coreShell: { flex: 1, borderRadius: 70, padding: 15 },
  core: {
    flex: 1, borderRadius: 56, padding: 10, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#9AFAFF', shadowOpacity: 1, shadowRadius: 20, shadowOffset: { width: 0, height: 0 },
  },
  coreInner: {
    width: 76, height: 76, borderRadius: 38, backgroundColor: '#04141B',
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#B6FBFF',
  },
  mark: { color: '#D9FEFF', fontSize: 35, fontWeight: '300', letterSpacing: 2 },
  status: { position: 'absolute', bottom: 2, color: '#C9FBFF', fontSize: 11, fontWeight: '800', letterSpacing: 3 },
});
