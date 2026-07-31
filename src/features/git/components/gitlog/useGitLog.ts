import { useState, useCallback, useEffect, useRef } from 'react';

import type { CommitEntry } from '@/features/git/types';
import type { ProjectCommands } from '@/shared/types/activeProject';

import type { GitLogData } from './types';

/** If a repo has more commits than this, fall back to paged loading. */
const FULL_LOAD_THRESHOLD = 5000;
const PAGE_SIZE = 50;

export function useGitLog(commands: ProjectCommands | null): GitLogData {
  const [commits, setCommits] = useState<CommitEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const loadedRef = useRef(false);
  const isPagedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const fetchCommits = useCallback(
    async (skip: number, append: boolean, count: number): Promise<CommitEntry[]> => {
      if (!commands) return [];
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
        const list = await commands.getCommitLog(count, skip);
        if (controller.signal.aborted) return [];
        if (append) {
          setCommits((prev) => [...prev, ...list]);
        } else {
          setCommits(list);
        }
        return list;
      } catch (err) {
        if (controller.signal.aborted) return [];
        setError(err as string);
        return [];
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [commands],
  );

  const probeAndLoad = useCallback(async () => {
    if (!commands) return;
    // Probe with threshold + 1 to decide if we need paging.
    const list = await fetchCommits(0, false, FULL_LOAD_THRESHOLD + 1);
    if (list.length === 0) return;
    if (list.length <= FULL_LOAD_THRESHOLD) {
      isPagedRef.current = false;
      setHasMore(false);
    } else {
      isPagedRef.current = true;
      setHasMore(true);
    }
  }, [commands, fetchCommits]);

  useEffect(() => {
    if (!commands) return;
    if (loadedRef.current) return;
    loadedRef.current = true;
    setHasMore(true);
    probeAndLoad();
  }, [commands, probeAndLoad]);

  useEffect(() => {
    loadedRef.current = false;
    isPagedRef.current = false;
  }, [commands]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const loadMore = useCallback(() => {
    if (loadingMore || !hasMore || !isPagedRef.current) return;
    // Overlap by 1 commit to ensure parent is always in view for graph continuity
    const skip = commits.length > 0 ? commits.length - 1 : 0;
    fetchCommits(skip, true, PAGE_SIZE).then((list) => {
      if (list.length < PAGE_SIZE) {
        setHasMore(false);
      }
    });
  }, [loadingMore, hasMore, commits.length, fetchCommits]);

  const refresh = useCallback(() => {
    setCommits([]);
    setHasMore(true);
    loadedRef.current = false;
    isPagedRef.current = false;
    probeAndLoad();
  }, [probeAndLoad]);

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
