import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ConversationViewer from '@/features/conversation/components/ConversationViewer';
import type { ConversationMessage } from '@/features/conversation/types';
import { createAppProviderWrapper } from '@/testing/AppProviderTestUtils';
import { invoke } from '@/testing/tauriCore';

const mockInvoke = vi.mocked(invoke);

function makeMessages(count: number): ConversationMessage[] {
  const msgs: ConversationMessage[] = [];
  for (let i = 0; i < count; i++) {
    if (i % 2 === 0) {
      msgs.push({
        seq: i,
        role: 'user',
        timestamp: 1700000000000 + i * 1000,
        model: null,
        content: `user message ${i}`,
        blocks: null,
      });
    } else {
      msgs.push({
        seq: i,
        role: 'assistant',
        timestamp: 1700000000000 + i * 1000,
        model: 'claude-sonnet',
        content: `assistant reply ${i}`, // each assistant msg contains "reply"
        blocks: null,
      });
    }
  }
  return msgs;
}

const origH = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
const origW = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');

beforeEach(() => {
  mockInvoke.mockReset();
  mockInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === 'get_conversation_messages') return makeMessages(40);
    if (cmd === 'export_conversation') return '# export';
    return undefined;
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get: () => 600,
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get: () => 800,
  });
});

afterEach(() => {
  if (origH) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', origH);
  if (origW) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', origW);
});

describe('ConversationViewer in-session search', () => {
  it('shows match counter and navigates results', async () => {
    render(
      <ConversationViewer
        conversationId="claude-code:abc"
        agentId="claude-code"
        onBack={() => {}}
        onResume={() => {}}
        showToast={() => {}}
      />,
      { wrapper: createAppProviderWrapper() },
    );

    await waitFor(() => {
      expect(screen.getByText(/user message 4/)).toBeInTheDocument();
    });

    const openSearchBtn = screen.getByRole('button', { name: /search in conversation/i });
    fireEvent.click(openSearchBtn);

    const searchBox = screen.getByPlaceholderText(/search/i);
    fireEvent.change(searchBox, { target: { value: 'reply' } });

    // 40 messages → 20 assistant "reply" matches.
    await waitFor(() => {
      expect(screen.getByTestId('search-count')).toHaveTextContent('1 / 20');
    });

    const nextBtn = screen.getByRole('button', { name: /next match/i });
    fireEvent.click(nextBtn);
    expect(screen.getByTestId('search-count')).toHaveTextContent('2 / 20');
  });
});
