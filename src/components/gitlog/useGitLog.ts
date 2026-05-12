import { useState, useCallback, useEffect, useRef } from "react";
import type { CommitEntry } from "../../types";
import type { ProjectCommands } from "../../types/activeProject";
import type { GitLogData } from "./types";

const PAGE_SIZE = 50;

export function useGitLog(commands: ProjectCommands | null): GitLogData {
  const [commits, setCommits] = useState<CommitEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const loadedRef = useRef(false);

  const fetchCommits = useCallback(
    async (skip: number, append: boolean) => {
      if (!commands) return;
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
        setError(null);
      }
      try {
        const list = await commands.getCommitLog(PAGE_SIZE, skip);
        if (append) {
          setCommits((prev) => [...prev, ...list]);
        } else {
          setCommits(list);
        }
        setHasMore(list.length >= PAGE_SIZE);
      } catch (err) {
        setError(err as string);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [commands],
  );

  // Initial load
  useEffect(() => {
    if (!commands) return;
    if (loadedRef.current) return;
    loadedRef.current = true;
    setHasMore(true);
    fetchCommits(0, false);
  }, [commands, fetchCommits]);

  useEffect(() => {
    loadedRef.current = false;
  }, [commands]);

  const loadMore = useCallback(() => {
    if (loadingMore || !hasMore) return;
    fetchCommits(commits.length, true);
  }, [loadingMore, hasMore, commits.length, fetchCommits]);

  const refresh = useCallback(() => {
    setCommits([]);
    setHasMore(true);
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
