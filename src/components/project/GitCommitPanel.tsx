import React, { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Project, AheadBehind, CommitResult } from "../../types";
import BranchInfo from "./BranchInfo";
import ChangesList from "./ChangesList";
import CommitForm from "./CommitForm";
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
  const [loading, setLoading] = useState(false);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [textareaHeight, setTextareaHeight] = useState(60);
  const dragStartRef = useRef<{ startY: number; startHeight: number } | null>(null);

  const changedFiles = project.git_info?.changed_files ?? [];

  const handleDividerMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragStartRef.current = { startY: e.clientY, startHeight: textareaHeight };

      const onMouseMove = (ev: MouseEvent) => {
        if (!dragStartRef.current) return;
        const delta = dragStartRef.current.startY - ev.clientY;
        const newHeight = Math.max(40, Math.min(300, dragStartRef.current.startHeight + delta));
        setTextareaHeight(newHeight);
      };

      const onMouseUp = () => {
        dragStartRef.current = null;
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [textareaHeight],
  );

  useEffect(() => {
    if (!project.git_info) return;
    refreshAheadBehind();
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
        refreshAheadBehind();
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

  const handleCheckoutBranch = useCallback(async (branchName: string) => {
    try {
      await invoke("checkout_branch", { projectId: project.id, branchName });
      onRefreshGit(project.id);
    } catch (e: unknown) {
      onShowToast?.(String(e), "error");
    }
  }, [project.id, onRefreshGit, onShowToast]);

  const handleDialogClose = useCallback(() => {
    setDialog(null);
  }, []);

  return (
    <div className="flex flex-col h-full gap-0.5 p-1.5">
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
        }}
        onNewBranch={handleNewBranch}
        onNewWorktree={handleNewWorktree}
        onCheckoutBranch={handleCheckoutBranch}
      />

      <div className="flex-1 min-h-0 flex flex-col overflow-hidden rounded-md">
        <ChangesList
          files={changedFiles}
          selectedFiles={selectedFiles}
          onToggleFile={toggleFile}
          onDiscardFile={handleDiscardFile}
          onFileSelect={(path) => onSelectFile?.(project.id, path)}
          loading={loading}
        />
      </div>

      {/* Draggable divider */}
      <div
        className="group h-1.5 shrink-0 cursor-row-resize flex items-center justify-center"
        onMouseDown={handleDividerMouseDown}
      >
        <div className="w-8 h-[3px] rounded-full bg-border group-hover:bg-accent-blue/50 transition-colors duration-150" />
      </div>

      <CommitForm
        onCommit={handleCommit}
        onCommitAndPush={handleCommitAndPush}
        loading={loading}
        textareaHeight={textareaHeight}
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
