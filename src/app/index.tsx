import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Speech from 'expo-speech';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';
import { ArcReactor } from '@/components/arc-reactor';
import { MessageBubble } from '@/components/message-bubble';
import {
  conversationReducer,
  initialConversationState,
  type ConversationMessage,
} from '@/features/conversation/conversation-reducer';
import {
  HermesGatewayClient,
  type ApprovalChoice,
  type ApprovalRequest,
  type ConnectionState,
} from '@/lib/bridge/hermes-gateway-client';
import { loadBridgeConfig, type BridgeConfig } from '@/lib/bridge/secure-config-store';
import { palette } from '@/theme/palette';

const nowId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

export default function AtlasHomeScreen() {
  const [state, dispatch] = useReducer(conversationReducer, initialConversationState);
  const [config, setConfig] = useState<BridgeConfig | null>(null);
  const [connection, setConnection] = useState<ConnectionState>('disconnected');
  const [draft, setDraft] = useState('');
  const [streamingReply, setStreamingReply] = useState('');
  const { listen } = useLocalSearchParams<{ listen?: string }>();
  const clientRef = useRef<HermesGatewayClient | null>(null);
  const autoStartedRef = useRef(false);
  const scrollRef = useRef<ScrollView>(null);
  const finalHandledRef = useRef(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void loadBridgeConfig().then((loaded) => {
        if (!active) return;
        setConfig(loaded);
        clientRef.current?.disconnect();
        clientRef.current = loaded ? new HermesGatewayClient(loaded, setConnection) : null;
      });
      return () => {
        active = false;
      };
    }, []),
  );

  useEffect(() => () => clientRef.current?.disconnect(), []);

  useEffect(() => {
    const timer = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(timer);
  }, [state.messages, streamingReply, state.transcript]);

  useSpeechRecognitionEvent('start', () => {
    finalHandledRef.current = false;
    dispatch({ type: 'LISTENING_STARTED' });
  });
  useSpeechRecognitionEvent('end', () => {
    if (!finalHandledRef.current) dispatch({ type: 'LISTENING_STOPPED' });
  });
  useSpeechRecognitionEvent('result', (event) => {
    const transcript = event.results[0]?.transcript?.trim() ?? '';
    dispatch({ type: 'TRANSCRIPT_CHANGED', text: transcript });
    if (event.isFinal && transcript && !finalHandledRef.current) {
      finalHandledRef.current = true;
      void submit(transcript);
    }
  });
  useSpeechRecognitionEvent('error', (event) => {
    if (event.error !== 'aborted' && event.error !== 'no-speech') {
      Alert.alert('Voice unavailable', event.message || 'Atlas could not access speech recognition.');
    }
    dispatch({ type: 'LISTENING_STOPPED' });
  });

  const requestApproval = useCallback((request: ApprovalRequest) => {
    return new Promise<ApprovalChoice>((resolve) => {
      const details = request.command || request.description || 'Atlas wants to perform a protected action.';
      const buttons = request.choices.map((choice) => ({
        text: { once: 'Allow once', session: 'This session', always: 'Always allow', deny: 'Deny' }[choice],
        style: choice === 'deny' ? ('destructive' as const) : ('default' as const),
        onPress: async () => {
          if (choice === 'deny') return resolve('deny');
          const hardware = await LocalAuthentication.hasHardwareAsync();
          const enrolled = await LocalAuthentication.isEnrolledAsync();
          if (!hardware || !enrolled) {
            Alert.alert('Face ID required', 'Enable Face ID or device authentication before approving Atlas actions.');
            return resolve('deny');
          }
          const auth = await LocalAuthentication.authenticateAsync({
            promptMessage: 'Approve Atlas action',
            cancelLabel: 'Deny',
            disableDeviceFallback: false,
          });
          resolve(auth.success ? choice : 'deny');
        },
      }));
      Alert.alert('Atlas requests approval', details, buttons, {
        cancelable: false,
      });
    });
  }, []);

  async function submit(rawText: string) {
    const text = rawText.trim();
    if (!text) return;
    if (!clientRef.current || !config) {
      Alert.alert('Connect Atlas first', 'Add your secure Hermes gateway to start talking with Atlas.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Connect', onPress: () => router.push('/settings') },
      ]);
      return;
    }

    Speech.stop();
    ExpoSpeechRecognitionModule.abort();
    setDraft('');
    setStreamingReply('');
    const requestId = nowId('user');
    dispatch({ type: 'UTTERANCE_SUBMITTED', id: requestId, text, createdAt: new Date().toISOString() });
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    try {
      const reply = await clientRef.current.ask(text, {
        onDelta: setStreamingReply,
        onApproval: requestApproval,
      });
      setStreamingReply('');
      dispatch({
        type: 'RESPONSE_RECEIVED',
        replyId: nowId('atlas'),
        requestId,
        text: reply,
        createdAt: new Date().toISOString(),
      });
      Speech.speak(reply, {
        language: 'en-US',
        rate: 0.96,
        pitch: 0.93,
        onDone: () => dispatch({ type: 'SPEECH_FINISHED' }),
        onStopped: () => dispatch({ type: 'SPEECH_FINISHED' }),
        onError: () => dispatch({ type: 'SPEECH_FINISHED' }),
      });
    } catch (error) {
      setStreamingReply('');
      dispatch({
        type: 'REQUEST_FAILED',
        requestId,
        error: error instanceof Error ? error.message : 'Atlas could not complete the request.',
      });
    }
  }

  const beginListening = useCallback(async () => {
    if (!config) {
      router.push('/settings');
      return;
    }
    if (state.phase === 'listening') {
      ExpoSpeechRecognitionModule.stop();
      return;
    }
    if (state.phase === 'speaking') Speech.stop();
    if (state.phase === 'thinking') return;

    const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Microphone permission needed', 'Allow microphone and speech recognition access in Settings to talk with Atlas.');
      return;
    }
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    ExpoSpeechRecognitionModule.start({
      lang: 'en-US',
      interimResults: true,
      continuous: false,
      maxAlternatives: 1,
      requiresOnDeviceRecognition: false,
      contextualStrings: ['Atlas', 'Hermes', 'Kendrick Home'],
    });
  }, [config, state.phase]);

  useEffect(() => {
    if (listen === '1' && config && !autoStartedRef.current) {
      autoStartedRef.current = true;
      const timer = setTimeout(() => void beginListening(), 350);
      return () => clearTimeout(timer);
    }
  }, [beginListening, config, listen]);

  const liveMessage = useMemo<ConversationMessage | null>(() => {
    if (!streamingReply) return null;
    return {
      id: 'streaming', role: 'assistant', content: streamingReply,
      createdAt: new Date().toISOString(), status: 'pending',
    };
  }, [streamingReply]);

  const mode = state.phase;
  const statusColor = connection === 'connected' ? palette.success : config ? '#FFCA75' : palette.muted;
  const statusText = connection === 'connected' ? 'SECURE LINK' : config ? 'LINK STANDBY' : 'SETUP REQUIRED';

  return (
    <LinearGradient colors={['#071923', palette.canvas, '#020609']} locations={[0, 0.53, 1]} style={styles.fill}>
      <SafeAreaView style={styles.fill} edges={['top', 'bottom']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.fill}>
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>PERSONAL INTELLIGENCE</Text>
            <Text style={styles.wordmark}>ATLAS</Text>
          </View>
          <Pressable onPress={() => router.push('/settings')} style={styles.settingsButton} accessibilityLabel="Atlas connection settings">
            <Text style={styles.settingsGlyph}>⌁</Text>
          </Pressable>
        </View>

        <View style={styles.linkRow}>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <Text style={[styles.linkText, { color: statusColor }]}>{statusText}</Text>
          <View style={styles.linkLine} />
          <Text style={styles.privateText}>PRIVATE CHANNEL</Text>
        </View>

        <ScrollView ref={scrollRef} style={styles.chat} contentContainerStyle={styles.chatContent} keyboardShouldPersistTaps="handled">
          {state.messages.length === 0 && !liveMessage ? (
            <View style={styles.welcome}>
              <Text style={styles.welcomeTitle}>Good to see you, Major.</Text>
              <Text style={styles.welcomeCopy}>Tap the reactor and speak naturally. Atlas can reason, remember, and operate your approved tools.</Text>
            </View>
          ) : (
            state.messages.map((message) => <MessageBubble key={message.id} message={message} />)
          )}
          {liveMessage && <MessageBubble message={liveMessage} />}
          {!!state.transcript && state.phase === 'listening' && (
            <Text style={styles.liveTranscript}>“{state.transcript}”</Text>
          )}
          {!!state.error && (
            <Pressable onPress={() => dispatch({ type: 'ERROR_CLEARED' })} style={styles.errorBox}>
              <Text style={styles.errorTitle}>CONNECTION INTERRUPTED</Text>
              <Text style={styles.errorText}>{state.error}</Text>
            </Pressable>
          )}
        </ScrollView>

        <View style={styles.reactorWrap}>
          <ArcReactor mode={mode} onPress={beginListening} />
        </View>

        <View style={styles.composer}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={() => void submit(draft)}
            editable={state.phase !== 'thinking'}
            returnKeyType="send"
            placeholder={state.phase === 'thinking' ? 'Atlas is working…' : 'Message Atlas'}
            placeholderTextColor="#51707C"
            style={styles.composerInput}
          />
          <Pressable onPress={() => void submit(draft)} disabled={!draft.trim() || state.phase === 'thinking'} style={styles.sendButton}>
            <Text style={styles.sendGlyph}>↑</Text>
          </Pressable>
        </View>
        <Text style={styles.footer}>PRESS ACTION BUTTON OR SAY “SIRI, ASK ATLAS”</Text>
      </KeyboardAvoidingView>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { paddingTop: 18, paddingHorizontal: 22, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  eyebrow: { color: palette.muted, fontSize: 8, fontWeight: '800', letterSpacing: 2.4 },
  wordmark: { color: palette.text, fontSize: 30, lineHeight: 34, fontWeight: '200', letterSpacing: 7 },
  settingsButton: { width: 42, height: 42, borderRadius: 21, borderWidth: 1, borderColor: palette.line, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(5,25,34,0.8)' },
  settingsGlyph: { color: palette.cyan, fontSize: 25, transform: [{ rotate: '45deg' }] },
  linkRow: { marginTop: 15, marginHorizontal: 22, flexDirection: 'row', alignItems: 'center' },
  statusDot: { width: 6, height: 6, borderRadius: 3, marginRight: 7 },
  linkText: { fontSize: 8, letterSpacing: 1.4, fontWeight: '900' },
  linkLine: { height: 1, flex: 1, backgroundColor: palette.line, marginHorizontal: 10 },
  privateText: { color: '#5E7D88', fontSize: 8, letterSpacing: 1.3, fontWeight: '700' },
  chat: { flex: 1, marginTop: 15 },
  chatContent: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 20, flexGrow: 1, justifyContent: 'flex-end' },
  welcome: { alignItems: 'center', paddingHorizontal: 23, marginBottom: 8 },
  welcomeTitle: { color: palette.text, fontSize: 21, fontWeight: '300', textAlign: 'center', marginBottom: 8 },
  welcomeCopy: { color: palette.muted, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  liveTranscript: { color: palette.cyanSoft, fontSize: 15, textAlign: 'center', lineHeight: 21, marginTop: 6 },
  errorBox: { backgroundColor: 'rgba(79,18,29,0.52)', borderColor: 'rgba(255,102,122,0.38)', borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 8 },
  errorTitle: { color: palette.danger, fontSize: 9, letterSpacing: 1.4, fontWeight: '900', marginBottom: 4 },
  errorText: { color: '#FFD7DC', fontSize: 12, lineHeight: 17 },
  reactorWrap: { height: 274, marginBottom: 14, alignItems: 'center', justifyContent: 'center', overflow: 'visible' },
  composer: { marginHorizontal: 19, minHeight: 50, flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(6,27,37,0.96)', borderWidth: 1, borderColor: palette.line, borderRadius: 25, paddingLeft: 17, paddingRight: 6 },
  composerInput: { flex: 1, color: palette.text, fontSize: 15, paddingVertical: 13 },
  sendButton: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.cyan },
  sendGlyph: { color: '#02202A', fontSize: 23, fontWeight: '600', marginTop: -2 },
  footer: { color: '#68838D', fontSize: 8, letterSpacing: 1.35, fontWeight: '800', textAlign: 'center', paddingTop: 14, paddingBottom: 18 },
});
