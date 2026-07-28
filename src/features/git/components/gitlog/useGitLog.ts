import { useState, useCallback, useEffect, useRef } from 'react';

import type { CommitEntry } from '@/shared/types';
import type { ProjectCommands } from '@/shared/types/activeProject';

import type { GitLogData } from './types';

const PAGE_SIZE = 50;

export function useGitLog(commands: ProjectCommands | null): GitLogData {
  const [commits, setCommits] = useState<CommitEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const loadedRef = useRef(false);
  // AbortController to cancel stale in-flight requests on refresh/project switch
  const abortRef = useRef<AbortController | null>(null);

  const fetchCommits = useCallback(
    async (skip: number, append: boolean) => {
      if (!commands) return;

      // Cancel any in-flight request to prevent stale responses overwriting state
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
        setError(null);
      }
      try {
        const list = await commands.getCommitLog(PAGE_SIZE, skip);
        // Guard against stale responses after abort or project switch
        if (controller.signal.aborted) return;
        if (append) {
          setCommits((prev) => [...prev, ...list]);
        } else {
          setCommits(list);
        }
        setHasMore(list.length >= PAGE_SIZE);
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err as string);
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [commands],
  );

  // Initial load — guard with loadedRef to avoid re-fetch when commands
  // reference changes due to unrelated store updates (e.g. baseRefreshGit).
  useEffect(() => {
    if (!commands) return;
    if (loadedRef.current) return;
    loadedRef.current = true;
    setHasMore(true);
    fetchCommits(0, false);
  }, [commands, fetchCommits]);

  // Reset loadedRef when commands identity changes so the initial load fires
  // for the new project. Uses a separate effect to avoid the race where both
  // effects run in the same commit and loadedRef is reset before the guard.
  useEffect(() => {
    loadedRef.current = false;
  }, [commands]);

  // Cleanup: cancel in-flight requests on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const loadMore = useCallback(() => {
    if (loadingMore || !hasMore) return;
    fetchCommits(commits.length, true);
  }, [loadingMore, hasMore, commits.length, fetchCommits]);

  const refresh = useCallback(() => {
    setCommits([]);
    setHasMore(true);
    loadedRef.current = false;
    fetchCommits(0, false);
  }, [fetchCommits]);

  return {
    commits,
    loading,
    error,
    hasMore,
    loadMore,
    refresh,
    loadingMore,
  };
}
