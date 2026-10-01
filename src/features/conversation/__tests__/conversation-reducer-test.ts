import { conversationReducer, initialConversationState } from '@/features/conversation/conversation-reducer';

describe('conversationReducer', () => {
  it('moves a final transcript into a pending user message', () => {
    const listening = conversationReducer(initialConversationState, { type: 'LISTENING_STARTED' });
    const withPartial = conversationReducer(listening, { type: 'TRANSCRIPT_CHANGED', text: 'What is on my' });
    const pending = conversationReducer(withPartial, {
      type: 'UTTERANCE_SUBMITTED',
      id: 'user-1',
      text: 'What is on my calendar?',
      createdAt: '2026-10-01T16:30:00.000Z',
    });

    expect(pending.phase).toBe('thinking');
    expect(pending.transcript).toBe('');
    expect(pending.messages.at(-1)).toMatchObject({
      id: 'user-1',
      role: 'user',
      content: 'What is on my calendar?',
      status: 'pending',
    });
  });

  it('marks the user message sent and appends Atlas reply', () => {
    const pending = conversationReducer(initialConversationState, {
      type: 'UTTERANCE_SUBMITTED',
      id: 'user-1',
      text: 'Hello Atlas',
      createdAt: '2026-10-01T16:30:00.000Z',
    });
    const answered = conversationReducer(pending, {
      type: 'RESPONSE_RECEIVED',
      replyId: 'atlas-1',
      requestId: 'user-1',
      text: 'I am here, Major.',
      createdAt: '2026-10-01T16:30:01.000Z',
    });

    expect(answered.phase).toBe('speaking');
    expect(answered.messages).toEqual([
      expect.objectContaining({ id: 'user-1', status: 'sent' }),
      expect.objectContaining({ id: 'atlas-1', role: 'assistant', content: 'I am here, Major.' }),
    ]);
  });

  it('returns to idle with a retryable failed message when transport fails', () => {
    const pending = conversationReducer(initialConversationState, {
      type: 'UTTERANCE_SUBMITTED',
      id: 'user-1',
      text: 'Turn on the lights',
      createdAt: '2026-10-01T16:30:00.000Z',
    });
    const failed = conversationReducer(pending, {
      type: 'REQUEST_FAILED',
      requestId: 'user-1',
      error: 'Atlas bridge is offline',
    });

    expect(failed.phase).toBe('idle');
    expect(failed.error).toBe('Atlas bridge is offline');
    expect(failed.messages[0].status).toBe('failed');
  });
});
