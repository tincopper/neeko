import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  copyConversationMarkdown,
  getConversationMessages,
  getConversationMessagesPage,
  getConversationStats,
  searchConversationMessages,
} from '@/features/conversation/api/conversationApi';
import type { ConversationMessage, ConversationMessagePage } from '@/features/conversation/types';
import { invoke } from '@/testing/tauriCore';

const mockInvoke = vi.mocked(invoke);

function msg(seq: number): ConversationMessage {
  return {
    role: seq % 2 === 0 ? 'user' : 'assistant',
    content: `m${seq}`,
    blocks: [],
    timestamp: 1_700_000_000_000 + seq,
    seq,
  };
}

function page(offset: number, count: number, total: number): ConversationMessagePage {
  const items = Array.from({ length: count }, (_, i) => msg(offset + i));
  return {
    items,
    total,
    offset,
    limit: count,
    hasMore: offset + count < total,
  };
}

describe('conversationApi paging (红线 4：单次 IPC 载荷受预算约束)', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('assembles the full transcript from paged calls', async () => {
    mockInvoke
      .mockResolvedValueOnce(page(0, 3, 7))
      .mockResolvedValueOnce(page(3, 3, 7))
      .mockResolvedValueOnce(page(6, 1, 7));

    const messages = await getConversationMessages('pi:s1');

    expect(messages.map((m) => m.seq)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(mockInvoke).toHaveBeenCalledTimes(3);
    expect(mockInvoke).toHaveBeenNthCalledWith(1, 'get_conversation_messages', {
      id: 'pi:s1',
      offset: 0,
      fromEnd: false,
    });
    expect(mockInvoke).toHaveBeenNthCalledWith(2, 'get_conversation_messages', {
      id: 'pi:s1',
      offset: 3,
      fromEnd: false,
    });
    expect(mockInvoke).toHaveBeenNthCalledWith(3, 'get_conversation_messages', {
      id: 'pi:s1',
      offset: 6,
      fromEnd: false,
    });
  });

  it('stops after a single page when the backend reports no more', async () => {
    mockInvoke.mockResolvedValueOnce(page(0, 2, 2));

    const messages = await getConversationMessages('pi:s2');

    expect(messages).toHaveLength(2);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it('does not loop forever on an empty page that claims more', async () => {
    mockInvoke.mockResolvedValueOnce(page(0, 0, 5));

    const messages = await getConversationMessages('pi:s3');

    expect(messages).toEqual([]);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it('requests the tail page when fromEnd is set', async () => {
    mockInvoke.mockResolvedValueOnce(page(700, 100, 800));

    await getConversationMessagesPage('pi:s5', 0, { fromEnd: true });

    expect(mockInvoke).toHaveBeenCalledWith('get_conversation_messages', {
      id: 'pi:s5',
      offset: 0,
      fromEnd: true,
    });
  });

  it('exposes backend stats and search primitives', async () => {
    mockInvoke
      .mockResolvedValueOnce({
        totalMessages: 2,
        toolCalls: 0,
        thinkingCount: 0,
        uniqueTools: [],
        toolCallList: [],
        toolCallListTruncated: false,
      })
      .mockResolvedValueOnce([{ seq: 1, role: 'assistant', snippet: 'rotate the key' }])
      .mockResolvedValueOnce(123);

    await getConversationStats('pi:s6');
    const hits = await searchConversationMessages('pi:s6', 'rotate');
    const chars = await copyConversationMarkdown('pi:s6');

    expect(hits[0].seq).toBe(1);
    expect(chars).toBe(123);
    expect(mockInvoke).toHaveBeenNthCalledWith(1, 'get_conversation_stats', { id: 'pi:s6' });
    expect(mockInvoke).toHaveBeenNthCalledWith(2, 'search_conversation_messages', {
      id: 'pi:s6',
      query: 'rotate',
    });
    expect(mockInvoke).toHaveBeenNthCalledWith(3, 'copy_conversation_markdown', { id: 'pi:s6' });
  });

  it('exposes the page primitive for on-demand loading', async () => {
    mockInvoke.mockResolvedValueOnce(page(100, 5, 400));

    const result = await getConversationMessagesPage('pi:s4', 100);

    expect(result.hasMore).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith('get_conversation_messages', {
      id: 'pi:s4',
      offset: 100,
      fromEnd: false,
    });
  });
});
