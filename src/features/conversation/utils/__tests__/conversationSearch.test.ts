import { describe, expect, it } from 'vitest';

import { findMessageMatches } from '../conversationSearch';
import type { ConversationMessage } from '../types';

function msg(overrides: Partial<ConversationMessage>): ConversationMessage {
  return {
    seq: 0,
    role: 'user',
    timestamp: 1700000000000,
    model: null,
    content: '',
    blocks: null,
    ...overrides,
  };
}

describe('findMessageMatches', () => {
  const messages: ConversationMessage[] = [
    msg({ seq: 0, role: 'user', content: 'How to optimize auth?' }),
    msg({ seq: 1, role: 'assistant', content: 'Use caching for auth tokens.' }),
    msg({ seq: 2, role: 'user', content: 'What about rate limiting?' }),
  ];

  it('returns empty for empty query', () => {
    expect(findMessageMatches(messages, '')).toEqual([]);
    expect(findMessageMatches(messages, '   ')).toEqual([]);
  });

  it('returns matching message indices (case-insensitive)', () => {
    expect(findMessageMatches(messages, 'auth')).toEqual([0, 1]);
  });

  it('matches against text blocks too', () => {
    const withBlock: ConversationMessage[] = [
      ...messages,
      msg({
        seq: 3,
        role: 'assistant',
        content: '',
        blocks: [{ type: 'text', text: 'Remember to rotate auth keys.' }],
      }),
    ];
    expect(findMessageMatches(withBlock, 'rotate')).toEqual([3]);
  });

  it('returns empty when nothing matches', () => {
    expect(findMessageMatches(messages, 'zzz')).toEqual([]);
  });
});
