import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { palette } from '@/theme/palette';

class RootErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: Error | null }> {
  state = { hasError: false, error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Log to console so it shows in device logs
    console.error('Atlas crashed:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.errorContainer}>
          <Text style={styles.errorTitle}>ATLAS ENCOUNTERED AN ERROR</Text>
          <ScrollView style={styles.errorScroll} contentContainerStyle={styles.errorScrollContent}>
            <Text style={styles.errorText}>
              {this.state.error?.message || 'Unknown error'}{'\n\n'}
              {this.state.error?.stack || ''}
            </Text>
          </ScrollView>
          <Text style={styles.errorHint}>Report this screen to fix the crash.</Text>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  errorContainer: { flex: 1, backgroundColor: '#03080D', alignItems: 'center', justifyContent: 'center', padding: 20 },
  errorTitle: { color: '#FF667A', fontSize: 14, fontWeight: '800', letterSpacing: 1.5, marginBottom: 16 },
  errorScroll: { maxHeight: 400, width: '100%' },
  errorScrollContent: { padding: 8 },
  errorText: { color: '#EBFDFF', fontSize: 12, lineHeight: 18, fontFamily: 'monospace' },
  errorHint: { color: '#7195A3', fontSize: 10, marginTop: 12 },
});

export default function RootLayout() {
  return (
    <RootErrorBoundary>
      <StatusBar style="light" />
      {/* animation:'none' — the EAS local build's native animation driver is broken.
          ANY Stack animation (fade, slide, default) crashes with TypeError in
          __getNativeAnimationConfig. Must be 'none' until we move to EAS cloud builds. */}
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: palette.canvas }, animation: 'none' }} />
    </RootErrorBoundary>
  );
}
