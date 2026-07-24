import { useState, useEffect, useCallback, useRef } from 'react';
import { scanConversations, listConversations } from '../api/conversationApi';
import type { ConversationMeta } from '../types';
import {
  initialListLoadState,
  listLoadKey,
  resolveListAfterError,
  shouldAutoScan,
  type ListLoadState,
} from '../utils/conversationListLoad';

export interface UseConversationListResult extends ListLoadState {
  conversations: ConversationMeta[];
  /** Background refresh (throttled auto-scan). */
  refresh: () => Promise<void>;
  /** Force scan+list, ignoring auto-scan throttle. */
  forceRefresh: () => Promise<void>;
}

/**
 * Fishbone list loader:
 * 1) show shell + skeleton immediately when empty
 * 2) hydrate from backend memory cache (list)
 * 3) refresh via scan in the background (stale-while-revalidate)
 * 4) never blank the list on soft failures when rows already exist
 */
export function useConversationList(
  projectPath: string | null,
  isActive: boolean,
  agentFilter?: string,
): UseConversationListResult {
  const [conversations, setConversations] = useState<ConversationMeta[]>([]);
  // If the panel will load on mount, start in loading so skeleton paints before first effect.
  const [loadState, setLoadState] = useState<ListLoadState>(() =>
    isActive && projectPath
      ? { loading: true, refreshing: false, error: null }
      : initialListLoadState(),
  );

  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;

  /** Monotonic token so stale async results never clobber newer project keys. */
  const requestGenRef = useRef(0);
  /** Last successful auto-scan timestamp per list key. */
  const lastScanAtRef = useRef<Map<string, number>>(new Map());
  /** In-flight promise de-dupe for the same key. */
  const inFlightRef = useRef<Map<string, Promise<void>>>(new Map());
  const activeKeyRef = useRef<string | null>(
    isActive && projectPath ? listLoadKey(projectPath, agentFilter) : null,
  );

  const runLoad = useCallback(
    async (options: { forceScan: boolean }) => {
      if (!projectPath) {
        setConversations([]);
        conversationsRef.current = [];
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
        // Spine: blocking loading only when empty; always mark refreshing while work runs.
        setLoadState((prev) => ({
          loading: !hasRows,
          refreshing: true,
          error: prev.error,
        }));

        try {
          // Rib 1 — hydrate cache first (fast path).
          const cached = await listConversations(projectPath, agentFilter);
          if (gen !== requestGenRef.current) return;

          setConversations(cached);
          conversationsRef.current = cached;

          // Keep hard-loading while empty AND still scanning, so we don't flash empty state.
          const emptyAfterHydrate = cached.length === 0;
          setLoadState({
            loading: emptyAfterHydrate,
            refreshing: true,
            error: null,
          });

          const now = Date.now();
          const lastScan = lastScanAtRef.current.get(key);
          const needScan = options.forceScan || shouldAutoScan(lastScan, now);

          if (needScan) {
            // Rib 2 — background scan, then re-list.
            await scanConversations(agentFilter);
            if (gen !== requestGenRef.current) return;

            lastScanAtRef.current.set(key, Date.now());
            const fresh = await listConversations(projectPath, agentFilter);
            if (gen !== requestGenRef.current) return;
            setConversations(fresh);
            conversationsRef.current = fresh;
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

  useEffect(() => {
    if (!isActive || !projectPath) {
      // Panel hidden or no project: cancel in-flight; keep rows so re-open can show instantly.
      requestGenRef.current += 1;
      if (!projectPath) {
        setConversations([]);
        conversationsRef.current = [];
        setLoadState(initialListLoadState());
        activeKeyRef.current = null;
      }
      return;
    }

    const key = listLoadKey(projectPath, agentFilter);
    if (activeKeyRef.current !== key) {
      // Different project/agent: drop previous rows to avoid cross-project flash.
      activeKeyRef.current = key;
      requestGenRef.current += 1;
      conversationsRef.current = [];
      setConversations([]);
      setLoadState({ loading: true, refreshing: false, error: null });
    }

    void runLoad({ forceScan: false });
  }, [isActive, projectPath, agentFilter, runLoad]);

  return {
    conversations,
    loading: loadState.loading,
    refreshing: loadState.refreshing,
    error: loadState.error,
    refresh,
    forceRefresh,
  };
}
