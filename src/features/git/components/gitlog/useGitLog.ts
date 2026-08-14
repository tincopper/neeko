import { useState, useCallback, useEffect, useRef } from 'react';

import type { CommitEntry } from '@/features/git/types';
import type { ProjectCommands } from '@/shared/types/activeProject';

import type { GitLogData } from './types';

/** If a repo has more commits than this, fall back to paged loading. */
const FULL_LOAD_THRESHOLD = 5000;
const PAGE_SIZE = 50;

/**
 * 加载 commit 历史（激活门控）。
 *
 * @param enabled 可见性门控：false 时不发起任何请求；切换为 true 时自动加载。
 *                - 数据在 enabled 切换间保留（不清空），切回时立即展示；
 *                - 未激活期间调用 refresh() 只复位加载标记，激活后自动重新加载。
 */
export function useGitLog(commands: ProjectCommands | null, enabled = true): GitLogData {
  const [commits, setCommits] = useState<CommitEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const loadedRef = useRef(false);
  const isPagedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const enabledRef = useRef(enabled);
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

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
    if (!commands || !enabledRef.current) return;
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

  // commands 切换时复位加载标记并清空旧列表（避免跨项目数据残留）。
  // 必须先于下方 load effect 声明：React 按声明顺序执行 effect，
  // 保证切换 commands 时 reset 先跑、load 随即重新加载（而非早退）。
  useEffect(() => {
    loadedRef.current = false;
    isPagedRef.current = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 外部 commands 变化时同步重置本地列表（项目既有模式）
    setCommits([]);
  }, [commands]);

  // 激活门控：enabled 首次为 true（或 commands 变化后）时加载一次。
  // loadedRef 保证同一次激活只加载一次；数据在 disabled 期间保留。
  useEffect(() => {
    if (!commands || !enabled) return;
    if (loadedRef.current) return;
    loadedRef.current = true;
    setHasMore(true);
    probeAndLoad();
  }, [commands, enabled, probeAndLoad]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const loadMore = useCallback(() => {
    if (!enabledRef.current) return;
    if (loadingMore || !hasMore || !isPagedRef.current) return;
    // Overlap by 1 commit to ensure parent is always in view for graph continuity
    const skip = commits.length > 0 ? commits.length - 1 : 0;
    fetchCommits(skip, true, PAGE_SIZE).then((list) => {
      if (list.length < PAGE_SIZE) {
        setHasMore(false);
      }
    });
  }, [enabledRef, loadingMore, hasMore, commits.length, fetchCommits]);

  const refresh = useCallback(() => {
    // 未激活时只复位标记，激活后由 load effect 自动重新加载（不空转 IPC）
    loadedRef.current = false;
    isPagedRef.current = false;
    if (!enabledRef.current) return;
    setCommits([]);
    setHasMore(true);
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
