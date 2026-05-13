import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { DiffResult, DiffSource, DiffLine } from "./types";

interface UseDiffDataParams {
  projectId?: string;
  diffSource?: DiffSource;
  filePath: string;
}

export function useDiffData({ projectId, diffSource, filePath }: UseDiffDataParams) {
  const [diffResult, setDiffResult] = useState<DiffResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentBlockIndex, setCurrentBlockIndex] = useState(0);
  const lastLoadKeyRef = useRef<string>("");

  const loadDiff = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let result: DiffResult;
      if (diffSource?.type === "wsl") {
        result = await invoke<DiffResult>("get_wsl_file_diff_command", {
          distro: diffSource.distro,
          projectPath: diffSource.projectPath,
          filePath,
        });
      } else if (diffSource?.type === "remote") {
        result = await invoke<DiffResult>("get_remote_file_diff_command", {
          host: diffSource.host,
          port: diffSource.port,
          username: diffSource.username,
          auth: diffSource.auth,
          projectPath: diffSource.projectPath,
          filePath,
        });
      } else if (diffSource?.type === "worktree") {
        result = await invoke<DiffResult>("get_worktree_file_diff", {
          projectId: diffSource.projectId,
          worktreePath: diffSource.worktreePath,
          filePath,
        });
      } else if (diffSource?.type === "wsl-commit") {
        result = await invoke<DiffResult>("wsl_get_commit_file_diff", {
          distro: diffSource.distro,
          projectPath: diffSource.projectPath,
          commitHash: diffSource.commitHash,
          filePath,
        });
      } else if (diffSource?.type === "remote-commit") {
        result = await invoke<DiffResult>("remote_get_commit_file_diff", {
          host: diffSource.host,
          port: diffSource.port,
          username: diffSource.username,
          auth: diffSource.auth,
          projectPath: diffSource.projectPath,
          commitHash: diffSource.commitHash,
          filePath,
        });
      } else if (diffSource?.type === "commit") {
        result = await invoke<DiffResult>("get_commit_file_diff_command", {
          projectId: diffSource.projectId,
          commitHash: diffSource.commitHash,
          filePath,
        });
      } else {
        result = await invoke<DiffResult>("get_file_diff_command", {
          projectId: projectId ?? diffSource?.projectId,
          filePath,
        });
      }

      setDiffResult(result);
      setCurrentBlockIndex(0);
    } catch (err) {
      setError(err as string);
    } finally {
      setLoading(false);
    }
  }, [projectId, diffSource, filePath]);

  useEffect(() => {
    const key = `${projectId ?? ""}|${JSON.stringify(diffSource ?? "")}|${filePath}`;
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
