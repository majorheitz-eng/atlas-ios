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
import { ArcReactor, type ReactorMode } from '@/components/arc-reactor';
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
import { HermesLongPollClient } from '@/lib/bridge/hermes-lp-client';
import { resolveGateway } from '@/lib/bridge/gateway-resolver';
import { speakReply, createStreamingSpeaker } from '@/lib/voice/playback';

// Lazy-loaded pickers — guarded so a missing native module can't crash the app.
let ImagePicker: typeof import('expo-image-picker') | null = null;
let DocumentPicker: typeof import('expo-document-picker') | null = null;
try { ImagePicker = require('expo-image-picker'); } catch { /* not linked */ }
try { DocumentPicker = require('expo-document-picker'); } catch { /* not linked */ }
import type { BridgeConfig } from '@/lib/bridge/secure-config-store';
import {
  rayNeoStatusColor,
  rayNeoStatusLabel,
  useRayNeo,
} from '@/lib/rayneo/connection';
import { palette } from '@/theme/palette';
import {
  clearConversation,
  loadConversation,
  saveConversation,
} from '@/lib/conversation/store';

const nowId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

export default function AtlasHomeScreen() {
  const [state, dispatch] = useReducer(conversationReducer, initialConversationState);
  const [config, setConfig] = useState<BridgeConfig | null>(null);
  const [connection, setConnection] = useState<ConnectionState>('disconnected');
  /** The URL that actually answered the WebSocket handshake — shown on the banner. */
  const [connectedUrl, setConnectedUrl] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [pendingAttachment, setPendingAttachment] = useState<{ uri: string; name: string; type: string } | null>(null);
  const [streamingReply, setStreamingReply] = useState('');
  /** Header overflow menu — collapsed by default so the top bar fits one row
   *  on an iPhone. Tapping the ≡ button reveals the less-used HUD routes. */
  const [menuOpen, setMenuOpen] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const micLevelTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastTranscriptLenRef = useRef(0);
  // RayNeo glasses — shared BLE lifecycle. Replies stream to the HUD when
  // the glasses are connected; otherwise every send is a no-op.
  const rayneo = useRayNeo();
  // Decay the meter continuously so bars fall when you stop talking.
  useEffect(() => {
    if (state.phase !== 'listening') {
      setMicLevel(0);
      return;
    }
    const decay = setInterval(() => {
      setMicLevel((prev) => Math.max(0, prev * 0.78));
    }, 120);
    return () => clearInterval(decay);
  }, [state.phase]);
  const { listen } = useLocalSearchParams<{ listen?: string }>();
  const clientRef = useRef<HermesGatewayClient | null>(null);
  const autoStartedRef = useRef(false);
  const scrollRef = useRef<ScrollView>(null);
  const finalHandledRef = useRef(false);
  const speakerRef = useRef<ReturnType<typeof createStreamingSpeaker> | null>(null);
  /** Guard so we only hydrate history once per mount (not on every focus). */
  const historyLoadedRef = useRef(false);
  // Conversation mode: after Atlas finishes speaking, auto-listen again
  // (1s delay) so the user never has to tap the reactor mid-dialogue.
  const [conversationMode, setConversationMode] = useState(false);
  const conversationModeRef = useRef(false);
  const autoListenBlockedRef = useRef(false); // set on error or manual stop
  const autoListenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const beginListeningRef = useRef<() => void>(() => {});
  // Hold-to-activate: onPressIn starts a 3s timer; if it fires before
  // onPressOut, conversation mode turns ON. A quick tap (< 3s) while the
  // mode is already on turns it OFF. The header ◑ button still toggles.
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdFiredRef = useRef(false);
  // Pulsing dot indicator (no Animated — toggle opacity via setInterval).
  const [pulseOn, setPulseOn] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      // Bulletproof ordering: saved Keychain config → portable defaults
      // (ngrok, localhost.run, LAN) → last resort. The URL that actually
      // completed the handshake is shown on the banner.
      void resolveGateway()
        .then((resolution) => {
          if (!active) return;
          setConfig(resolution.config);
          setConnectedUrl(resolution.source === 'fallback' ? null : resolution.connectedUrl);
          clientRef.current?.disconnect();
          clientRef.current = resolution.transport === 'lp'
            ? (new HermesLongPollClient(resolution.config, setConnection) as unknown as HermesGatewayClient)
            : new HermesGatewayClient(resolution.config, setConnection);
          // Proactively connect so the banner goes green without a voice prompt.
          void clientRef.current.connect().catch(() => {});
        })
        .catch(() => {
          if (!active) return;
          setConfig(null);
          setConnectedUrl(null);
        });
      return () => {
        active = false;
      };
    }, []),
  );

  useEffect(() => () => clientRef.current?.disconnect(), []);

  // Hydrate the saved conversation history once on mount so past turns
  // reappear when you reopen the app (ChatGPT-style continuity).
  useEffect(() => {
    if (historyLoadedRef.current) return;
    historyLoadedRef.current = true;
    let active = true;
    void loadConversation().then((messages) => {
      if (!active || messages.length === 0) return;
      dispatch({ type: 'HISTORY_LOADED', messages });
    });
    return () => {
      active = false;
    };
  }, []);

  // Persist the transcript whenever it changes so nothing is lost across
  // backgrounding, crashes, or restarts. Pending (in-flight) turns are
  // filtered by the store so we never rehydrate a half-finished reply.
  useEffect(() => {
    void saveConversation(state.messages);
  }, [state.messages]);

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
    // Speech happening → bump the meter (delta vs last length = words flowing).
    lastTranscriptLenRef.current = transcript.length;
    setMicLevel((prev) => Math.min(1, prev + Math.min(0.5, transcript.length * 0.02)));
    if (event.isFinal && transcript && !finalHandledRef.current) {
      finalHandledRef.current = true;
      void submit(transcript);
    }
  });
  useSpeechRecognitionEvent('error', (event) => {
    if (event.error !== 'aborted' && event.error !== 'no-speech') {
      Alert.alert('Voice unavailable', event.message || 'Atlas could not access speech recognition.');
      // Only block auto-listen on genuine errors, not transient no-speech/aborted
      autoListenBlockedRef.current = true;
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

  const pickImage = async () => {
    if (!ImagePicker) { Alert.alert('Unavailable', 'Photo picker not available in this build.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      setPendingAttachment({
        uri: asset.uri,
        name: asset.fileName || `photo-${Date.now()}.jpg`,
        type: asset.mimeType || (asset.type === 'video' ? 'video/mp4' : 'image/jpeg'),
      });
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const takePhoto = async () => {
    if (!ImagePicker) { Alert.alert('Unavailable', 'Camera not available in this build.'); return; }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      setPendingAttachment({
        uri: asset.uri,
        name: `photo-${Date.now()}.jpg`,
        type: 'image/jpeg',
      });
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const pickDocument = async () => {
    if (!DocumentPicker) { Alert.alert('Unavailable', 'Document picker not available in this build.'); return; }
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'text/plain', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/*', 'video/*'],
      copyToCacheDirectory: true,
    });
    if (!result.canceled && result.assets && result.assets[0]) {
      const asset = result.assets[0];
      setPendingAttachment({
        uri: asset.uri,
        name: asset.name,
        type: asset.mimeType || 'application/octet-stream',
      });
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const showAttachmentOptions = () => {
    Alert.alert('Attach', 'Choose a file to send to Atlas', [
      { text: 'Photo Library', onPress: () => void pickImage() },
      { text: 'Take Photo', onPress: () => void takePhoto() },
      { text: 'Document', onPress: () => void pickDocument() },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

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
    const displayText = pendingAttachment ? `${text}${text ? '\n' : ''}📎 ${pendingAttachment.name}` : text;
    dispatch({ type: 'UTTERANCE_SUBMITTED', id: requestId, text: displayText, createdAt: new Date().toISOString() });
    if (pendingAttachment) setPendingAttachment(null);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    try {
      // Streaming speaker: voice starts as soon as the first complete sentence
      // arrives — text and speech track together instead of text-then-talk.
      speakerRef.current?.cancel();
      const speaker = createStreamingSpeaker();
      speakerRef.current = speaker;
      speaker.start();
      let streamedText = '';
      const reply = await clientRef.current.ask(text, {
        onDelta: (acc) => {
          streamedText = acc;
          setStreamingReply(acc);
          speaker.push(acc);
          // Mirror the growing reply onto the RayNeo HUD while streaming.
          void rayneo.sendAnswer(acc);
        },
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
      // Push the final, complete reply to the glasses and signal end-of-frame.
      void rayneo.sendAnswer(reply);
      void rayneo.sendResponseComplete();
      // Flush any remaining tail into the speech queue; phase moves on when the
      // voice finishes (or immediately if there was nothing left to say).
      await new Promise<void>((resolve) => speaker.finish(reply, resolve));
      dispatch({ type: 'SPEECH_FINISHED' });
    } catch (error) {
      setStreamingReply('');
      // A failed request breaks the auto-listen loop too — same guard as a
      // speech-recognition error so we don't spin on a broken gateway.
      autoListenBlockedRef.current = true;
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
      // User tapped to stop mid-utterance. In conversation mode this is a
      // manual stop — block the auto-listen loop from immediately re-arming.
      autoListenBlockedRef.current = true;
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

  // Keep a ref to the latest beginListening so the auto-listen effect (which
  // only depends on phase) can call it without re-subscribing each render.
  useEffect(() => {
    beginListeningRef.current = () => { void beginListening(); };
  }, [beginListening]);

  // ── Conversation mode: auto-listen loop ──────────────────────────────
  // Fires when Atlas finishes speaking (SPEECH_FINISHED → phase 'idle').
  // If conversation mode is active and wasn't blocked by an error or a
  // manual stop, re-arm the mic after a 1s beat — no tap needed.
  useEffect(() => {
    // Clear any pending auto-listen whenever we leave the idle phase.
    if (autoListenTimerRef.current) {
      clearTimeout(autoListenTimerRef.current);
      autoListenTimerRef.current = null;
    }
    if (state.phase !== 'idle') return;
    if (!conversationModeRef.current) return;
    if (autoListenBlockedRef.current) return; // error/manual stop guard
    autoListenTimerRef.current = setTimeout(() => {
      autoListenTimerRef.current = null;
      // Re-check guards at fire time — mode may have been toggled off, or a
      // new error may have arrived, during the 1s window.
      if (!conversationModeRef.current || autoListenBlockedRef.current) return;
      beginListeningRef.current();
    }, 1000);
    return () => {
      if (autoListenTimerRef.current) {
        clearTimeout(autoListenTimerRef.current);
        autoListenTimerRef.current = null;
      }
    };
  }, [state.phase]);

  // ── Conversation mode toggle (header ◑ button) ───────────────────────
  // The header button still toggles on/off for discoverability. The orb
  // itself uses hold-to-activate / tap-to-end (see reactorPress handlers).
  const toggleConversationMode = useCallback(() => {
    setConversationMode((prev) => {
      const next = !prev;
      conversationModeRef.current = next;
      if (next) {
        autoListenBlockedRef.current = false;
        // Greet the user when entering conversation mode. Dispatch
        // GREETING_STARTED so phase becomes 'speaking' — when the greeting
        // finishes, SPEECH_FINISHED transitions phase to 'idle', which
        // fires the auto-listen effect and re-arms the mic.
        dispatch({ type: 'GREETING_STARTED' });
        setTimeout(() => {
          void speakReply('Hello Major, how may I assist you?', () => {
            dispatch({ type: 'SPEECH_FINISHED' });
          });
        }, 300);
      } else {
        if (autoListenTimerRef.current) {
          clearTimeout(autoListenTimerRef.current);
          autoListenTimerRef.current = null;
        }
        Speech.stop();
      }
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      return next;
    });
  }, []);

  // ── Orb press handlers: hold 3s to activate, tap to end ─────────────
  // onPressIn: start a 3s hold timer. If it fires → activate conversation mode.
  // onPressOut: cancel the timer. If the timer did NOT fire, this was a tap:
  //   - If conversation mode is active → turn it OFF.
  //   - If conversation mode is inactive → fall through to normal onPress
  //     (beginListening) so a quick tap still starts a single voice prompt.
  const reactorOnPressIn = useCallback(() => {
    holdFiredRef.current = false;
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    holdTimerRef.current = setTimeout(() => {
      holdFiredRef.current = true;
      holdTimerRef.current = null;
      if (!conversationModeRef.current) {
        // Activate conversation mode
        conversationModeRef.current = true;
        autoListenBlockedRef.current = false;
        setConversationMode(true);
        dispatch({ type: 'GREETING_STARTED' });
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        setTimeout(() => {
          void speakReply('Hello Major, how may I assist you?', () => {
            dispatch({ type: 'SPEECH_FINISHED' });
          });
        }, 300);
      }
    }, 3000);
  }, []);

  const reactorOnPressOut = useCallback(() => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    if (holdFiredRef.current) {
      holdFiredRef.current = false;
      return; // The hold already activated the mode — don't also onPress.
    }
    // Quick tap (< 3s):
    if (conversationModeRef.current) {
      // Turn OFF conversation mode
      conversationModeRef.current = false;
      setConversationMode(false);
      if (autoListenTimerRef.current) {
        clearTimeout(autoListenTimerRef.current);
        autoListenTimerRef.current = null;
      }
      Speech.stop();
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    // If conversation mode is OFF, the Pressable's onPress (beginListening)
    // fires next and starts a single listening prompt as before.
  }, []);

  // The Pressable onPress fires after onPressOut. When conversation mode is
  // active, a tap already ended it via onPressOut — don't also start listening.
  // When mode is OFF, fall through to beginListening for a single prompt.
  const reactorOnPress = useCallback(() => {
    if (conversationModeRef.current) return; // mode is on; tap ended via onPressOut
    void beginListening();
  }, [beginListening]);

  // Pulsing dot indicator — setInterval, no Animated API.
  useEffect(() => {
    if (!conversationMode) {
      setPulseOn(true);
      return;
    }
    const pulse = setInterval(() => setPulseOn((p) => !p), 750);
    return () => clearInterval(pulse);
  }, [conversationMode]);

  const liveMessage = useMemo<ConversationMessage | null>(() => {
    if (!streamingReply) return null;
    return {
      id: 'streaming', role: 'assistant', content: streamingReply,
      createdAt: new Date().toISOString(), status: 'pending',
    };
  }, [streamingReply]);

  // Map conversation phase to reactor mood (speaking → responding)
  const mode: ReactorMode = state.phase === 'speaking' ? 'responding' : state.phase;
  const statusColor = connection === 'connected' ? palette.success : config ? '#FFCA75' : palette.muted;
  const statusText = connection === 'connected' ? 'SECURE LINK' : config ? 'LINK STANDBY' : 'SETUP REQUIRED';
  const bannerHost = useMemo(() => {
    if (!connectedUrl) return '';
    try {
      return new URL(connectedUrl).hostname;
    } catch {
      return connectedUrl;
    }
  }, [connectedUrl]);

  /** Clear the on-screen transcript and wipe the persisted history. */
  const startNewConversation = useCallback(() => {
    if (state.messages.length > 0) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    dispatch({ type: 'CLEAR_HISTORY' });
    void clearConversation();
  }, [state.messages.length]);

  return (
    <LinearGradient colors={['#071923', palette.canvas, '#020609']} locations={[0, 0.53, 1]} style={styles.fill}>
      <SafeAreaView style={styles.fill} edges={['top', 'bottom']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.fill}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.headerScroll} contentContainerStyle={styles.header}>
          <View style={styles.headerBrand}>
            <View>
              <Text style={styles.eyebrow}>PERSONAL INTELLIGENCE</Text>
              <Text style={styles.wordmark}>ATLAS</Text>
            </View>
            {/* Start a fresh conversation: clears the transcript on screen
                and wipes the persisted history in AsyncStorage. Disabled
                while Atlas is mid-turn so we don't drop an in-flight reply. */}
            <Pressable
              onPress={startNewConversation}
              disabled={state.messages.length === 0 || state.phase === 'thinking' || state.phase === 'speaking'}
              style={[styles.clearButton, state.messages.length === 0 && styles.clearButtonDisabled]}
              accessibilityLabel="Start a new conversation"
              accessibilityHint="Clears the current transcript and saved history"
            >
              <Text style={styles.clearGlyph}>✎</Text>
            </Pressable>
          </View>
          <Pressable onPress={() => router.push('/glasses')} style={styles.settingsButton} accessibilityLabel="RayNeo glasses setup">
            <Text style={styles.readingGlyph}>◈</Text>
          </Pressable>
          {/* Conversation mode toggle: when on, Atlas auto-listens again 1s
              after it finishes speaking — hands-free continuous dialogue.
              The button is highlighted while active. */}
          <Pressable
            onPress={toggleConversationMode}
            style={[styles.settingsButton, conversationMode && styles.settingsButtonActive]}
            accessibilityLabel="Conversation mode"
            accessibilityHint="Toggle automatic continuous conversation"
            accessibilityRole="switch"
          >
            <Text style={[styles.convGlyph, conversationMode && styles.convGlyphActive]}>◑</Text>
          </Pressable>
          {/* Live glasses link indicator — chip color tracks BLE status. */}
          <View style={styles.glassesChip} pointerEvents="none">
            <View style={[styles.glassesDot, { backgroundColor: rayNeoStatusColor[rayneo.status] }]} />
            <Text style={[styles.glassesLabel, { color: rayNeoStatusColor[rayneo.status] }]} numberOfLines={1}>
              {rayNeoStatusLabel[rayneo.status]}
            </Text>
          </View>
          <Pressable onPress={() => router.push('/settings')} style={styles.settingsButton} accessibilityLabel="Atlas connection settings">
            <Text style={styles.settingsGlyph}>⌁</Text>
          </Pressable>
          {/* Overflow (≡) button + dropdown. The less-used HUD routes
              (speedometer, lyrics, reading) live behind here so the primary
              top bar — wordmark, glasses, status chip, settings — always fits
              on one iPhone row. A backdrop Pressable dismisses the menu when
              tapped outside. */}
          <Pressable
            onPress={() => {
              setMenuOpen((o) => !o);
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }}
            style={[styles.settingsButton, menuOpen && styles.settingsButtonActive]}
            accessibilityLabel="More Atlas apps"
            accessibilityHint="Opens the speedometer, lyrics, and reading HUDs"
          >
            <Text style={styles.readingGlyph}>{menuOpen ? '×' : '≡'}</Text>
          </Pressable>
        </ScrollView>
        {menuOpen && (
          <Pressable style={styles.menuBackdrop} onPress={() => setMenuOpen(false)}>
            <View style={styles.menuDropdown} onStartShouldSetResponder={() => true}>
              <Pressable
                style={styles.menuItem}
                onPress={() => {
                  setMenuOpen(false);
                  router.push('/speedometer');
                }}
                accessibilityLabel="Atlas driving speedometer HUD"
              >
                <Text style={styles.menuGlyph}>⤴</Text>
                <Text style={styles.menuLabel}>Speedometer</Text>
              </Pressable>
              <Pressable
                style={styles.menuItem}
                onPress={() => {
                  setMenuOpen(false);
                  router.push('/lyrics');
                }}
                accessibilityLabel="Atlas lyrics HUD"
              >
                <Text style={styles.menuGlyph}>♪</Text>
                <Text style={styles.menuLabel}>Lyrics</Text>
              </Pressable>
              <Pressable
                style={styles.menuItem}
                onPress={() => {
                  setMenuOpen(false);
                  router.push('/reading');
                }}
                accessibilityLabel="Atlas reading HUD"
              >
                <Text style={styles.menuGlyph}>☰</Text>
                <Text style={styles.menuLabel}>Reading</Text>
              </Pressable>
              <Pressable
                style={styles.menuItem}
                onPress={() => {
                  setMenuOpen(false);
                  router.push('/messages');
                }}
                accessibilityLabel="Atlas messages — read texts on glasses"
              >
                <Text style={styles.menuGlyph}>✉</Text>
                <Text style={styles.menuLabel}>Messages</Text>
              </Pressable>
            </View>
          </Pressable>
        )}

        {/* Conversation-mode indicator: a pulsing dot + label, only shown
            while the mode is active. The dot toggles opacity via setInterval
            (no Animated API) to signal the auto-listen loop is armed. */}
        {conversationMode && (
          <View style={styles.convModeBadge}>
            <View style={[styles.convModeDot, { opacity: pulseOn ? 1 : 0.25 }]} />
            <Text style={styles.convModeLabel}>CONVERSATION MODE</Text>
          </View>
        )}


        <View style={styles.linkRow}>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <Text style={[styles.linkText, { color: statusColor }]}>{statusText}</Text>
          <View style={styles.linkLine} />
          <Text style={styles.privateText}>PRIVATE CHANNEL</Text>
        </View>

        {/* Connection banner: which URL actually connected. */}
        {connectedUrl && (
          <Pressable onPress={() => router.push('/settings')} style={styles.banner}>
            <Text style={styles.bannerLabel}>LINKED VIA</Text>
            <Text style={styles.bannerUrl} numberOfLines={1}>
              {bannerHost}
            </Text>
          </Pressable>
        )}
        {!connectedUrl && connection === 'connecting' && (
          <Pressable onPress={() => router.push('/settings')} style={styles.banner}>
            <Text style={styles.bannerLabel}>FINDING ATLAS…</Text>
            <Text style={styles.bannerUrl} numberOfLines={1}>
              trying saved gateway, portable tunnel, home LAN
            </Text>
          </Pressable>
        )}

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
          <ArcReactor
            mode={mode}
            onPress={reactorOnPress}
            onPressIn={reactorOnPressIn}
            onPressOut={reactorOnPressOut}
            level={micLevel}
          />
        </View>

        {pendingAttachment && (
          <View style={styles.attachmentBar}>
            <Text style={styles.attachmentText} numberOfLines={1}>📎 {pendingAttachment.name}</Text>
            <Pressable onPress={() => setPendingAttachment(null)} hitSlop={8}>
              <Text style={styles.attachmentRemove}>✕</Text>
            </Pressable>
          </View>
        )}
        <View style={styles.composer}>
          <Pressable onPress={() => void showAttachmentOptions()} style={styles.attachButton} accessibilityLabel="Attach file">
            <Text style={styles.attachGlyph}>📎</Text>
          </Pressable>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={() => void submit(draft)}
            editable={state.phase !== 'thinking'}
            returnKeyType="send"
            blurOnSubmit={false}
            multiline
            placeholder={state.phase === 'thinking' ? 'Atlas is working…' : 'Message Atlas'}
            placeholderTextColor="#51707C"
            style={[styles.composerInput, { maxHeight: 120 }]}
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
  headerScroll: { maxHeight: 70 },
  header: { paddingTop: 18, paddingHorizontal: 22, flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerBrand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  clearButton: {
    width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: palette.line,
    alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(5,25,34,0.8)',
    marginTop: 2,
  },
  clearButtonDisabled: { opacity: 0.35 },
  clearGlyph: { color: palette.cyan, fontSize: 15, fontWeight: '500', marginTop: -1 },
  eyebrow: { color: palette.muted, fontSize: 8, fontWeight: '800', letterSpacing: 2.4 },
  wordmark: { color: palette.text, fontSize: 30, lineHeight: 34, fontWeight: '200', letterSpacing: 7 },
  settingsButton: { width: 42, height: 42, borderRadius: 21, borderWidth: 1, borderColor: palette.line, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(5,25,34,0.8)' },
  settingsButtonActive: { borderColor: palette.cyan, backgroundColor: 'rgba(35,230,255,0.14)' },
  menuBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 20, backgroundColor: 'rgba(3,8,13,0.45)' },
  menuDropdown: { position: 'absolute', top: 96, right: 18, zIndex: 21, backgroundColor: '#0A1D28', borderRadius: 14, borderWidth: 1, borderColor: palette.line, paddingVertical: 6, minWidth: 168, shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.5, shadowRadius: 18, elevation: 12 },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 11 },
  menuGlyph: { color: palette.cyan, fontSize: 20, fontWeight: '400', width: 26, textAlign: 'center' },
  menuLabel: { color: palette.text, fontSize: 14, fontWeight: '500' },
  settingsGlyph: { color: palette.cyan, fontSize: 25, transform: [{ rotate: '45deg' }] },
  readingGlyph: { color: palette.cyan, fontSize: 22, fontWeight: '400', marginTop: -2 },
  convGlyph: { color: palette.cyan, fontSize: 22, fontWeight: '400', marginTop: -2 },
  convGlyphActive: { color: '#02202A', fontSize: 22, fontWeight: '600', marginTop: -2 },
  convModeBadge: {
    marginTop: 10,
    marginHorizontal: 22,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: 'rgba(35,230,255,0.10)',
    borderColor: palette.cyan,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  convModeDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: palette.cyan },
  convModeLabel: { color: palette.cyan, fontSize: 8, letterSpacing: 1.6, fontWeight: '900' },
  glassesChip: {
    marginLeft: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: 'rgba(5,25,34,0.8)',
  },
  glassesDot: { width: 5, height: 5, borderRadius: 2.5 },
  glassesLabel: { fontSize: 7, letterSpacing: 1.1, fontWeight: '900' },
  linkRow: { marginTop: 15, marginHorizontal: 22, flexDirection: 'row', alignItems: 'center' },
  banner: {
    marginTop: 8,
    marginHorizontal: 22,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(8,33,43,0.58)',
    borderColor: palette.line,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  bannerLabel: { color: palette.cyan, fontSize: 8, letterSpacing: 1.4, fontWeight: '900' },
  bannerUrl: { color: '#8FB3BE', fontSize: 10, flex: 1 },
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
  attachmentBar: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 19, marginBottom: 6, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: 'rgba(8,33,43,0.72)', borderRadius: 12, borderWidth: 1, borderColor: palette.line },
  attachmentText: { flex: 1, color: palette.cyanSoft, fontSize: 13 },
  attachmentRemove: { color: palette.danger, fontSize: 16, fontWeight: '700', paddingHorizontal: 8 },
  attachButton: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', marginRight: 4 },
  attachGlyph: { fontSize: 18 },
  footer: { color: '#68838D', fontSize: 8, letterSpacing: 1.35, fontWeight: '800', textAlign: 'center', paddingTop: 14, paddingBottom: 18 },
});
