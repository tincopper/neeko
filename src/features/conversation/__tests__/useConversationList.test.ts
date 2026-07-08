import { invoke } from '@tauri-apps/api/core';
import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useConversationList } from '@/features/conversation/hooks/useConversationList';
import type { ConversationMeta } from '@/features/conversation/types';

const mockInvoke = vi.mocked(invoke);

function createMeta(id: string, overrides: Partial<ConversationMeta> = {}): ConversationMeta {
  return {
    id,
    nativeSessionId: id.split(':')[1] ?? id,
    agentId: id.split(':')[0] ?? 'unknown',
    title: `Conversation ${id}`,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    messageCount: 5,
    preview: 'A preview of the conversation',
    filePath: `/tmp/sessions/${id}.json`,
    projectPath: '/tmp/project',
    userTitle: null,
    tags: [],
    ...overrides,
  };
}

describe('useConversationList', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('returns empty array when projectPath is null', () => {
    const { result } = renderHook(() => useConversationList(null, true));

    expect(result.current.conversations).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('calls scan and list on mount when isActive and projectPath are provided', async () => {
    const mockList: ConversationMeta[] = [
      createMeta('claude-code:1', { startedAt: 1000 }),
      createMeta('gemini:2', { startedAt: 2000 }),
    ];

    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'scan_conversations') return [{ agent_id: 'claude-code', sessions_found: 1, errors: [] }];
      if (cmd === 'list_conversations') return mockList;
      return undefined;
    });

    const { result } = renderHook(() => useConversationList('/tmp/project', true));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.conversations).toHaveLength(2);
    expect(mockInvoke).toHaveBeenCalledWith('scan_conversations', { agentId: undefined });
    expect(mockInvoke).toHaveBeenCalledWith('list_conversations', { projectPath: '/tmp/project', agentId: undefined });
  });

  it('filters by agentId when provided', async () => {
    mockInvoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === 'scan_conversations') return [];
      if (cmd === 'list_conversations') return [];
      return undefined;
    });

    renderHook(() => useConversationList('/tmp/project', true, 'claude-code'));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('scan_conversations', { agentId: 'claude-code' });
      expect(mockInvoke).toHaveBeenCalledWith('list_conversations', { projectPath: '/tmp/project', agentId: 'claude-code' });
    });
  });

  it('refresh function re-fetches conversations', async () => {
    const firstList: ConversationMeta[] = [createMeta('claude-code:1')];
    const secondList: ConversationMeta[] = [
      createMeta('claude-code:1'),
      createMeta('gemini:2'),
    ];

    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'scan_conversations') return [];
      if (cmd === 'list_conversations') {
        // Return different data on subsequent calls
        const calls = mockInvoke.mock.calls.filter(([c]) => c === 'list_conversations').length;
        return calls <= 1 ? firstList : secondList;
      }
      return undefined;
    });

    const { result } = renderHook(() => useConversationList('/tmp/project', true));

    await waitFor(() => {
      expect(result.current.conversations).toHaveLength(1);
    });

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.conversations).toHaveLength(2);
  });

  it('handles invoke errors gracefully', async () => {
    mockInvoke.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useConversationList('/tmp/project', true));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.conversations).toEqual([]);
  });

  it('does not load when isActive is false', () => {
    renderHook(() => useConversationList('/tmp/project', false));

    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
