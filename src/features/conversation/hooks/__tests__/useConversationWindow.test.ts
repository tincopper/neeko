import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useConversationWindow } from '@/features/conversation/hooks/useConversationWindow';
import type { ConversationMessage } from '@/features/conversation/types';
import { invoke } from '@/testing/tauriCore';

const mockInvoke = vi.mocked(invoke);

function all(count: number): ConversationMessage[] {
  return Array.from({ length: count }, (_, i) => ({
    seq: i,
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `m${i}`,
    blocks: [],
    timestamp: i,
    model: null,
  }));
}

const ALL = all(100);

function pageEndingAt(end: number, size = 50) {
  const start = Math.max(0, end - size);
  return {
    items: ALL.slice(start, end),
    total: ALL.length,
    offset: start,
    limit: end - start,
    hasMore: start > 0,
  };
}

beforeEach(() => {
  mockInvoke.mockReset();
  mockInvoke.mockImplementation(
    async (_cmd: string, args?: { offset?: number; fromEnd?: boolean }) => {
      if (!args?.fromEnd) return pageEndingAt(ALL.length);
      return pageEndingAt(ALL.length - (args.offset ?? 0));
    },
  );
});

describe('useConversationWindow', () => {
  it('loads the tail page first, then prepends older pages', async () => {
    const { result } = renderHook(() => useConversationWindow('pi:w'));

    await waitFor(() => expect(result.current.messages).toHaveLength(50));
    expect(result.current.messages[0].seq).toBe(50);
    expect(result.current.hasEarlier).toBe(true);
    expect(result.current.hasLater).toBe(false);

    await act(async () => {
      await result.current.loadEarlier();
    });
    expect(result.current.messages).toHaveLength(100);
    expect(result.current.messages[0].seq).toBe(0);
    expect(result.current.hasEarlier).toBe(false);
  });

  /**
   * 回调用 ref 读最新窗口状态：否则每次翻页都会换掉 jumpToSeq 的引用，
   * 连带让视图里的搜索跳转 effect 反复重跑。
   */
  it('keeps jumpToSeq identity stable across page loads', async () => {
    const { result } = renderHook(() => useConversationWindow('pi:w'));
    await waitFor(() => expect(result.current.messages).toHaveLength(50));

    const before = result.current.jumpToSeq;
    await act(async () => {
      await result.current.loadEarlier();
    });
    expect(result.current.jumpToSeq).toBe(before);
  });

  it('returns the in-window index without refetching', async () => {
    const { result } = renderHook(() => useConversationWindow('pi:w'));
    await waitFor(() => expect(result.current.messages).toHaveLength(50));
    const callsBefore = mockInvoke.mock.calls.length;

    let idx = -1;
    await act(async () => {
      idx = await result.current.jumpToSeq(60);
    });
    expect(idx).toBe(10);
    expect(mockInvoke.mock.calls.length).toBe(callsBefore);
  });

  it('fetches the page holding an out-of-window seq', async () => {
    const { result } = renderHook(() => useConversationWindow('pi:w'));
    await waitFor(() => expect(result.current.messages).toHaveLength(50));

    let idx = -1;
    await act(async () => {
      idx = await result.current.jumpToSeq(10);
    });
    expect(idx).toBe(10);
    expect(mockInvoke).toHaveBeenCalledWith('get_conversation_messages', {
      id: 'pi:w',
      offset: 89,
      fromEnd: true,
    });
  });
});
