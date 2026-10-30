import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useConversationSearch } from '@/features/conversation/hooks/useConversationSearch';
import type { ConversationSearchHit } from '@/features/conversation/types';
import { invoke } from '@/testing/tauriCore';

const mockInvoke = vi.mocked(invoke);

function hit(seq: number): ConversationSearchHit {
  return { seq, role: seq % 2 === 0 ? 'user' : 'assistant', snippet: `snippet ${seq}` };
}

describe('useConversationSearch (backend-backed)', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('does not query the backend for an empty query', async () => {
    const { result } = renderHook(() => useConversationSearch('pi:s1'));

    act(() => result.current.setQuery('   '));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });

    expect(result.current.hits).toEqual([]);
    expect(result.current.currentSeq).toBe(-1);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('stores backend hits and exposes the active hit seq', async () => {
    mockInvoke.mockResolvedValue([hit(0), hit(7), hit(9)]);

    const { result } = renderHook(() => useConversationSearch('pi:s1'));
    act(() => result.current.setQuery('rotate'));

    await waitFor(() => expect(result.current.hits).toHaveLength(3));
    expect(mockInvoke).toHaveBeenCalledWith('search_conversation_messages', {
      id: 'pi:s1',
      query: 'rotate',
    });
    expect(result.current.activeIndex).toBe(0);
    expect(result.current.currentSeq).toBe(0);
  });

  it('wraps next/prev navigation and resets on query change', async () => {
    mockInvoke.mockResolvedValue([hit(0), hit(7), hit(9)]);

    const { result } = renderHook(() => useConversationSearch('pi:s1'));
    act(() => result.current.setQuery('rotate'));
    await waitFor(() => expect(result.current.hits).toHaveLength(3));

    act(() => result.current.goToNext());
    expect(result.current.currentSeq).toBe(7);
    act(() => result.current.goToNext());
    act(() => result.current.goToNext());
    expect(result.current.activeIndex).toBe(0);
    act(() => result.current.goToPrev());
    expect(result.current.currentSeq).toBe(9);

    mockInvoke.mockResolvedValue([]);
    act(() => result.current.setQuery('again'));
    await waitFor(() => expect(result.current.hits).toHaveLength(0));
    expect(result.current.activeIndex).toBe(-1);
  });

  it('clears query and hits', async () => {
    mockInvoke.mockResolvedValue([hit(1)]);

    const { result } = renderHook(() => useConversationSearch('pi:s1'));
    act(() => result.current.setQuery('x'));
    await waitFor(() => expect(result.current.hits).toHaveLength(1));

    act(() => result.current.clear());
    expect(result.current.query).toBe('');
    expect(result.current.hits).toEqual([]);
  });
});
