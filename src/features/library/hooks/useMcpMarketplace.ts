import { useState, useCallback, useEffect, useMemo, useRef } from 'react';

import { searchMcpRegistry } from '@/features/library/api/libraryApi';
import type { McpRegistrySummary } from '@/features/library/api/libraryApi';
import { useLibraryStore } from '@/features/library/store/libraryStore';
import { useMcpStore } from '@/features/library/store/mcpStore';

const DEFAULT_PAGE_SIZE = 20;
export const MCP_PAGE_SIZE_OPTIONS = [20, 40, 80] as const;
const SEARCH_DEBOUNCE_MS = 300;

interface CursorEntry {
  servers: McpRegistrySummary[];
  cursor: string | null;
}

export function useMcpMarketplace() {
  const mcpServers = useMcpStore((s) => s.mcpServers);
  const searchQuery = useLibraryStore((s) => s.searchQuery);
  const setSearchQuery = useLibraryStore((s) => s.setSearchQuery);
  const setMcpMarketplaceCount = useMcpStore((s) => s.setMcpMarketplaceCount);

  const [displayList, setDisplayList] = useState<McpRegistrySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Cursor stack: each entry is a page
  const cursorStackRef = useRef<CursorEntry[]>([]);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [hasPrev, setHasPrev] = useState(false);

  // Per-page size (cursor pagination — limit passed to the backend)
  const [perPage, setPerPageState] = useState<number>(DEFAULT_PAGE_SIZE);

  // Client-side view controls (applied to the current page — registry has no
  // downloads/popularity fields natively; stars/downloads are enriched by the
  // backend from GitHub / npm / pypi, so sorting uses those metrics).
  const [sortMode, setSortMode] = useState<'recent' | 'alpha' | 'popular' | 'downloads'>('recent');
  const [transportFilter, setTransportFilter] = useState<string | null>(null);

  // Debounce timer
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Build installed set by sourceRef for O(1) lookup
  const installedBySourceRef = useMemo(() => {
    const set = new Set<string>();
    for (const s of mcpServers) {
      if (s.sourceRef) set.add(s.sourceRef);
    }
    return set;
  }, [mcpServers]);

  const isInstalled = useCallback(
    (sourceRef: string) => installedBySourceRef.has(sourceRef),
    [installedBySourceRef],
  );

  const fetchPage = useCallback(async (query: string, cursor: string | null, limit: number) => {
    setLoading(true);
    setError(null);
    try {
      const result = await searchMcpRegistry(query, limit, cursor);
      return result;
    } catch (e) {
      setError(String(e));
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  // Reset cursor stack when query or perPage changes
  useEffect(() => {
    cursorStackRef.current = [];
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCurrentPageIndex(0);
    setHasPrev(false);
  }, [searchQuery, perPage]);

  // Sync marketplace count to store for toolbar badge — update alongside displayList
  const updateList = useCallback(
    (servers: McpRegistrySummary[]) => {
      setDisplayList(servers);
      setMcpMarketplaceCount(servers.length);
    },
    [setMcpMarketplaceCount],
  );

  // Load initial / search page
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(
      async () => {
        const query = searchQuery;
        const result = await fetchPage(query, null, perPage);
        if (result) {
          const entry: CursorEntry = { servers: result.servers, cursor: result.nextCursor };
          cursorStackRef.current = [entry];
          setCurrentPageIndex(0);
          // eslint-disable-next-line react-hooks/set-state-in-effect
          updateList(result.servers);
          setHasNext(result.nextCursor != null);
          setHasPrev(false);
        }
      },
      searchQuery ? SEARCH_DEBOUNCE_MS : 0,
    );

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [searchQuery, fetchPage, updateList, perPage]);

  const nextPage = useCallback(async () => {
    const currentEntry = cursorStackRef.current[currentPageIndex];
    const nextCursor = currentEntry?.cursor ?? null;
    if (!nextCursor) return;

    // Check if we already have this page cached
    if (cursorStackRef.current.length > currentPageIndex + 1) {
      const nextEntry = cursorStackRef.current[currentPageIndex + 1];
      setCurrentPageIndex((i) => i + 1);
      updateList(nextEntry.servers);
      setHasNext(nextEntry.cursor != null);
      setHasPrev(true);
      return;
    }

    const result = await fetchPage(searchQuery, nextCursor, perPage);
    if (result) {
      const entry: CursorEntry = { servers: result.servers, cursor: result.nextCursor };
      cursorStackRef.current = [...cursorStackRef.current, entry];
      setCurrentPageIndex((i) => i + 1);
      updateList(result.servers);
      setHasNext(result.nextCursor != null);
      setHasPrev(true);
    }
  }, [currentPageIndex, searchQuery, fetchPage, updateList, perPage]);

  const prevPage = useCallback(async () => {
    if (currentPageIndex <= 0) return;
    const newIndex = currentPageIndex - 1;
    const entry = cursorStackRef.current[newIndex];
    if (entry) {
      setCurrentPageIndex(newIndex);
      updateList(entry.servers);
      setHasNext(true);
      setHasPrev(newIndex > 0);
    }
  }, [currentPageIndex, updateList]);

  /** Jump to a visited page from the cached cursor stack (1-based); next page fetches. */
  const goToPage = useCallback(
    (targetPage: number) => {
      if (targetPage < 1 || loading) return;
      // Next page (not yet cached) — advance via nextPage when available
      if (targetPage === currentPageIndex + 2 && hasNext) {
        void nextPage();
        return;
      }
      const index = targetPage - 1;
      if (index < 0 || index > currentPageIndex) return;
      const entry = cursorStackRef.current[index];
      if (entry) {
        setCurrentPageIndex(index);
        updateList(entry.servers);
        setHasNext(true);
        setHasPrev(index > 0);
      }
    },
    [currentPageIndex, hasNext, loading, nextPage, updateList],
  );

  const setPerPage = useCallback(
    (size: number) => {
      if (size === perPage) return;
      setPerPageState(size);
      // Cursor stack reset + first-page refetch handled by effects above.
    },
    [perPage],
  );

  // Derived: current page filtered by transport + sorted (registry order = "recent")
  const visibleList = useMemo(() => {
    let list = displayList;
    if (transportFilter) {
      list = list.filter((s) => s.transports.includes(transportFilter));
    }
    if (sortMode === 'alpha') {
      list = [...list].sort((a, b) => a.title.localeCompare(b.title));
    } else if (sortMode === 'popular') {
      // GitHub stars descending, items without stars last
      list = [...list].sort((a, b) => (b.stars ?? -1) - (a.stars ?? -1));
    } else if (sortMode === 'downloads') {
      // Package downloads descending, items without downloads last
      list = [...list].sort((a, b) => (b.downloads ?? -1) - (a.downloads ?? -1));
    }
    return list;
  }, [displayList, transportFilter, sortMode]);

  return {
    displayList,
    visibleList,
    loading,
    error,
    hasNext,
    hasPrev,
    currentPage: currentPageIndex + 1,
    perPage,
    setPerPage,
    goToPage,
    sortMode,
    setSortMode,
    transportFilter,
    setTransportFilter,
    searchQuery,
    setSearchQuery,
    nextPage,
    prevPage,
    isInstalled,
  };
}
