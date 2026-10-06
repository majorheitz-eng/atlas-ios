export type ConversationPhase = 'idle' | 'listening' | 'thinking' | 'speaking';
export type MessageStatus = 'pending' | 'sent' | 'failed';

export type ConversationMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  status: MessageStatus;
};

export type ConversationState = {
  phase: ConversationPhase;
  transcript: string;
  messages: ConversationMessage[];
  error: string | null;
};

export type ConversationAction =
  | { type: 'LISTENING_STARTED' }
  | { type: 'LISTENING_STOPPED' }
  | { type: 'TRANSCRIPT_CHANGED'; text: string }
  | { type: 'UTTERANCE_SUBMITTED'; id: string; text: string; createdAt: string }
  | { type: 'RESPONSE_RECEIVED'; replyId: string; requestId: string; text: string; createdAt: string }
  | { type: 'REQUEST_FAILED'; requestId: string; error: string }
  | { type: 'SPEECH_FINISHED' }
  | { type: 'ERROR_CLEARED' }
  | { type: 'HISTORY_LOADED'; messages: ConversationMessage[] }
  | { type: 'CLEAR_HISTORY' };

export const initialConversationState: ConversationState = {
  phase: 'idle',
  transcript: '',
  messages: [],
  error: null,
};

export function conversationReducer(
  state: ConversationState,
  action: ConversationAction,
): ConversationState {
  switch (action.type) {
    case 'LISTENING_STARTED':
      return { ...state, phase: 'listening', transcript: '', error: null };
    case 'LISTENING_STOPPED':
      return { ...state, phase: 'idle' };
    case 'TRANSCRIPT_CHANGED':
      return { ...state, transcript: action.text };
    case 'UTTERANCE_SUBMITTED':
      return {
        ...state,
        phase: 'thinking',
        transcript: '',
        error: null,
        messages: [
          ...state.messages,
          {
            id: action.id,
            role: 'user',
            content: action.text.trim(),
            createdAt: action.createdAt,
            status: 'pending',
          },
        ],
      };
    case 'RESPONSE_RECEIVED':
      return {
        ...state,
        phase: 'speaking',
        error: null,
        messages: [
          ...state.messages.map((message) =>
            message.id === action.requestId ? { ...message, status: 'sent' as const } : message,
          ),
          {
            id: action.replyId,
            role: 'assistant',
            content: action.text,
            createdAt: action.createdAt,
            status: 'sent',
          },
        ],
      };
    case 'REQUEST_FAILED':
      return {
        ...state,
        phase: 'idle',
        error: action.error,
        messages: state.messages.map((message) =>
          message.id === action.requestId ? { ...message, status: 'failed' as const } : message,
        ),
      };
    case 'SPEECH_FINISHED':
      return { ...state, phase: 'idle' };
    case 'ERROR_CLEARED':
      return { ...state, error: null };
    case 'HISTORY_LOADED':
      return { ...state, messages: action.messages };
    case 'CLEAR_HISTORY':
      return { ...state, messages: [], transcript: '', error: null, phase: 'idle' };
  }
}
