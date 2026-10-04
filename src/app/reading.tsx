import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  deleteDoc,
  listDocs,
  newDocId,
  saveDoc,
  wordCount,
  type ReadingDoc,
} from '@/lib/reading/store';
import { fetchReadableText, titleFromUrl } from '@/lib/reading/extract';
import { palette } from '@/theme/palette';

export default function ReadingLibraryScreen() {
  const [docs, setDocs] = useState<ReadingDoc[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void listDocs().then((loaded) => {
        if (active) setDocs(loaded);
      });
      return () => {
        active = false;
      };
    }, []),
  );

  const looksLikeUrl = (value: string) => {
    const trimmed = value.trim();
    return /^(https?:\/\/|www\.)\S+$/i.test(trimmed) || /^[\w-]+\.[a-z]{2,}(\/\S*)?$/i.test(trimmed);
  };

  const addDoc = async () => {
    const value = input.trim();
    if (!value || busy) return;
    setBusy(true);
    try {
      let doc: ReadingDoc;
      if (looksLikeUrl(value)) {
        const text = await fetchReadableText(value);
        const sourceUrl = value.startsWith('http') ? value : `https://${value}`;
        doc = {
          id: `url-${sourceUrl.toLowerCase()}`,
          title: titleFromUrl(sourceUrl),
          text,
          addedAt: Date.now(),
          fromUrl: true,
          sourceUrl,
        };
      } else {
        doc = {
          id: newDocId(),
          title: value.split(/\s+/).slice(0, 6).join(' ') || 'Pasted text',
          text: value,
          addedAt: Date.now(),
          fromUrl: false,
        };
      }
      await saveDoc(doc);
      setInput('');
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setDocs(await listDocs());
    } catch (error) {
      Alert.alert('Could not add', error instanceof Error ? error.message : 'Try pasting the text directly instead.');
    } finally {
      setBusy(false);
    }
  };

  const removeDoc = (doc: ReadingDoc) => {
    Alert.alert('Remove from library?', doc.title, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          void deleteDoc(doc.id).then(() => setDocs((current) => current.filter((d) => d.id !== doc.id)));
        },
      },
    ]);
  };

  return (
    <LinearGradient colors={['#06131C', palette.canvas, '#020609']} style={styles.fill}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <Text style={styles.title}>READING HUD</Text>
        <View style={{ width: 28 }} />
      </View>

      <View style={styles.compose}>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="Paste article text or a URL…"
          placeholderTextColor="#49636D"
          multiline
          style={styles.input}
        />
        <Pressable disabled={busy || !input.trim()} onPress={() => void addDoc()} style={styles.addButton}>
          {busy ? <ActivityIndicator color="#00131A" size="small" /> : <Text style={styles.addGlyph}>+</Text>}
        </Pressable>
      </View>
      <Text style={styles.hint}>URLs are fetched and converted to clean text on-device.</Text>

      <ScrollView contentContainerStyle={styles.list}>
        {docs.length === 0 && (
          <Text style={styles.empty}>
            Nothing in your library yet. Paste an article, a chapter, or a URL above and it stays right here on this
            device.
          </Text>
        )}
        {docs.map((doc) => (
          <Pressable
            key={doc.id}
            onPress={() => router.push({ pathname: '/reading/view', params: { id: doc.id } })}
            onLongPress={() => removeDoc(doc)}
            style={styles.row}
          >
            <View style={styles.rowText}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {doc.title}
              </Text>
              <Text style={styles.rowMeta}>
                {doc.fromUrl ? 'FROM URL' : 'PASTED'} · {wordCount(doc.text).toLocaleString()} words
              </Text>
            </View>
            <Text style={styles.rowGlyph}>›</Text>
          </Pressable>
        ))}
        {docs.length > 0 && <Text style={styles.hintSmall}>Hold a row to remove it.</Text>}
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { paddingTop: 62, paddingHorizontal: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  back: { color: palette.cyan, fontSize: 38, fontWeight: '200', lineHeight: 38 },
  title: { color: palette.cyanSoft, letterSpacing: 3, fontSize: 12, fontWeight: '800' },
  compose: { marginHorizontal: 22, marginTop: 24, flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  input: {
    flex: 1,
    minHeight: 46,
    maxHeight: 120,
    backgroundColor: 'rgba(8,31,42,0.9)',
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 13,
    color: palette.text,
    fontSize: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  addButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: palette.cyan,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addGlyph: { color: '#02202A', fontSize: 26, fontWeight: '700', marginTop: -2 },
  hint: { color: '#5E7D88', fontSize: 10, letterSpacing: 0.6, marginHorizontal: 24, marginTop: 8 },
  hintSmall: { color: '#5E7D88', fontSize: 10, textAlign: 'center', marginTop: 14 },
  list: { paddingHorizontal: 22, paddingTop: 18, paddingBottom: 40 },
  empty: { color: palette.muted, fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 30, paddingHorizontal: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(8,34,44,0.92)',
    borderColor: 'rgba(46,226,245,0.23)',
    borderWidth: 1,
    borderRadius: 15,
    paddingHorizontal: 16,
    paddingVertical: 15,
    marginBottom: 10,
  },
  rowText: { flex: 1 },
  rowTitle: { color: palette.text, fontSize: 15, fontWeight: '500' },
  rowMeta: { color: palette.cyan, fontSize: 9, letterSpacing: 1.3, fontWeight: '800', marginTop: 4 },
  rowGlyph: { color: palette.cyan, fontSize: 22, fontWeight: '300' },
});
