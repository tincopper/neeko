import { describe, expect, it } from 'vitest';

import type { ConversationMessage } from '../../types';
import { messageToText } from '../messageToText';

function msg(overrides: Partial<ConversationMessage>): ConversationMessage {
  return { role: 'assistant', content: '', blocks: [], timestamp: 0, seq: 0, ...overrides };
}

describe('messageToText', () => {
  it('returns the content string when no blocks', () => {
    const m = msg({ content: 'plain text' });
    expect(messageToText(m)).toBe('plain text');
  });

  it('joins text blocks', () => {
    const m = msg({
      blocks: [
        { type: 'text', text: 'hello ' },
        { type: 'text', text: 'world' },
      ],
    });
    expect(messageToText(m)).toBe('hello world');
  });

  it('includes thinking block content in a labeled section', () => {
    const m = msg({
      blocks: [{ type: 'thinking', thinking: 'deep thought' }],
    });
    expect(messageToText(m)).toContain('deep thought');
    expect(messageToText(m)).toContain('Thinking');
  });

  it('includes tool use name and input summary', () => {
    const m = msg({
      blocks: [
        { type: 'toolUse', id: 't1', name: 'Bash', input: { command: 'ls -la' } },
        { type: 'toolResult', toolUseId: 't1', content: 'output', isError: false },
      ],
    });
    const text = messageToText(m);
    expect(text).toContain('Bash');
    expect(text).toContain('ls -la');
    expect(text).toContain('output');
  });

  it('marks error results', () => {
    const m = msg({
      blocks: [
        { type: 'toolUse', id: 't1', name: 'Read', input: { file_path: 'a.ts' } },
        { type: 'toolResult', toolUseId: 't1', content: 'not found', isError: true },
      ],
    });
    expect(messageToText(m)).toContain('Error');
  });

  it('returns empty string for empty message', () => {
    expect(messageToText(msg({}))).toBe('');
  });
});
