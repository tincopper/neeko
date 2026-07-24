import { describe, expect, it } from 'vitest';
import {
  CONVERSATION_TAB_TITLE_MAX_CHARS,
  conversationTabTitle,
} from '../utils/conversationTabTitle';

describe('conversationTabTitle', () => {
  it('prefers userTitle over title', () => {
    expect(
      conversationTabTitle({
        userTitle: 'My short name',
        title: 'A much longer generated title from first user message',
        agentId: 'claude',
      }),
    ).toBe('My short name');
  });

  it('truncates long titles with ellipsis', () => {
    const long = 'x'.repeat(CONVERSATION_TAB_TITLE_MAX_CHARS + 20);
    const label = conversationTabTitle({ title: long });
    expect(label.endsWith('...')).toBe(true);
    expect(Array.from(label).length).toBe(CONVERSATION_TAB_TITLE_MAX_CHARS);
  });

  it('keeps short titles intact', () => {
    expect(conversationTabTitle({ title: 'Login bug' })).toBe('Login bug');
  });

  it('falls back to agentId then Conversation', () => {
    expect(conversationTabTitle({ agentId: 'codex' })).toBe('codex');
    expect(conversationTabTitle({})).toBe('Conversation');
  });
});
