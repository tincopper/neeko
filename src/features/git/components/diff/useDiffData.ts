import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useFileChangedEvent } from '@/shared/hooks/useFileChangedEvent';
import { useGitRefresh } from '@/shared/hooks/useGitRefresh';
import type { FileChangedEvent } from '@/shared/types';
import type { ProjectCommands } from '@/shared/types/activeProject';

import type { DiffResult, DiffSource, DiffLine } from './types';

// ── 模块级 Diff 结果缓存（避免在文件间切换时重复加载） ──────────────────
// 容量上限：全量 diff 体积大，无上限会让常驻应用内存无限增长（Pillar 6）。
export const DIFF_CACHE_MAX = 50;
export const diffCache = new Map<string, DiffResult>();

/** 写入缓存并淘汰最旧条目（Map 保持插入序，删除首个 key）。 */
export function setDiffCache(key: string, result: DiffResult) {
  if (diffCache.size >= DIFF_CACHE_MAX && !diffCache.has(key)) {
    const oldest = diffCache.keys().next().value;
    if (oldest !== undefined) diffCache.delete(oldest);
  }
  diffCache.set(key, result);
}

function getCacheKey(
  projectId?: string,
  diffSource?: DiffSource,
  filePath?: string,
  collapse?: boolean,
): string {
  return `${projectId ?? ''}|${JSON.stringify(diffSource ?? '')}|${filePath ?? ''}|collapse:${collapse ?? true}`;
}

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
  const lastLoadKeyRef = useRef<string>('');
  // 强制刷新版本号：file-changed / Git 刷新信号命中时递增，驱动 useEffect 重新加载
  const [refreshTick, setRefreshTick] = useState(0);
  const lastRefreshTickRef = useRef(0);

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
      if (commands) {
        return commands.getFileDiff(filePath, collapseMode);
      }
      const { getFileDiff } = await import('../../api/gitApi');
      const wt = ds?.type === 'worktree' ? ds.worktreePath : undefined;
      return getFileDiff(projectId ?? '', filePath, wt, collapseMode);
    },
    [projectId, diffSource, filePath, commands],
  );

  /** 按需加载全量（未折叠）hunks，供单段展开使用；结果进模块级缓存。 */
  const loadFullHunks = useCallback(async () => {
    if (!filePath) {
      setFullHunks(null);
      return;
    }
    const key = getCacheKey(projectId, diffSource, filePath, false);
    const cached = diffCache.get(key);
    if (cached) {
      setFullHunks(cached.hunks);
      return;
    }
    try {
      const result = await fetchDiff(false);
      setDiffCache(key, result);
      setFullHunks(result.hunks);
    } catch {
      // 全量加载失败时保留现状（单段展开静默降级）
    }
  }, [projectId, diffSource, filePath, fetchDiff]);

  const loadDiff = useCallback(async () => {
    // Empty path = intentionally idle (combined parent or collapsed section).
    if (!filePath) {
      setDiffResult(null);
      setLoading(false);
      setError(null);
      setCurrentBlockIndex(0);
      return;
    }

    const cacheKey = getCacheKey(projectId, diffSource, filePath, collapse);

    // 命中缓存则跳过 fetch，立即返回
    const cached = diffCache.get(cacheKey);
    if (cached) {
      setDiffResult(cached);
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

      setDiffCache(cacheKey, result);
      setDiffResult(result);
      setCurrentBlockIndex(0);
    } catch (err) {
      const elapsed = (performance.now() - t0).toFixed(0);
      console.debug('[perf] useDiffData error:', filePath, `${elapsed}ms`, err);
      setError(err as string);
    } finally {
      setLoading(false);
    }
  }, [projectId, diffSource, filePath, collapse, fetchDiff]);

  // 文件内容变更 → 递增 refreshTick（缓存失效统一在下方 useEffect 处理）
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

  // Git 面板刷新按钮 → 递增 refreshTick（该项目的 diff 缓存失效）
  useGitRefresh(
    useCallback(
      (pid: string) => {
        if (!projectId || pid !== projectId) return;
        setRefreshTick((t) => t + 1);
      },
      [projectId],
    ),
  );

  useEffect(() => {
    const key = getCacheKey(projectId, diffSource, filePath, collapse);
    const isKeyChange = key !== lastLoadKeyRef.current;
    // 刷新信号（file-changed / Git 刷新按钮）变化
    const isRefresh = refreshTick !== lastRefreshTickRef.current;
    if (!isKeyChange && !isRefresh) {
      return;
    }
    // 仅「内容刷新」时绕过缓存；切换文件/展开全文（key 变化）保留缓存命中优化
    if (isRefresh && !isKeyChange) {
      diffCache.delete(key);
    }
    lastLoadKeyRef.current = key;
    lastRefreshTickRef.current = refreshTick;
    void loadDiff();
  }, [projectId, diffSource, filePath, collapse, loadDiff, refreshTick]);

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
