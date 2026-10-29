import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useConversationDetail } from '@/features/conversation/hooks/useConversationDetail';
import type { ConversationMessage, ConversationMessagePage } from '@/features/conversation/types';
import { invoke } from '@/testing/tauriCore';

const mockInvoke = vi.mocked(invoke);

function message(seq: number, content: string): ConversationMessage {
  return { role: 'user', content, blocks: [], timestamp: seq, seq };
}

function page(items: ConversationMessage[]): ConversationMessagePage {
  return { items, total: items.length, offset: 0, limit: items.length, hasMore: false };
}

describe('useConversationDetail', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('loads the full transcript through the paged API', async () => {
    mockInvoke.mockResolvedValue(page([message(0, 'hello')]));

    const { result } = renderHook(() => useConversationDetail('pi:s1'));

    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    expect(result.current.messages[0].content).toBe('hello');
    expect(result.current.loading).toBe(false);
    expect(mockInvoke).toHaveBeenCalledWith('get_conversation_messages', {
      id: 'pi:s1',
      offset: 0,
    });
  });

  it('drops the result of a superseded load (conversation switched mid-flight)', async () => {
    let resolveFirst: (page: ConversationMessagePage) => void = () => {};
    mockInvoke
      .mockImplementationOnce(
        () => new Promise<ConversationMessagePage>((resolve) => (resolveFirst = resolve)),
      )
      .mockResolvedValueOnce(page([message(1, 'second')]));

    const { result, rerender } = renderHook(({ id }: { id: string }) => useConversationDetail(id), {
      initialProps: { id: 'pi:first' },
    });

    rerender({ id: 'pi:second' });
    await waitFor(() => expect(result.current.messages[0]?.content).toBe('second'));

    // 迟到的旧请求不得覆盖新会话的正文
    await act(async () => {
      resolveFirst(page([message(0, 'stale')]));
      await Promise.resolve();
    });
    expect(result.current.messages[0].content).toBe('second');
  });
});
