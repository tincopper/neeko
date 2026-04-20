import React, { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { FileChange, DiffResult } from "../../types";
import type { GitSource } from "./GitBranchPanel";
import ChangesPanel from "./ChangesPanel";
import CommitDiffPanel from "./CommitDiffPanel";

interface GitCommitViewProps {
  gitSource: GitSource;
  currentBranch: string;
}

function GitCommitView({ gitSource, currentBranch }: GitCommitViewProps) {
  const [changedFiles, setChangedFiles] = useState<FileChange[]>([]);
  const [unversionedFiles, setUnversionedFiles] = useState<FileChange[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [diffResult, setDiffResult] = useState<DiffResult | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);

  const sourceKey = gitSource.type === "local"
    ? gitSource.projectId
    : gitSource.type === "wsl"
      ? `wsl:${gitSource.distro}:${gitSource.projectPath}`
      : `remote:${(gitSource as { entryId: string }).entryId}:${(gitSource as { projectPath: string }).projectPath}`;

  // Load changed files
  const loadFiles = useCallback(async () => {
    setLoading(true);
    try {
      if (gitSource.type === "local") {
        const files = await invoke<FileChange[]>("get_worktree_changed_files", {
          projectId: gitSource.projectId,
          worktreePath: "",
        });
        setChangedFiles(files);
        // Load unversioned
        try {
          const unver = await invoke<FileChange[]>("get_unversioned_files", {
            projectId: gitSource.projectId,
          });
          setUnversionedFiles(unver);
        } catch {
          setUnversionedFiles([]);
        }
      }
      // WSL/Remote: reuse existing changed files from git info
      // For now, only local is fully supported
    } catch (err) {
      console.error("[GitCommitView] Failed to load files:", err);
    } finally {
      setLoading(false);
    }
  }, [gitSource]);

  // Load diff for selected file
  const loadDiff = useCallback(async (filePath: string) => {
    setDiffLoading(true);
    try {
      if (gitSource.type === "local") {
        const result = await invoke<DiffResult>("get_file_diff_command", {
          projectId: gitSource.projectId,
          filePath,
        });
        setDiffResult(result);
      }
    } catch (err) {
      console.error("[GitCommitView] Failed to load diff:", err);
      setDiffResult(null);
    } finally {
      setDiffLoading(false);
    }
  }, [gitSource]);

  // Effects
  useEffect(() => {
    setChangedFiles([]);
    setUnversionedFiles([]);
    setSelectedFiles(new Set());
    setSelectedFilePath(null);
    setDiffResult(null);
    loadFiles();
  }, [sourceKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handlers
  const handleToggleFile = useCallback((path: string) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const handleToggleAll = useCallback(() => {
    const allPaths = [...changedFiles, ...unversionedFiles].map((f) => f.path.toString());
    setSelectedFiles((prev) => {
      const allSelected = allPaths.every((p) => prev.has(p));
      if (allSelected) return new Set();
      return new Set(allPaths);
    });
  }, [changedFiles, unversionedFiles]);

  const handleSelectFile = useCallback((filePath: string) => {
    setSelectedFilePath(filePath);
    loadDiff(filePath);
  }, [loadDiff]);

  const handleCommit = useCallback(async (message: string, amend: boolean) => {
    if (!message.trim() || gitSource.type !== "local") return;
    try {
      const files = Array.from(selectedFiles);
      const hash = await invoke<string>("create_commit", {
        projectId: gitSource.projectId,
        message: message.trim(),
        amend,
        files,
      });
      console.log("[GitCommitView] Committed:", hash);
      setSelectedFiles(new Set());
      setSelectedFilePath(null);
      setDiffResult(null);
      loadFiles();
    } catch (err) {
      console.error("[GitCommitView] Commit failed:", err);
    }
  }, [selectedFiles, gitSource, loadFiles]);

  const handleCommitPush = useCallback(async (message: string, amend: boolean) => {
    if (!message.trim() || gitSource.type !== "local") return;
    try {
      const files = Array.from(selectedFiles);
      await invoke<string>("create_commit", {
        projectId: gitSource.projectId,
        message: message.trim(),
        amend,
        files,
      });
      await invoke("push_remote", {
        projectId: gitSource.projectId,
      });
      console.log("[GitCommitView] Committed and pushed");
      setSelectedFiles(new Set());
      setSelectedFilePath(null);
      setDiffResult(null);
      loadFiles();
    } catch (err) {
      console.error("[GitCommitView] Commit+Push failed:", err);
    }
  }, [selectedFiles, gitSource, loadFiles]);

  const handleRefresh = useCallback(() => {
    setSelectedFilePath(null);
    setDiffResult(null);
    loadFiles();
  }, [loadFiles]);

  // Convert FileChange path to string
  const allFiles = useMemo(() => {
    return [...changedFiles, ...unversionedFiles].map((f) => ({
      ...f,
      path: f.path.toString(),
    }));
  }, [changedFiles, unversionedFiles]);

  const selectedFileData = useMemo(() => {
    if (!selectedFilePath) return null;
    return allFiles.find((f) => f.path === selectedFilePath) ?? null;
  }, [selectedFilePath, allFiles]);

  return (
    <div className="flex h-full w-full">
      {/* Left: Changes + Commit form */}
      <div className="w-[420px] shrink-0 flex flex-col border-r border-border bg-bg-secondary">
        <ChangesPanel
          changedFiles={changedFiles.map((f) => ({ ...f, path: f.path.toString() }))}
          unversionedFiles={unversionedFiles.map((f) => ({ ...f, path: f.path.toString() }))}
          selectedFiles={selectedFiles}
          selectedFilePath={selectedFilePath}
          currentBranch={currentBranch}
          loading={loading}
          onToggleFile={handleToggleFile}
          onToggleAll={handleToggleAll}
          onSelectFile={handleSelectFile}
          onCommit={handleCommit}
          onCommitPush={handleCommitPush}
          onRefresh={handleRefresh}
        />
      </div>

      {/* Right: Diff viewer */}
      <div className="flex-1 min-w-0">
        <CommitDiffPanel
          filePath={selectedFilePath}
          fileStatus={selectedFileData?.status ?? null}
          diffResult={diffResult}
          loading={diffLoading}
        />
      </div>
    </div>
  );
}

export default React.memo(GitCommitView);
