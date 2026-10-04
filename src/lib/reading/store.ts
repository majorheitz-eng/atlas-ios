// Atlas Reading: local, phone-only library and teleprompter.
//
// Documents never leave the device — text is stored in AsyncStorage. (The
// gateway reading.saveState RPC is optional/best-effort and not required.)
// Documents are identified by a stable id: a UUID for pasted text, or the
// normalized URL for web pages, so positions survive re-adds.

import AsyncStorage from '@react-native-async-storage/async-storage';

export type ReadingDoc = {
  id: string;
  /** Display title. */
  title: string;
  /** Full text content (for URLs, the extracted article text). */
  text: string;
  /** Epoch ms when added. */
  addedAt: number;
  /** True when created from a URL fetch rather than pasted text. */
  fromUrl: boolean;
  /** Optional source URL. */
  sourceUrl?: string;
};

/** Index of doc ids in library order (newest first). */
const INDEX_KEY = 'atlas.reading.index';
const DOC_PREFIX = 'atlas.reading.doc.';
/** docId -> { scrollIndex, wpm } */
const POS_PREFIX = 'atlas.reading.pos.';

export type ReadingPosition = { scrollIndex: number; wpm: number };

export async function listDocs(): Promise<ReadingDoc[]> {
  const raw = await AsyncStorage.getItem(INDEX_KEY);
  const ids: string[] = raw ? JSON.parse(raw) : [];
  const docs = await Promise.all(
    ids.map(async (id) => {
      const docRaw = await AsyncStorage.getItem(DOC_PREFIX + id);
      return docRaw ? (JSON.parse(docRaw) as ReadingDoc) : null;
    }),
  );
  return docs.filter((d): d is ReadingDoc => d !== null);
}

export async function getDoc(id: string): Promise<ReadingDoc | null> {
  const raw = await AsyncStorage.getItem(DOC_PREFIX + id);
  return raw ? (JSON.parse(raw) as ReadingDoc) : null;
}

export async function saveDoc(doc: ReadingDoc): Promise<void> {
  await AsyncStorage.setItem(DOC_PREFIX + doc.id, JSON.stringify(doc));
  const raw = await AsyncStorage.getItem(INDEX_KEY);
  const ids: string[] = raw ? JSON.parse(raw) : [];
  if (!ids.includes(doc.id)) {
    await AsyncStorage.setItem(INDEX_KEY, JSON.stringify([doc.id, ...ids]));
  }
}

export async function deleteDoc(id: string): Promise<void> {
  await AsyncStorage.removeItem(DOC_PREFIX + id);
  const raw = await AsyncStorage.getItem(INDEX_KEY);
  const ids: string[] = raw ? JSON.parse(raw) : [];
  await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(ids.filter((x) => x !== id)));
}

export async function loadPosition(id: string): Promise<ReadingPosition> {
  const raw = await AsyncStorage.getItem(POS_PREFIX + id);
  if (!raw) return { scrollIndex: 0, wpm: 220 };
  try {
    const parsed = JSON.parse(raw) as Partial<ReadingPosition>;
    return {
      scrollIndex: typeof parsed.scrollIndex === 'number' ? parsed.scrollIndex : 0,
      wpm: typeof parsed.wpm === 'number' ? parsed.wpm : 220,
    };
  } catch {
    return { scrollIndex: 0, wpm: 220 };
  }
}

export async function savePosition(id: string, position: ReadingPosition): Promise<void> {
  await AsyncStorage.setItem(POS_PREFIX + id, JSON.stringify(position));
}

export function docIdFromUrl(url: string): string {
  return `url-${url.trim().toLowerCase()}`;
}

export function newDocId(): string {
  return `doc-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Rough "how long is this doc" helper for library rows. */
export function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}
