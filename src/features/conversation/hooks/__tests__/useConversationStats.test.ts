import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useConversationStats } from '@/features/conversation/hooks/useConversationStats';
import type { ConversationStats } from '@/features/conversation/types';
import { invoke } from '@/testing/tauriCore';

const mockInvoke = vi.mocked(invoke);

const stats: ConversationStats = {
  totalMessages: 42,
  toolCalls: 3,
  thinkingCount: 1,
  uniqueTools: ['Bash', 'Read'],
  toolCallList: [{ seq: 7, blockIdx: 1, name: 'Bash', summary: 'pnpm test' }],
  toolCallListTruncated: false,
};

describe('useConversationStats', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('loads stats from the backend', async () => {
    mockInvoke.mockResolvedValue(stats);

    const { result } = renderHook(() => useConversationStats('pi:s1'));

    await waitFor(() => expect(result.current.totalMessages).toBe(42));
    expect(result.current.toolCallList[0].summary).toBe('pnpm test');
    expect(mockInvoke).toHaveBeenCalledWith('get_conversation_stats', { id: 'pi:s1' });
  });

  it('returns empty stats without a conversation id', async () => {
    const { result } = renderHook(() => useConversationStats(null));

    await waitFor(() => expect(result.current.totalMessages).toBe(0));
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('does not show the previous conversation stats while the next one loads', async () => {
    let resolveSecond: (value: ConversationStats) => void = () => {};
    mockInvoke
      .mockResolvedValueOnce(stats)
      .mockImplementationOnce(
        () => new Promise<ConversationStats>((resolve) => (resolveSecond = resolve)),
      );

    const { result, rerender } = renderHook(({ id }: { id: string }) => useConversationStats(id), {
      initialProps: { id: 'pi:first' },
    });
    await waitFor(() => expect(result.current.totalMessages).toBe(42));

    rerender({ id: 'pi:second' });
    // 新会话数据未到之前不能沿用旧数字
    expect(result.current.totalMessages).toBe(0);

    await act(async () => {
      resolveSecond({ ...stats, totalMessages: 7 });
      await Promise.resolve();
    });
    expect(result.current.totalMessages).toBe(7);
  });

  it('falls back to empty stats when the command fails', async () => {
    mockInvoke.mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useConversationStats('pi:s2'));

    await waitFor(() => expect(mockInvoke).toHaveBeenCalled());
    expect(result.current.totalMessages).toBe(0);
    expect(result.current.toolCallList).toEqual([]);
  });
});
