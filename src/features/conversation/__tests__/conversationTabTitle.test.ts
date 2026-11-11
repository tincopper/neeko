// @vitest-environment node
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

  it('keeps only the backend-provided title chain (no invented fallbacks)', () => {
    // 兜底链只有 userTitle → title，两者都来自后端（wire 上 title 永远非空）。
    // 编一个 agentId / 'Conversation' 就是后端的影子副本，且让「后端没给」隐形。
    expect(conversationTabTitle({ userTitle: '  ', title: 'real' })).toBe('real');
    expect(conversationTabTitle({ title: 'claude-code · neeko' })).toBe('claude-code · neeko');
  });
});
