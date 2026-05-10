import React, { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Project, CommitEntry, AheadBehind, CommitResult } from "../../types";
import BranchInfo from "./BranchInfo";
import ChangesList from "./ChangesList";
import CommitForm from "./CommitForm";
import CommitHistory from "./CommitHistory";
import PullRequestsPanel from "./PullRequestsPanel";
import GitDialog, { type DialogState } from "./GitDialog";

interface GitCommitPanelProps {
  project: Project;
  onRefreshGit: (projectId: string) => void;
  onSelectFile?: (projectId: string, filePath: string) => void;
  onShowToast?: (message: string, type?: "info" | "error") => void;
  onOpenDialog?: (type: "new-branch" | "new-worktree", e: React.MouseEvent) => void;
}

const GitCommitPanel: React.FC<GitCommitPanelProps> = ({
  project,
  onRefreshGit,
  onSelectFile,
  onShowToast,
  onOpenDialog,
}) => {
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [aheadBehind, setAheadBehind] = useState<AheadBehind | null>(null);
  const [commits, setCommits] = useState<CommitEntry[]>([]);
  const [historyExpanded, setHistoryExpanded] = useState(true);
  const [loading, setLoading] = useState(false);
  const [_stagedFiles, setStagedFiles] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const loadedRef = useRef(false);

  const changedFiles = project.git_info?.changed_files ?? [];

  useEffect(() => {
    if (!project.git_info) return;
    if (loadedRef.current) return;
    loadedRef.current = true;

    refreshAheadBehind();
    refreshCommits();
  }, [project.id]);

  useEffect(() => {
    loadedRef.current = false;
  }, [project.id]);

  const refreshAheadBehind = async () => {
    try {
      const ab = await invoke<AheadBehind>("get_ahead_behind_command", {
        projectId: project.id,
      });
      setAheadBehind(ab);
    } catch {
      // repo may not have remote configured
    }
  };

  const refreshCommits = async () => {
    try {
      const list = await invoke<CommitEntry[]>("get_commit_log_command", {
        projectId: project.id,
        count: 10,
      });
      setCommits(list);
    } catch {
      // ignore
    }
  };

  const toggleFile = useCallback(
    (path: string) => {
      setSelectedFiles((prev) => {
        const next = new Set(prev);
        if (next.has(path)) {
          next.delete(path);
        } else {
          next.add(path);
        }
        return next;
      });
    },
    []
  );

  const selectAll = useCallback(() => {
    setSelectedFiles(new Set(changedFiles.map((f) => f.path)));
  }, [changedFiles]);

  const deselectAll = useCallback(() => {
    setSelectedFiles(new Set());
  }, []);

  const handleStage = useCallback(async () => {
    const files = Array.from(selectedFiles);
    if (files.length === 0) return;
    setLoading(true);
    try {
      await invoke("stage_files_command", { projectId: project.id, filePaths: files });
      setStagedFiles((prev) => {
        const next = new Set(prev);
        files.forEach((f) => next.add(f));
        return next;
      });
      onRefreshGit(project.id);
      onShowToast?.("Staged successfully", "info");
    } catch (e: unknown) {
      onShowToast?.(String(e), "error");
    } finally {
      setLoading(false);
    }
  }, [selectedFiles, project.id, onRefreshGit, onShowToast]);

  const handleUnstage = useCallback(async () => {
    const files = Array.from(selectedFiles);
    if (files.length === 0) return;
    setLoading(true);
    try {
      await invoke("unstage_files_command", { projectId: project.id, filePaths: files });
      setStagedFiles((prev) => {
        const next = new Set(prev);
        files.forEach((f) => next.delete(f));
        return next;
      });
      onRefreshGit(project.id);
      onShowToast?.("Unstaged successfully", "info");
    } catch (e: unknown) {
      onShowToast?.(String(e), "error");
    } finally {
      setLoading(false);
    }
  }, [selectedFiles, project.id, onRefreshGit, onShowToast]);

  const handleDiscardFile = useCallback(
    async (path: string) => {
      setLoading(true);
      try {
        await invoke("discard_file_command", { projectId: project.id, filePath: path });
        onRefreshGit(project.id);
        setSelectedFiles((prev) => {
          const next = new Set(prev);
          next.delete(path);
          return next;
        });
        onShowToast?.("Discarded changes", "info");
      } catch (e: unknown) {
        onShowToast?.(String(e), "error");
      } finally {
        setLoading(false);
      }
    },
    [project.id, onRefreshGit, onShowToast]
  );

  const handleCommit = useCallback(
    async (message: string) => {
      const files = Array.from(selectedFiles);
      if (files.length === 0) {
        onShowToast?.("No files selected. Check files to commit.", "error");
        return;
      }
      setLoading(true);
      try {
        const result = await invoke<CommitResult>("commit_files_command", {
          projectId: project.id,
          filePaths: files,
          message,
        });
        onRefreshGit(project.id);
        refreshCommits();
        setStagedFiles(new Set());
        setSelectedFiles(new Set());
        onShowToast?.(
          `Committed ${result.hash ? result.hash.slice(0, 7) : "successfully"}`,
          "info"
        );
      } catch (e: unknown) {
        onShowToast?.(String(e), "error");
      } finally {
        setLoading(false);
      }
    },
    [selectedFiles, project.id, onRefreshGit, onShowToast]
  );

  const handleCommitAndPush = useCallback(
    async (message: string) => {
      const files = Array.from(selectedFiles);
      if (files.length === 0) {
        onShowToast?.("No files selected. Check files to commit.", "error");
        return;
      }
      setLoading(true);
      try {
        await invoke("commit_files_command", {
          projectId: project.id,
          filePaths: files,
          message,
        });
        await invoke("push_command", {
          projectId: project.id,
          setUpstream: false,
        });
        onRefreshGit(project.id);
        refreshCommits();
        refreshAheadBehind();
        setStagedFiles(new Set());
        setSelectedFiles(new Set());
        onShowToast?.("Committed & pushed successfully", "info");
      } catch (e: unknown) {
        onShowToast?.(String(e), "error");
      } finally {
        setLoading(false);
      }
    },
    [selectedFiles, project.id, onRefreshGit, onShowToast]
  );

  const handleFetch = useCallback(async () => {
    setLoading(true);
    try {
      await invoke("fetch_command", { projectId: project.id });
      refreshAheadBehind();
      onShowToast?.("Fetched successfully", "info");
    } catch (e: unknown) {
      onShowToast?.(String(e), "error");
    } finally {
      setLoading(false);
    }
  }, [project.id, onShowToast]);

  const handlePull = useCallback(async () => {
    setLoading(true);
    try {
      await invoke("pull_command", { projectId: project.id });
      onRefreshGit(project.id);
      refreshCommits();
      refreshAheadBehind();
      onShowToast?.("Pulled successfully", "info");
    } catch (e: unknown) {
      onShowToast?.(String(e), "error");
    } finally {
      setLoading(false);
    }
  }, [project.id, onRefreshGit, onShowToast]);

  const handlePush = useCallback(async () => {
    setLoading(true);
    try {
      await invoke("push_command", { projectId: project.id, setUpstream: false });
      onRefreshGit(project.id);
      refreshAheadBehind();
      onShowToast?.("Pushed successfully", "info");
    } catch (e: unknown) {
      onShowToast?.(String(e), "error");
    } finally {
      setLoading(false);
    }
  }, [project.id, onRefreshGit, onShowToast]);

  const handleNewBranch = useCallback(() => {
    if (onOpenDialog) {
      onOpenDialog("new-branch", {} as React.MouseEvent);
    } else {
      setDialog({
        type: "new-branch",
        projectId: project.id,
        branches: project.git_info?.branches ?? [],
        projectPath: project.path,
      });
    }
  }, [onOpenDialog, project]);

  const handleNewWorktree = useCallback(() => {
    if (onOpenDialog) {
      onOpenDialog("new-worktree", {} as React.MouseEvent);
    } else {
      setDialog({
        type: "new-worktree",
        projectId: project.id,
        branches: project.git_info?.branches ?? [],
        projectPath: project.path,
      });
    }
  }, [onOpenDialog, project]);

  const handleDialogClose = useCallback(() => {
    setDialog(null);
  }, []);

  return (
    <div className="flex flex-col h-full">
      {dialog && (
        <GitDialog
          dialog={dialog}
          onClose={handleDialogClose}
          onRefreshGit={onRefreshGit}
        />
      )}
      <BranchInfo
        gitInfo={project.git_info ?? null}
        aheadBehind={aheadBehind}
        loading={loading}
        onFetch={handleFetch}
        onPull={handlePull}
        onPush={handlePush}
        onRefresh={() => {
          onRefreshGit(project.id);
          refreshAheadBehind();
          refreshCommits();
        }}
        onNewBranch={handleNewBranch}
        onNewWorktree={handleNewWorktree}
      />

      <div className="flex-1 min-h-0 flex flex-col">
        <ChangesList
          files={changedFiles}
          selectedFiles={selectedFiles}
          onToggleFile={toggleFile}
          onSelectAll={selectAll}
          onDeselectAll={deselectAll}
          onStageSelected={handleStage}
          onUnstageSelected={handleUnstage}
          onDiscardFile={handleDiscardFile}
          onFileSelect={(path) => onSelectFile?.(project.id, path)}
          loading={loading}
        />
      </div>

      <CommitForm
        onCommit={handleCommit}
        onCommitAndPush={handleCommitAndPush}
        loading={loading}
      />

      <CommitHistory
        projectId={project.id}
        commits={commits}
        expanded={historyExpanded}
        onToggle={() => setHistoryExpanded((v) => !v)}
        loading={loading}
        onShowToast={onShowToast}
        onRefreshGit={() => onRefreshGit(project.id)}
      />

      <PullRequestsPanel
        projectId={project.id}
        onShowToast={onShowToast}
        onRefreshGit={onRefreshGit}
      />
    </div>
  );
};

export default React.memo(GitCommitPanel);
