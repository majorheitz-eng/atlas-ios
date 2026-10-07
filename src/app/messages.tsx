import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { palette } from '@/theme/palette';
import { useRayNeo } from '@/lib/rayneo/connection';
import { NativeEventEmitter, NativeModules, Platform } from 'react-native';

// Use native notification observer directly (no expo-notifications dependency)
const notificationEmitter = Platform.OS === 'ios' ? new NativeEventEmitter() : null;

interface MessageItem {
  id: string;
  title: string;
  body: string;
  app: string;
  timestamp: number;
  read: boolean;
}

export default function MessagesScreen() {
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [selected, setSelected] = useState<MessageItem | null>(null);
  const messagesRef = useRef<MessageItem[]>([]);
  const rayneo = useRayNeo();

  // Capture incoming notifications via native iOS notification observer
  useEffect(() => {
    // Listen for notifications via the native module's event emitter
    // The RayNeo native module captures iOS notifications and emits them
    const subscription = notificationEmitter?.addListener(
      'notificationReceived',
      (event: { title?: string; body?: string; app?: string }) => {
        const title = event.title ?? 'Notification';
        const body = event.body ?? '';
        const app = event.app ?? 'Unknown';
        const item: MessageItem = {
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          title, body, app,
          timestamp: Date.now(),
          read: false,
        };
        messagesRef.current = [item, ...messagesRef.current].slice(0, 50);
        setMessages(messagesRef.current);
        if (body) {
          void rayneo.sendNotification(`${title}: ${body}`);
        }
      }
    );

    return () => subscription?.remove();
  }, [rayneo]);

  // Auto-push selected message to glasses as a notification card
  const openMessage = useCallback((msg: MessageItem) => {
    setSelected(msg);
    if (!msg.read) {
      msg.read = true;
      setMessages([...messagesRef.current]);
    }
    // Push full text to glasses
    void rayneo.sendNotification(`${msg.title}: ${msg.body}`);
  }, [rayneo]);

  return (
    <LinearGradient colors={['#06131C', palette.canvas]} style={styles.fill}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <Text style={styles.title}>MESSAGES</Text>
        <View style={{ width: 28 }} />
      </View>

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {messages.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No messages yet</Text>
            <Text style={styles.emptyCopy}>
              Incoming text messages and notifications will appear here.
              They'll also be pushed to your RayNeo glasses automatically.
            </Text>
          </View>
        ) : (
          messages.map((msg) => (
            <Pressable
              key={msg.id}
              onPress={() => openMessage(msg)}
              style={[styles.card, selected?.id === msg.id && styles.cardSelected]}
            >
              <View style={styles.cardHeader}>
                {!msg.read && <View style={styles.unreadDot} />}
                <Text style={styles.cardTitle} numberOfLines={1}>{msg.title}</Text>
                <Text style={styles.cardTime}>
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                </Text>
              </View>
              <Text style={styles.cardBody} numberOfLines={selected?.id === msg.id ? undefined : 2}>
                {msg.body}
              </Text>
              <Text style={styles.cardApp}>{msg.app}</Text>
            </Pressable>
          ))
        )}
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { paddingTop: 62, paddingHorizontal: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  back: { color: palette.cyan, fontSize: 38, fontWeight: '200', lineHeight: 38 },
  title: { color: palette.cyanSoft, letterSpacing: 3, fontSize: 12, fontWeight: '800' },
  list: { flex: 1, marginTop: 15 },
  listContent: { paddingHorizontal: 20, paddingBottom: 30 },
  empty: { alignItems: 'center', paddingHorizontal: 30, marginTop: 60 },
  emptyTitle: { color: palette.text, fontSize: 18, fontWeight: '300', marginBottom: 8 },
  emptyCopy: { color: palette.muted, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  card: {
    backgroundColor: 'rgba(8,31,42,0.9)',
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
  },
  cardSelected: {
    borderColor: palette.cyan,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: palette.cyan, marginRight: 8 },
  cardTitle: { color: palette.text, fontSize: 15, fontWeight: '600', flex: 1 },
  cardTime: { color: palette.muted, fontSize: 11 },
  cardBody: { color: '#B0C8D0', fontSize: 13, lineHeight: 19 },
  cardApp: { color: palette.muted, fontSize: 10, marginTop: 6, letterSpacing: 0.5 },
});
