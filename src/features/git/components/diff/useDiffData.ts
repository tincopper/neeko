import { listen } from '@tauri-apps/api/event';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { GIT_STATUS_DIFF_EVENT } from '@/shared/events';
import { useFileChangedEvent } from '@/shared/hooks/useFileChangedEvent';
import { useGitRefresh } from '@/shared/hooks/useGitRefresh';
import type { FileChangedEvent } from '@/shared/types';
import type { ProjectCommands } from '@/shared/types/activeProject';

import type { DiffResult, DiffSource, DiffLine } from './types';

interface UseDiffDataParams {
  projectId?: string;
  diffSource?: DiffSource;
  filePath: string;
  commands?: ProjectCommands | null;
  /** true=折叠长上下文（默认）；false=全量上下文（展开全文）。 */
  collapse?: boolean;
}

export function useDiffData({
  projectId,
  diffSource,
  filePath,
  commands,
  collapse = true,
}: UseDiffDataParams) {
  const [diffResult, setDiffResult] = useState<DiffResult | null>(null);
  const [fullHunks, setFullHunks] = useState<DiffResult['hunks'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentBlockIndex, setCurrentBlockIndex] = useState(0);
  // 刷新信号版本号：file-changed / git-status-diff / Git 刷新按钮命中时递增，驱动重新拉取
  const [refreshTick, setRefreshTick] = useState(0);

  /** 按 collapse 模式拉取 diff（loadDiff / loadFullHunks 共用）。 */
  const fetchDiff = useCallback(
    async (collapseMode: boolean): Promise<DiffResult> => {
      const ds = diffSource;
      // 所有 diff 加载统一走 commands（ProjectCommands 在各环境下都可用）
      // commands 不可用时降级为 projectId 直调
      if (ds?.type === 'commit' || ds?.type === 'wsl-commit' || ds?.type === 'remote-commit') {
        if (commands) {
          return commands.getCommitFileDiff(ds.commitHash, filePath, collapseMode);
        }
        const { getCommitFileDiff } = await import('../../api/gitApi');
        return getCommitFileDiff(projectId ?? '', ds.commitHash, filePath, collapseMode);
      }
      if (ds?.type === 'stash') {
        if (commands) {
          return commands.getStashFileDiff(ds.selector, filePath, collapseMode);
        }
        const { getStashFileDiff } = await import('../../api/gitApi');
        return getStashFileDiff(projectId ?? '', ds.selector, filePath, collapseMode);
      }
      if (commands) {
        return commands.getFileDiff(filePath, collapseMode);
      }
      const { getFileDiff } = await import('../../api/gitApi');
      const wt = ds?.type === 'worktree' ? ds.worktreePath : undefined;
      return getFileDiff(projectId ?? '', filePath, wt, collapseMode);
    },
    [projectId, diffSource, filePath, commands],
  );

  /** 按需加载全量（未折叠）hunks，供单段展开使用；无状态，直接请求后端。 */
  const loadFullHunks = useCallback(async () => {
    if (!filePath) {
      setFullHunks(null);
      return;
    }
    try {
      const result = await fetchDiff(false);
      setFullHunks(result.hunks);
    } catch {
      // 全量加载失败时保留现状（单段展开静默降级）
    }
  }, [filePath, fetchDiff]);

  const loadDiff = useCallback(async () => {
    // Empty path = intentionally idle (combined parent or collapsed section).
    if (!filePath) {
      setDiffResult(null);
      setLoading(false);
      setError(null);
      setCurrentBlockIndex(0);
      return;
    }

    // ── 性能日志：diff 加载开始 ──
    const t0 = performance.now();
    console.debug('[perf] useDiffData start:', filePath);

    setLoading(true);
    setError(null);
    try {
      const result = await fetchDiff(collapse);

      const elapsed = (performance.now() - t0).toFixed(0);
      console.debug(
        '[perf] useDiffData done:',
        filePath,
        `${elapsed}ms`,
        'hunks:',
        result.hunks.length,
      );

      setDiffResult(result);
      setCurrentBlockIndex(0);
    } catch (err) {
      const elapsed = (performance.now() - t0).toFixed(0);
      console.debug('[perf] useDiffData error:', filePath, `${elapsed}ms`, err);
      setError(err as string);
    } finally {
      setLoading(false);
    }
  }, [filePath, collapse, fetchDiff]);

  // 文件内容变更（精确路径）→ 递增 refreshTick，驱动当前文件重新拉取
  useFileChangedEvent(
    useCallback(
      (ev: FileChangedEvent) => {
        if (!filePath) return;
        if (ev.project_id !== projectId) return;
        if (!ev.paths.includes(filePath)) return;
        setRefreshTick((t) => t + 1);
      },
      [projectId, filePath],
    ),
  );

  // 仓库状态事件（git-status-diff，路径无关）→ 该项目的任意文件状态变化
  // 都触发当前 diff 重新拉取；后端指纹校验保证未变文件命中缓存（廉价）。
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void listen<{ project_id: string }>(GIT_STATUS_DIFF_EVENT, (event) => {
      if (cancelled) return;
      if (event.payload.project_id === projectId) {
        setRefreshTick((t) => t + 1);
      }
    }).then((un) => {
      if (cancelled) un();
      else unlisten = un;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [projectId]);

  // Git 面板刷新按钮 → 递增 refreshTick（该项目的 diff 重新拉取）
  useGitRefresh(
    useCallback(
      (pid: string) => {
        if (!projectId || pid !== projectId) return;
        setRefreshTick((t) => t + 1);
      },
      [projectId],
    ),
  );

  // 无状态消费者：挂载 / 文件或折叠模式变化 / 任意刷新信号 → 直接重新拉取。
  // loadDiff 依赖含 filePath/collapse/diffSource，其变化即重建 → effect 重跑 → 重拉。
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 挂载/信号驱动重拉（项目既有模式）
    void loadDiff();
  }, [loadDiff, refreshTick]);

  const changeStats = useMemo(() => {
    if (!diffResult) {
      return { additions: 0, deletions: 0 };
    }
    let additions = 0;
    let deletions = 0;
    for (const hunk of diffResult.hunks) {
      for (const line of hunk.lines) {
        if (line.Added !== undefined) {
          additions++;
        }
        if (line.Removed !== undefined) {
          deletions++;
        }
      }
    }
    return { additions, deletions };
  }, [diffResult]);

  const totalChangeBlocks = useMemo((): number => {
    if (!diffResult) {
      return 0;
    }
    let count = 0;
    for (const hunk of diffResult.hunks) {
      let inBlock = false;
      for (const line of hunk.lines) {
        const isChanged = line.Added !== undefined || line.Removed !== undefined;
        if (isChanged && !inBlock) {
          count++;
          inBlock = true;
        } else if (!isChanged) {
          inBlock = false;
        }
      }
    }
    return count;
  }, [diffResult]);

  return {
    diffResult,
    fullHunks,
    loadFullHunks,
    loading,
    error,
    loadDiff,
    currentBlockIndex,
    setCurrentBlockIndex,
    changeStats,
    totalChangeBlocks,
  };
}

export function getLineContent(line: DiffLine): string {
  return line.Collapsed ?? line.Context ?? line.Added ?? line.Removed ?? '';
}

export function getLineType(line: DiffLine): 'context' | 'added' | 'removed' | 'collapsed' {
  if (line.Collapsed !== undefined) {
    return 'collapsed';
  }
  if (line.Context !== undefined) {
    return 'context';
  }
  if (line.Added !== undefined) {
    return 'added';
  }
  if (line.Removed !== undefined) {
    return 'removed';
  }
  return 'context';
}
