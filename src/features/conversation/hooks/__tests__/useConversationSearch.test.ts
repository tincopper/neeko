import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ConversationMessage } from '../types';
import { useConversationSearch } from '../useConversationSearch';

function msg(overrides: Partial<ConversationMessage>): ConversationMessage {
  return {
    seq: 0,
    role: 'user',
    timestamp: 1700000000000,
    model: null,
    content: '',
    blocks: null,
    ...overrides,
  };
}

const messages: ConversationMessage[] = [
  msg({ seq: 0, role: 'user', content: 'auth setup' }),
  msg({ seq: 1, role: 'assistant', content: 'auth caching strategy' }),
  msg({ seq: 2, role: 'user', content: 'no match here' }),
  msg({ seq: 3, role: 'assistant', content: 'more auth details' }),
];

describe('useConversationSearch', () => {
  it('returns no matches for empty query', () => {
    const { result } = renderHook(() => useConversationSearch(messages));
    expect(result.current.matches).toEqual([]);
    expect(result.current.current).toBe(-1);
  });

  it('finds matching indices and tracks current', () => {
    const { result } = renderHook(() => useConversationSearch(messages));
    act(() => result.current.setQuery('auth'));
    expect(result.current.matches).toEqual([0, 1, 3]);
    expect(result.current.current).toBe(0);
    expect(result.current.activeIndex).toBe(0);
  });

  it('navigates next/prev with wrapping', () => {
    const { result } = renderHook(() => useConversationSearch(messages));
    act(() => result.current.setQuery('auth'));
    act(() => result.current.goToNext());
    expect(result.current.current).toBe(1);
    act(() => result.current.goToNext());
    expect(result.current.current).toBe(3);
    // wrap around
    act(() => result.current.goToNext());
    expect(result.current.current).toBe(0);
    // wrap backwards
    act(() => result.current.goToPrev());
    expect(result.current.current).toBe(3);
  });

  it('resets current index when query changes', () => {
    const { result } = renderHook(() => useConversationSearch(messages));
    act(() => result.current.setQuery('auth'));
    act(() => result.current.goToNext());
    expect(result.current.current).toBe(1);
    // query change jumps back to the first match of the new query
    act(() => result.current.setQuery('no match here'));
    expect(result.current.matches).toEqual([2]);
    expect(result.current.current).toBe(2);
  });

  it('clears query via clear()', () => {
    const { result } = renderHook(() => useConversationSearch(messages));
    act(() => result.current.setQuery('auth'));
    act(() => result.current.clear());
    expect(result.current.query).toBe('');
    expect(result.current.matches).toEqual([]);
    expect(result.current.current).toBe(-1);
  });
});
