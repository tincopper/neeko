import { useState, useEffect, useCallback, useRef } from 'react';
import { scanConversations, listConversations } from '../api/conversationApi';
import type { ConversationMeta } from '../types';
import {
  initialListLoadState,
  listLoadKey,
  LIST_PAGE_SIZE,
  mergeConversationPages,
  resolveListAfterError,
  shouldAutoScan,
  type ListLoadState,
} from '../utils/conversationListLoad';

export interface UseConversationListResult extends ListLoadState {
  conversations: ConversationMeta[];
  /** Total matching rows known to the backend after last list. */
  total: number;
  /** Whether more pages can be loaded. */
  hasMore: boolean;
  /** True while a next page request is in flight. */
  loadingMore: boolean;
  /** Background refresh (throttled auto-scan). */
  refresh: () => Promise<void>;
  /** Force scan+list page 0, ignoring auto-scan throttle. */
  forceRefresh: () => Promise<void>;
  /** Load next page (infinite scroll). No-op when !hasMore. */
  loadMore: () => Promise<void>;
}

/**
 * Fishbone + project-scoped paged list loader:
 * 1) show shell + skeleton immediately when empty
 * 2) hydrate first page from backend memory cache (list)
 * 3) refresh via project-scoped scan in the background (stale-while-revalidate)
 * 4) load more pages on scroll demand
 * 5) never blank the list on soft failures when rows already exist
 */
export function useConversationList(
  projectPath: string | null,
  isActive: boolean,
  agentFilter?: string,
): UseConversationListResult {
  const [conversations, setConversations] = useState<ConversationMeta[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadState, setLoadState] = useState<ListLoadState>(() =>
    isActive && projectPath
      ? { loading: true, refreshing: false, error: null }
      : initialListLoadState(),
  );

  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;

  const requestGenRef = useRef(0);
  const lastScanAtRef = useRef<Map<string, number>>(new Map());
  const inFlightRef = useRef<Map<string, Promise<void>>>(new Map());
  const loadMoreInFlightRef = useRef(false);
  const activeKeyRef = useRef<string | null>(
    isActive && projectPath ? listLoadKey(projectPath, agentFilter) : null,
  );

  const runLoad = useCallback(
    async (options: { forceScan: boolean }) => {
      if (!projectPath) {
        setConversations([]);
        conversationsRef.current = [];
        setTotal(0);
        setHasMore(false);
        setLoadState(initialListLoadState());
        return;
      }

      const key = listLoadKey(projectPath, agentFilter);
      const existing = inFlightRef.current.get(key);
      if (existing && !options.forceScan) {
        await existing;
        return;
      }

      const gen = ++requestGenRef.current;
      const hasRows = conversationsRef.current.length > 0;

      const task = (async () => {
        setLoadState((prev) => ({
          loading: !hasRows,
          refreshing: true,
          error: prev.error,
        }));

        try {
          // Rib 1 — hydrate first page only (project-scoped).
          const cached = await listConversations(projectPath, agentFilter, {
            offset: 0,
            limit: LIST_PAGE_SIZE,
          });
          if (gen !== requestGenRef.current) return;

          setConversations(cached.items);
          conversationsRef.current = cached.items;
          setTotal(cached.total);
          setHasMore(cached.hasMore);

          const emptyAfterHydrate = cached.items.length === 0;
          setLoadState({
            loading: emptyAfterHydrate,
            refreshing: true,
            error: null,
          });

          const now = Date.now();
          const lastScan = lastScanAtRef.current.get(key);
          const needScan = options.forceScan || shouldAutoScan(lastScan, now);

          if (needScan) {
            // Rib 2 — project-scoped background scan (all agents), then re-list page 0.
            // Agent filter only affects list paging, never discovery scope.
            await scanConversations(undefined, projectPath);
            if (gen !== requestGenRef.current) return;

            lastScanAtRef.current.set(key, Date.now());
            const fresh = await listConversations(projectPath, agentFilter, {
              offset: 0,
              limit: LIST_PAGE_SIZE,
            });
            if (gen !== requestGenRef.current) return;
            setConversations(fresh.items);
            conversationsRef.current = fresh.items;
            setTotal(fresh.total);
            setHasMore(fresh.hasMore);
          }

          if (gen !== requestGenRef.current) return;
          setLoadState({ loading: false, refreshing: false, error: null });
        } catch (err) {
          if (gen !== requestGenRef.current) return;
          const message = err instanceof Error ? err.message : 'Failed to load conversations';
          console.error('[useConversationList] Failed to load conversations:', err);
          setConversations((prev) => {
            const next = resolveListAfterError(prev, true);
            conversationsRef.current = next;
            return next;
          });
          setLoadState({
            loading: false,
            refreshing: false,
            error: message,
          });
        } finally {
          inFlightRef.current.delete(key);
        }
      })();

      inFlightRef.current.set(key, task);
      await task;
    },
    [projectPath, agentFilter],
  );

  const refresh = useCallback(async () => {
    await runLoad({ forceScan: false });
  }, [runLoad]);

  const forceRefresh = useCallback(async () => {
    await runLoad({ forceScan: true });
  }, [runLoad]);

  const loadMore = useCallback(async () => {
    if (!projectPath || !hasMore || loadMoreInFlightRef.current) return;
    if (loadState.loading || loadState.refreshing) return;

    loadMoreInFlightRef.current = true;
    setLoadingMore(true);
    const gen = requestGenRef.current;
    const offset = conversationsRef.current.length;

    try {
      const page = await listConversations(projectPath, agentFilter, {
        offset,
        limit: LIST_PAGE_SIZE,
      });
      if (gen !== requestGenRef.current) return;

      setConversations((prev) => {
        const next = mergeConversationPages(prev, page.items);
        conversationsRef.current = next;
        return next;
      });
      setTotal(page.total);
      setHasMore(page.hasMore);
    } catch (err) {
      if (gen !== requestGenRef.current) return;
      console.error('[useConversationList] loadMore failed:', err);
      // Soft fail: keep rows, surface error without clearing.
      const message = err instanceof Error ? err.message : 'Failed to load more conversations';
      setLoadState((prev) => ({ ...prev, error: message }));
    } finally {
      loadMoreInFlightRef.current = false;
      setLoadingMore(false);
    }
  }, [projectPath, agentFilter, hasMore, loadState.loading, loadState.refreshing]);

  useEffect(() => {
    if (!isActive) return;

    const key = projectPath ? listLoadKey(projectPath, agentFilter) : null;
    if (key !== activeKeyRef.current) {
      activeKeyRef.current = key;
      requestGenRef.current += 1;
      setConversations([]);
      conversationsRef.current = [];
      setTotal(0);
      setHasMore(false);
      setLoadState(
        projectPath
          ? { loading: true, refreshing: false, error: null }
          : initialListLoadState(),
      );
    }

    void runLoad({ forceScan: false });
  }, [isActive, projectPath, agentFilter, runLoad]);

  return {
    conversations,
    total,
    hasMore,
    loadingMore,
    loading: loadState.loading,
    refreshing: loadState.refreshing,
    error: loadState.error,
    refresh,
    forceRefresh,
    loadMore,
  };
}
