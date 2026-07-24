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
    expect(result.current.refreshing).toBe(false);
  });

  it('starts in loading when active with a project (skeleton spine)', () => {
    mockInvoke.mockImplementation(async () => new Promise(() => {}));
    const { result } = renderHook(() => useConversationList('/tmp/project', true));
    expect(result.current.loading).toBe(true);
  });

  it('hydrates list before scan completes (fishbone)', async () => {
    const mockList: ConversationMeta[] = [
      createMeta('claude-code:1', { startedAt: 1000 }),
      createMeta('gemini:2', { startedAt: 2000 }),
    ];

    let resolveScan: (v: unknown) => void = () => {};
    const scanPromise = new Promise((resolve) => {
      resolveScan = resolve;
    });

    let listCalls = 0;
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_conversations') {
        listCalls += 1;
        return mockList;
      }
      if (cmd === 'scan_conversations') {
        await scanPromise;
        return [{ agent_id: 'claude-code', sessions_found: 1, errors: [] }];
      }
      return undefined;
    });

    const { result } = renderHook(() => useConversationList('/tmp/project', true));

    // After first list (hydrate), rows are visible while scan still pending.
    await waitFor(() => {
      expect(result.current.conversations).toHaveLength(2);
    });
    expect(result.current.refreshing).toBe(true);
    expect(result.current.loading).toBe(false);
    expect(listCalls).toBeGreaterThanOrEqual(1);

    // Order: list first, then scan (not scan-then-list).
    const cmds = mockInvoke.mock.calls.map(([c]) => c);
    const firstList = cmds.indexOf('list_conversations');
    const firstScan = cmds.indexOf('scan_conversations');
    expect(firstList).toBeGreaterThanOrEqual(0);
    expect(firstScan).toBeGreaterThan(firstList);

    resolveScan([{ agent_id: 'claude-code', sessions_found: 1, errors: [] }]);

    await waitFor(() => {
      expect(result.current.refreshing).toBe(false);
    });
    expect(result.current.conversations).toHaveLength(2);
  });

  it('keeps loading true when hydrate is empty until scan finishes', async () => {
    let resolveScan: (v: unknown) => void = () => {};
    const scanPromise = new Promise((resolve) => {
      resolveScan = resolve;
    });

    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_conversations') return [];
      if (cmd === 'scan_conversations') {
        await scanPromise;
        return [];
      }
      return undefined;
    });

    const { result } = renderHook(() => useConversationList('/tmp/project', true));

    await waitFor(() => {
      expect(result.current.refreshing).toBe(true);
    });
    // Empty cache: stay in hard-loading so UI shows skeleton, not "No conversations yet".
    expect(result.current.conversations).toEqual([]);
    expect(result.current.loading).toBe(true);

    resolveScan([]);

    await waitFor(() => {
      expect(result.current.refreshing).toBe(false);
      expect(result.current.loading).toBe(false);
    });
  });

  it('filters by agentId when provided', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'scan_conversations') return [];
      if (cmd === 'list_conversations') return [];
      return undefined;
    });

    renderHook(() => useConversationList('/tmp/project', true, 'claude-code'));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('scan_conversations', { agentId: 'claude-code' });
      expect(mockInvoke).toHaveBeenCalledWith('list_conversations', {
        projectPath: '/tmp/project',
        agentId: 'claude-code',
      });
    });
  });

  it('forceRefresh re-scans even within throttle window', async () => {
    const firstList: ConversationMeta[] = [createMeta('claude-code:1')];
    const secondList: ConversationMeta[] = [
      createMeta('claude-code:1'),
      createMeta('gemini:2'),
    ];

    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'scan_conversations') return [];
      if (cmd === 'list_conversations') {
        const calls = mockInvoke.mock.calls.filter(([c]) => c === 'list_conversations').length;
        return calls <= 2 ? firstList : secondList;
      }
      return undefined;
    });

    const { result } = renderHook(() => useConversationList('/tmp/project', true));

    await waitFor(() => {
      expect(result.current.refreshing).toBe(false);
      expect(result.current.conversations).toHaveLength(1);
    });

    await act(async () => {
      await result.current.forceRefresh();
    });

    expect(result.current.conversations).toHaveLength(2);
  });

  it('keeps previous rows when scan fails after hydrate', async () => {
    const mockList: ConversationMeta[] = [createMeta('claude-code:1')];
    let listCalls = 0;

    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_conversations') {
        listCalls += 1;
        return mockList;
      }
      if (cmd === 'scan_conversations') {
        throw new Error('scan boom');
      }
      return undefined;
    });

    const { result } = renderHook(() => useConversationList('/tmp/project', true));

    await waitFor(() => {
      expect(result.current.refreshing).toBe(false);
    });

    expect(result.current.conversations).toHaveLength(1);
    expect(result.current.error).toMatch(/scan boom/);
    expect(listCalls).toBeGreaterThanOrEqual(1);
  });

  it('handles total invoke failure with empty list when no prior rows', async () => {
    mockInvoke.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useConversationList('/tmp/project', true));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.refreshing).toBe(false);
    });

    expect(result.current.conversations).toEqual([]);
    expect(result.current.error).toBeTruthy();
  });

  it('does not load when isActive is false', () => {
    renderHook(() => useConversationList('/tmp/project', false));

    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
