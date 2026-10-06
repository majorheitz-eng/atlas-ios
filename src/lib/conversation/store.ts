import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ConversationMessage } from '@/features/conversation/conversation-reducer';

/**
 * Persistence layer for the Atlas conversation history.
 *
 * Messages are stored as a single JSON array under STORAGE_KEY so the full
 * multi-turn transcript survives app restarts. The store is intentionally
 * tiny — it only knows how to read and write the array — so the screen can
 * decide when to persist (typically on every message change).
 */

const STORAGE_KEY = 'atlas.conversation.history';

export type StoredMessage = ConversationMessage;

/** Strip transient/pending messages so we never rehydrate a half-finished turn. */
function persistable(messages: ConversationMessage[]): StoredMessage[] {
  return messages
    .filter((m) => m.status !== 'pending')
    .map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt,
      status: m.status,
    }));
}

/** Load the saved conversation history, or an empty array if none exists. */
export async function loadConversation(): Promise<StoredMessage[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (m): m is StoredMessage =>
        m &&
        typeof m.id === 'string' &&
        (m.role === 'user' || m.role === 'assistant') &&
        typeof m.content === 'string' &&
        typeof m.createdAt === 'string' &&
        (m.status === 'pending' || m.status === 'sent' || m.status === 'failed'),
    );
  } catch {
    return [];
  }
}

/** Persist the given messages (pending entries are filtered out). */
export async function saveConversation(messages: ConversationMessage[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(persistable(messages)));
  } catch {
    // Persistence is best-effort; a failed write must never crash the chat.
  }
}

/** Wipe the saved conversation history. */
export async function clearConversation(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore — nothing to clear or nothing we can do.
  }
}
