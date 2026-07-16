import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DiffResult, DiffSource, DiffLine } from "./types";
import type { ProjectCommands } from '@/shared/types/activeProject';

// ── 模块级 Diff 结果缓存（避免在文件间切换时重复加载） ──────────────────
const diffCache = new Map<string, DiffResult>();

function getCacheKey(projectId?: string, diffSource?: DiffSource, filePath?: string): string {
  return `${projectId ?? ""}|${JSON.stringify(diffSource ?? "")}|${filePath ?? ""}`;
}

interface UseDiffDataParams {
  projectId?: string;
  diffSource?: DiffSource;
  filePath: string;
  commands?: ProjectCommands | null;
}

export function useDiffData({ projectId, diffSource, filePath, commands }: UseDiffDataParams) {
  const [diffResult, setDiffResult] = useState<DiffResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentBlockIndex, setCurrentBlockIndex] = useState(0);
  const lastLoadKeyRef = useRef<string>("");

  const loadDiff = useCallback(async () => {
    const cacheKey = getCacheKey(projectId, diffSource, filePath);

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
      let result: DiffResult;
      const ds = diffSource;

      // 所有 diff 加载统一走 commands（ProjectCommands 在各环境下都可用）
      // commands 不可用时降级为 projectId 直调
      if (ds?.type === "commit" || ds?.type === "wsl-commit" || ds?.type === "remote-commit") {
        if (commands) {
          result = await commands.getCommitFileDiff(ds.commitHash, filePath);
        } else {
          const { getCommitFileDiff } = await import("../../api/gitApi");
          result = await getCommitFileDiff(projectId ?? "", ds.commitHash, filePath);
        }
      } else if (commands) {
        result = await commands.getFileDiff(filePath);
      } else {
        const { getFileDiff } = await import("../../api/gitApi");
        result = await getFileDiff(projectId ?? "", filePath);
      }

      const elapsed = (performance.now() - t0).toFixed(0);
      console.debug('[perf] useDiffData done:', filePath, `${elapsed}ms`, 'hunks:', result.hunks.length);

      diffCache.set(cacheKey, result);
      setDiffResult(result);
      setCurrentBlockIndex(0);
    } catch (err) {
      const elapsed = (performance.now() - t0).toFixed(0);
      console.debug('[perf] useDiffData error:', filePath, `${elapsed}ms`, err);
      setError(err as string);
    } finally {
      setLoading(false);
    }
  }, [projectId, diffSource, filePath, commands]);

  useEffect(() => {
    const key = getCacheKey(projectId, diffSource, filePath);
    if (key === lastLoadKeyRef.current) {
      return;
    }
    lastLoadKeyRef.current = key;
    void loadDiff();
  }, [projectId, diffSource, filePath, loadDiff]);

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
  return line.Collapsed ?? line.Context ?? line.Added ?? line.Removed ?? "";
}

export function getLineType(line: DiffLine): "context" | "added" | "removed" | "collapsed" {
  if (line.Collapsed !== undefined) {
    return "collapsed";
  }
  if (line.Context !== undefined) {
    return "context";
  }
  if (line.Added !== undefined) {
    return "added";
  }
  if (line.Removed !== undefined) {
    return "removed";
  }
  return "context";
}
