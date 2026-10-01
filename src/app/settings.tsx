import { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { HermesGatewayClient } from '@/lib/bridge/hermes-gateway-client';
import { loadBridgeConfig, saveBridgeConfig } from '@/lib/bridge/secure-config-store';
import { normalizeBridgeUrl } from '@/lib/bridge/normalize-bridge-url';
import { palette } from '@/theme/palette';

export default function SettingsScreen() {
  const [baseUrl, setBaseUrl] = useState('');
  const [token, setToken] = useState('');
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    loadBridgeConfig().then((config) => {
      if (config) {
        setBaseUrl(config.baseUrl);
        setToken(config.token);
      }
    });
  }, []);

  const save = async (testFirst: boolean) => {
    try {
      const normalized = normalizeBridgeUrl(baseUrl);
      const rootUrl = normalized.replace(/\/api\/ws$/, '');
      if (!token.trim()) throw new Error('Enter the Atlas access token.');
      setTesting(true);
      const config = { baseUrl: rootUrl, token: token.trim() };
      if (testFirst) {
        const client = new HermesGatewayClient(config);
        await client.connect();
        client.disconnect();
      }
      await saveBridgeConfig(config);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (testFirst) Alert.alert('Atlas is online', 'Your iPhone connected securely to Hermes.');
      else router.back();
    } catch (error) {
      Alert.alert('Connection failed', error instanceof Error ? error.message : 'Check the URL and token.');
    } finally {
      setTesting(false);
    }
  };

  return (
    <LinearGradient colors={['#06131C', palette.canvas]} style={styles.fill}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.fill}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12}><Text style={styles.back}>‹</Text></Pressable>
          <Text style={styles.title}>ATLAS LINK</Text>
          <View style={{ width: 28 }} />
        </View>
        <View style={styles.content}>
          <View style={styles.badge}><Text style={styles.badgeText}>END-TO-END ENCRYPTED</Text></View>
          <Text style={styles.heading}>Connect to your Atlas</Text>
          <Text style={styles.copy}>Your provider keys stay on your home Hermes system. This app stores only the encrypted gateway address and a revocable access token in iPhone Keychain.</Text>

          <Text style={styles.label}>SECURE GATEWAY URL</Text>
          <TextInput
            value={baseUrl}
            onChangeText={setBaseUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="https://atlas.your-domain.com"
            placeholderTextColor="#49636D"
            style={styles.input}
          />
          <Text style={styles.label}>ACCESS TOKEN</Text>
          <TextInput
            value={token}
            onChangeText={setToken}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            placeholder="Paste the generated token"
            placeholderTextColor="#49636D"
            style={styles.input}
          />

          <Pressable disabled={testing} onPress={() => save(true)} style={styles.primary}>
            <LinearGradient colors={['#20DCEF', '#087EAA']} style={styles.primaryFill}>
              <Text style={styles.primaryText}>{testing ? 'CONNECTING…' : 'TEST & SAVE'}</Text>
            </LinearGradient>
          </Pressable>
          <Pressable disabled={testing} onPress={() => save(false)} style={styles.secondary}>
            <Text style={styles.secondaryText}>SAVE WITHOUT TESTING</Text>
          </Pressable>

          <View style={styles.note}>
            <Text style={styles.noteTitle}>PRIVATE BY DESIGN</Text>
            <Text style={styles.noteText}>Microphone audio is transcribed by Apple on-device when supported. Only the transcript is sent to Atlas.</Text>
          </View>
        </View>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { paddingTop: 62, paddingHorizontal: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  back: { color: palette.cyan, fontSize: 38, fontWeight: '200', lineHeight: 38 },
  title: { color: palette.cyanSoft, letterSpacing: 3, fontSize: 12, fontWeight: '800' },
  content: { paddingHorizontal: 25, paddingTop: 40 },
  badge: { alignSelf: 'flex-start', borderColor: 'rgba(85,241,202,0.35)', borderWidth: 1, borderRadius: 20, paddingHorizontal: 11, paddingVertical: 6, marginBottom: 18 },
  badgeText: { color: palette.success, fontSize: 9, letterSpacing: 1.5, fontWeight: '800' },
  heading: { color: palette.text, fontSize: 30, fontWeight: '300', letterSpacing: -0.5 },
  copy: { color: palette.muted, fontSize: 14, lineHeight: 21, marginTop: 12, marginBottom: 31 },
  label: { color: palette.cyanSoft, fontSize: 10, letterSpacing: 1.6, fontWeight: '800', marginBottom: 8, marginTop: 14 },
  input: { backgroundColor: 'rgba(8,31,42,0.9)', borderWidth: 1, borderColor: palette.line, borderRadius: 13, color: palette.text, fontSize: 15, paddingHorizontal: 15, paddingVertical: 15 },
  primary: { marginTop: 30, borderRadius: 14, overflow: 'hidden' },
  primaryFill: { paddingVertical: 17, alignItems: 'center' },
  primaryText: { color: '#00131A', fontWeight: '900', fontSize: 12, letterSpacing: 2 },
  secondary: { paddingVertical: 17, alignItems: 'center' },
  secondaryText: { color: palette.muted, fontWeight: '700', fontSize: 10, letterSpacing: 1.5 },
  note: { marginTop: 23, padding: 16, borderLeftWidth: 2, borderLeftColor: palette.cyan, backgroundColor: 'rgba(8,33,43,0.58)' },
  noteTitle: { color: palette.cyan, fontSize: 10, letterSpacing: 1.5, fontWeight: '900', marginBottom: 6 },
  noteText: { color: palette.muted, fontSize: 12, lineHeight: 18 },
});
