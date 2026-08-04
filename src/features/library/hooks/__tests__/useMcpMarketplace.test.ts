import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import * as libraryApi from '@/features/library/api/libraryApi';
import type {
  McpRegistrySearchResult,
  McpRegistrySummary,
} from '@/features/library/api/libraryApi';
import { useMcpMarketplace } from '@/features/library/hooks/useMcpMarketplace';
import { useLibraryStore } from '@/features/library/store/libraryStore';
import { useMcpStore } from '@/features/library/store/mcpStore';

function makeSummary(name: string, title?: string): McpRegistrySummary {
  return {
    name,
    title: title ?? name,
    description: 'test server',
    version: '1.0.0',
    transports: ['stdio'],
    repository: null,
    stars: null,
    downloads: null,
    inputs: [],
    status: 'active',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

function makeSearchResult(
  servers: McpRegistrySummary[],
  nextCursor?: string | null,
): McpRegistrySearchResult {
  return { servers, nextCursor: nextCursor ?? null };
}

describe('useMcpMarketplace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMcpStore.setState({
      mcpServers: [],
      mcpView: 'installed',
      mcpDraft: null,
    });
    useLibraryStore.setState({
      searchQuery: '',
    });
  });

  it('loads initial data on mount', async () => {
    const mockSearch = vi
      .spyOn(libraryApi, 'searchMcpRegistry')
      .mockResolvedValue(makeSearchResult([makeSummary('com.example/fs')], 'cursor-2'));

    const { result } = renderHook(() => useMcpMarketplace());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mockSearch).toHaveBeenCalledWith('', 20, null);
    expect(result.current.displayList).toHaveLength(1);
    expect(result.current.hasNext).toBe(true);
  });

  it('matches installed servers by sourceRef', async () => {
    useMcpStore.setState({
      mcpServers: [
        {
          id: 'mcp-1' as any,
          name: 'Filesystem',
          sourceRef: 'com.example/fs',
          transport: 'stdio',
          scope: 'global',
          command: 'npx',
          args: [],
          env: {},
          tags: [],
          enabled: true,
          usageCount: 0,
          createdAt: 0,
          updatedAt: 0,
        },
      ],
    });

    vi.spyOn(libraryApi, 'searchMcpRegistry').mockResolvedValue(
      makeSearchResult([makeSummary('com.example/fs'), makeSummary('com.example/db')]),
    );

    const { result } = renderHook(() => useMcpMarketplace());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.isInstalled('com.example/fs')).toBe(true);
    expect(result.current.isInstalled('com.example/db')).toBe(false);
  });

  it('debounces search query', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const mockSearch = vi
      .spyOn(libraryApi, 'searchMcpRegistry')
      .mockResolvedValue(makeSearchResult([]));

    const { result } = renderHook(() => useMcpMarketplace());

    // Initial load completes
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockSearch).toHaveBeenCalledTimes(1);

    // Set search query
    act(() => {
      result.current.setSearchQuery('filesystem');
    });

    // Debounce has not fired yet
    expect(mockSearch).toHaveBeenCalledTimes(1);

    // Advance past debounce
    act(() => {
      vi.advanceTimersByTime(350);
    });

    await waitFor(() => {
      expect(mockSearch).toHaveBeenCalledTimes(2);
    });

    expect(mockSearch).toHaveBeenLastCalledWith('filesystem', 20, null);

    vi.useRealTimers();
  });

  it('advances cursor on next page', async () => {
    const mockSearch = vi
      .spyOn(libraryApi, 'searchMcpRegistry')
      .mockResolvedValueOnce(makeSearchResult([makeSummary('com.example/fs')], 'cursor-2'))
      .mockResolvedValueOnce(makeSearchResult([makeSummary('com.example/db')], 'cursor-3'));

    const { result } = renderHook(() => useMcpMarketplace());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mockSearch).toHaveBeenCalledWith('', 20, null);
    expect(result.current.displayList).toHaveLength(1);
    expect(result.current.hasNext).toBe(true);

    act(() => {
      result.current.nextPage();
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mockSearch).toHaveBeenCalledWith('', 20, 'cursor-2');
    expect(result.current.displayList).toHaveLength(1);
    expect(result.current.hasNext).toBe(true);
  });

  it('prevents going back before first page', async () => {
    vi.spyOn(libraryApi, 'searchMcpRegistry').mockResolvedValue(
      makeSearchResult([makeSummary('com.example/fs')]),
    );

    const { result } = renderHook(() => useMcpMarketplace());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.hasPrev).toBe(false);
  });

  it('goes back to previous page', async () => {
    vi.spyOn(libraryApi, 'searchMcpRegistry')
      .mockResolvedValueOnce(makeSearchResult([makeSummary('com.example/fs')], 'cursor-2'))
      .mockResolvedValueOnce(makeSearchResult([makeSummary('com.example/db')]));

    const { result } = renderHook(() => useMcpMarketplace());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.displayList).toHaveLength(1);
    expect(result.current.hasNext).toBe(true);

    // Go next
    act(() => {
      result.current.nextPage();
    });
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.displayList[0].name).toBe('com.example/db');

    // Go back
    expect(result.current.hasPrev).toBe(true);
    act(() => {
      result.current.prevPage();
    });
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.displayList[0].name).toBe('com.example/fs');
    expect(result.current.hasPrev).toBe(false);
  });
});
