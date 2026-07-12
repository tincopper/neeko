import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getFileDiff, getCommitFileDiff } from "../../api/gitApi";
import { useProjectStore } from "@/features/project/store";
import type { DiffResult, DiffSource, DiffLine } from "./types";
import type { ProjectCommands } from '@/shared/types/activeProject';

// ── 模块级 Diff 结果缓存（避免在文件间切换时重复加载） ──────────────────
const diffCache = new Map<string, DiffResult>();

function getCacheKey(projectId?: string, diffSource?: DiffSource, filePath?: string): string {
  return `${projectId ?? ""}|${JSON.stringify(diffSource ?? "")}|${filePath ?? ""}`;
}

function lookupLocalProjectPath(projectId: string): string {
  const project = useProjectStore.getState().projects.find((p) => p.id === projectId);
  return project?.path ?? projectId;
}

function buildLocalTransport(projectPath: string): Record<string, unknown> {
  return { Local: { project_path: projectPath } };
}

function buildWslTransport(distro: string, projectPath: string): Record<string, unknown> {
  return { Wsl: { distro, project_path: projectPath } };
}

function buildRemoteTransport(
  host: string,
  port: number,
  username: string,
  auth: unknown,
  projectPath: string,
): Record<string, unknown> {
  return { Remote: { host, port, username, auth, project_path: projectPath } };
}

function buildFileDiffArgs(diffSource: DiffSource): {
  transport: Record<string, unknown>;
  filePath: string;
} {
  switch (diffSource.type) {
    case "local":
      return {
        transport: buildLocalTransport(lookupLocalProjectPath(diffSource.projectId)),
        filePath: "",
      };
    case "wsl":
      return {
        transport: buildWslTransport(diffSource.distro, diffSource.projectPath),
        filePath: "",
      };
    case "remote":
      return {
        transport: buildRemoteTransport(
          diffSource.host,
          diffSource.port,
          diffSource.username,
          diffSource.auth,
          diffSource.projectPath,
        ),
        filePath: "",
      };
    case "worktree":
      return {
        transport: buildLocalTransport(diffSource.worktreePath),
        filePath: "",
      };
    default:
      return { transport: {}, filePath: "" };
  }
}

function buildCommitDiffArgs(diffSource: DiffSource): {
  transport: Record<string, unknown>;
  commitHash: string;
  filePath: string;
} {
  switch (diffSource.type) {
    case "commit":
      return {
        transport: buildLocalTransport(lookupLocalProjectPath(diffSource.projectId)),
        commitHash: diffSource.commitHash,
        filePath: "",
      };
    case "wsl-commit":
      return {
        transport: buildWslTransport(diffSource.distro, diffSource.projectPath),
        commitHash: diffSource.commitHash,
        filePath: "",
      };
    case "remote-commit":
      return {
        transport: buildRemoteTransport(
          diffSource.host,
          diffSource.port,
          diffSource.username,
          diffSource.auth,
          diffSource.projectPath,
        ),
        commitHash: diffSource.commitHash,
        filePath: "",
      };
    default:
      return { transport: {}, commitHash: "", filePath: "" };
  }
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

      if (!ds?.type) {
        const projectPath = lookupLocalProjectPath(projectId ?? "");
        result = await getFileDiff(buildLocalTransport(projectPath) as any, filePath);
      } else if (
        ds.type === "commit" ||
        ds.type === "wsl-commit" ||
        ds.type === "remote-commit"
      ) {
        if (commands) {
          result = await commands.getCommitFileDiff(ds.commitHash, filePath);
        } else {
          const args = buildCommitDiffArgs(ds);
          result = await getCommitFileDiff(args.transport as any, args.commitHash, filePath);
        }
      } else if (ds.type === "worktree") {
        result = await getFileDiff(buildLocalTransport(ds.worktreePath) as any, filePath);
      } else if (commands) {
        result = await commands.getFileDiff(filePath);
      } else {
        const args = buildFileDiffArgs(ds);
        result = await getFileDiff(args.transport as any, filePath);
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
