import { StyleSheet, Text, View } from 'react-native';
import type { ConversationMessage } from '@/features/conversation/conversation-reducer';
import { palette } from '@/theme/palette';

export function MessageBubble({ message }: { message: ConversationMessage }) {
  const mine = message.role === 'user';
  return (
    <View style={[styles.row, mine && styles.mineRow]}>
      {!mine && <View style={styles.avatar}><Text style={styles.avatarText}>A</Text></View>}
      <View style={[styles.bubble, mine ? styles.mine : styles.atlas]}>
        <Text style={styles.label}>{mine ? 'YOU' : 'ATLAS'}</Text>
        <Text style={styles.body}>{message.content || '…'}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 9, marginBottom: 12 },
  mineRow: { justifyContent: 'flex-end' },
  avatar: {
    width: 26, height: 26, borderRadius: 13, borderWidth: 1, borderColor: palette.cyan,
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#06212A',
  },
  avatarText: { color: palette.cyanSoft, fontSize: 12, fontWeight: '700' },
  bubble: { maxWidth: '82%', borderRadius: 18, paddingHorizontal: 15, paddingVertical: 11, borderWidth: 1 },
  atlas: { backgroundColor: 'rgba(8,34,44,0.92)', borderColor: 'rgba(46,226,245,0.23)', borderBottomLeftRadius: 5 },
  mine: { backgroundColor: 'rgba(21,91,112,0.48)', borderColor: 'rgba(69,220,239,0.32)', borderBottomRightRadius: 5 },
  label: { color: palette.cyan, fontSize: 9, letterSpacing: 1.5, fontWeight: '800', marginBottom: 4 },
  body: { color: palette.text, fontSize: 15, lineHeight: 21 },
});
