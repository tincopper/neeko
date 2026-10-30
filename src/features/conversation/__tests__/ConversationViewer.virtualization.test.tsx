import { render, screen, waitFor } from '@testing-library/react';
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
        content: `assistant reply ${i}`,
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
  mockInvoke.mockImplementation(async (cmd: string, args?: { query?: string }) => {
    if (cmd === 'get_conversation_messages')
      // 正文按页传输（红线 4）：单页覆盖全部消息，hasMore=false
      return { items: makeMessages(120), total: 120, offset: 0, limit: 120, hasMore: false };
    if (cmd === 'get_conversation_stats')
      return {
        totalMessages: 120,
        toolCalls: 0,
        thinkingCount: 0,
        uniqueTools: [],
        toolCallList: [],
        toolCallListTruncated: false,
      };
    if (cmd === 'search_conversation_messages') {
      // 与旧客户端实现等价：命中所有含 "reply" 的助手消息
      return makeMessages(120)
        .filter((m) => m.content.includes(args?.query ?? ''))
        .map((m) => ({ seq: m.seq, role: m.role, snippet: m.content }));
    }
    if (cmd === 'copy_conversation_markdown') return 123;
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

describe('ConversationViewer virtualization', () => {
  it('renders only a subset of groups for a long transcript', async () => {
    const { container } = render(
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
      expect(screen.getByText(/user message 0/)).toBeInTheDocument();
    });

    // 120 messages → ~90 groups; virtualized DOM must mount far fewer rows.
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- data 属性行数统计，查询 API 无法表达
    const groupRows = container.querySelectorAll('[data-group-row]');
    expect(groupRows.length).toBeGreaterThan(0);
    expect(groupRows.length).toBeLessThan(90);
  });

  it('消息滚动区声明 center 补偿（居中于整个盒子）', async () => {
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
      expect(screen.getByText(/user message 0/)).toBeInTheDocument();
    });

    // 滚动元素归 VirtualList 所有 ⇒ 补偿模式以 prop 下传，落地为 data 标记
    //（实际内边调整在 useScrollbarCompensation 内，见 scrollbarCompensation.test.ts）
    // eslint-disable-next-line testing-library/no-node-access -- 结构关系断言（滚动祖先）
    const scroller = screen.getByText(/user message 0/).closest('[data-scrollbar-compensation]');
    expect(scroller).toHaveAttribute('data-scrollbar-compensation', 'center');
  });
});
