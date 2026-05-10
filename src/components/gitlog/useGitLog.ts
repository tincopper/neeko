import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { CommitEntry } from "../../types";
import type { GitLogData } from "./types";

const PAGE_SIZE = 50;

export function useGitLog(projectId: string | null): GitLogData {
  const [commits, setCommits] = useState<CommitEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const loadedRef = useRef(false);

  const fetchCommits = useCallback(
    async (skip: number, append: boolean) => {
      if (!projectId) return;
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
        setError(null);
      }
      try {
        const list = await invoke<CommitEntry[]>("get_commit_log_command", {
          projectId,
          count: PAGE_SIZE,
          skip,
        });
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
    [projectId],
  );

  // Initial load
  useEffect(() => {
    if (!projectId) return;
    if (loadedRef.current) return;
    loadedRef.current = true;
    setCommits([]);
    setHasMore(true);
    fetchCommits(0, false);
  }, [projectId, fetchCommits]);

  useEffect(() => {
    loadedRef.current = false;
  }, [projectId]);

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
