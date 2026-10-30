import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ConversationViewer from '@/features/conversation/components/ConversationViewer';
import type { ConversationMessage } from '@/features/conversation/types';
import { createAppProviderWrapper } from '@/testing/AppProviderTestUtils';
import { invoke } from '@/testing/tauriCore';

const mockInvoke = vi.mocked(invoke);

function allMessages(count: number): ConversationMessage[] {
  return Array.from({ length: count }, (_, i) => ({
    seq: i,
    role: i % 2 === 0 ? 'user' : 'assistant',
    timestamp: 1_700_000_000_000 + i,
    model: null,
    content: `message ${i}`,
    blocks: [],
  }));
}

const ALL = allMessages(100);

const origH = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
const origW = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');

beforeEach(() => {
  mockInvoke.mockReset();
  mockInvoke.mockImplementation(
    async (cmd: string, args?: { offset?: number; fromEnd?: boolean }) => {
      if (cmd === 'get_conversation_messages') {
        // 尾页（offset=0 且 fromEnd）→ 后 50 条；再向上取一页 → 前 50 条
        if (args?.fromEnd && (args.offset ?? 0) === 0) {
          return { items: ALL.slice(50), total: 100, offset: 50, limit: 50, hasMore: true };
        }
        return { items: ALL.slice(0, 50), total: 100, offset: 0, limit: 50, hasMore: false };
      }
      if (cmd === 'get_conversation_stats') {
        return {
          totalMessages: 100,
          toolCalls: 0,
          thinkingCount: 0,
          uniqueTools: [],
          toolCallList: [],
        };
      }
      if (cmd === 'search_conversation_messages')
        // 命中一条窗口外的旧消息（seq 10），用于验证「按 seq 加载定位页」
        return args?.query ? [{ seq: 10, role: 'user', snippet: 'message 10' }] : [];
      return undefined;
    },
  );
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

describe('ConversationViewer on-demand paging', () => {
  it('loads the page containing a search hit that is outside the window', async () => {
    render(
      <ConversationViewer
        conversationId="pi:jump"
        agentId="pi"
        onBack={() => {}}
        onResume={() => {}}
        showToast={() => {}}
      />,
      { wrapper: createAppProviderWrapper() },
    );

    // 首屏只有尾页
    expect(await screen.findByText(/message 50/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /search in conversation/i }));
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'message' } });

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('search_conversation_messages', {
        id: 'pi:jump',
        query: 'message',
      }),
    );
    // 命中 seq=10 不在窗口内 → 必须按 seq 取定位页（offset = total - seq - 1）
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('get_conversation_messages', {
        id: 'pi:jump',
        offset: 89,
        fromEnd: true,
      }),
    );
    // 命中状态同步给搜索计数器（jsdom 里无法断言虚拟列表滚动位置）
    await waitFor(() => expect(screen.getByTestId('search-count')).toHaveTextContent('1 / 1'));
  });

  it('loads the newest page first and pulls older pages on demand', async () => {
    render(
      <ConversationViewer
        conversationId="pi:paged"
        agentId="pi"
        onBack={() => {}}
        onResume={() => {}}
        showToast={() => {}}
      />,
      { wrapper: createAppProviderWrapper() },
    );

    // 首屏只要尾页：最新消息在，最早的不在
    expect(await screen.findByText(/message 50/)).toBeInTheDocument();
    expect(screen.queryByText(/message 0$/)).not.toBeInTheDocument();
    expect(mockInvoke).toHaveBeenCalledWith('get_conversation_messages', {
      id: 'pi:paged',
      offset: 0,
      fromEnd: true,
    });

    fireEvent.click(screen.getByRole('button', { name: /load older messages/i }));

    expect(await screen.findByText(/message 0$/)).toBeInTheDocument();
    // 拉完更早的页后按钮消失（窗口已到会话开头）
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: /load older messages/i }),
      ).not.toBeInTheDocument(),
    );
  });
});
