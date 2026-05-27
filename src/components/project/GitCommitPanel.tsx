import React, { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AheadBehind, CommitResult } from "../../types";
import type {
  UnifiedProjectView,
  ProjectCommands,
  ProjectCapabilities,
} from "../../types/activeProject";
import { useAppContext } from "../../contexts";
import { withTimeout } from "../../utils/withTimeout";
import BranchInfo from "./BranchInfo";
import ChangesList from "./ChangesList";
import CommitForm from "./CommitForm";
import PullRequestsPanel from "./PullRequestsPanel";
import GitDialog, { type DialogState } from "./GitDialog";

// Timeout constants (ms). These protect against indefinite IPC hangs caused by
// the Rust backend's project_manager Mutex being held by a long operation.
const TIMEOUT_LOCAL_MS = 30_000;  // discard, stage, commit
const TIMEOUT_NETWORK_MS = 60_000; // fetch, pull, push

interface GitCommitPanelProps {
  project: UnifiedProjectView;
  commands: ProjectCommands;
  capabilities: ProjectCapabilities;
  onRefreshGit: () => Promise<void>;
  onSelectFile?: (filePath: string) => void;
  onShowToast?: (message: string, type?: "info" | "error") => void;
  onOpenDialog?: (type: "new-branch" | "new-worktree", e: React.MouseEvent) => void;
}

const GitCommitPanel: React.FC<GitCommitPanelProps> = ({
  project,
  commands,
  capabilities,
  onRefreshGit,
  onSelectFile,
  onShowToast,
  onOpenDialog,
}) => {
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [aheadBehind, setAheadBehind] = useState<AheadBehind | null>(null);
  const [loading, setLoading] = useState(false);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [textareaHeight, setTextareaHeight] = useState(120);
  const dragStartRef = useRef<{ startY: number; startHeight: number } | null>(null);

  // AI 生成 commit message 相关状态
  const [commitMessage, setCommitMessage] = useState("");
  const [aiGenerating, setAiGenerating] = useState(false);
  const { config } = useAppContext();

  const changedFiles = project.gitInfo?.changed_files ?? [];

  const noCommits = project.gitInfo !== null &&
    project.gitInfo.branches.length === 0 &&
    !project.gitInfo.current_branch;

  // Diff stats 懒加载：首次渲染后异步获取 +/- 统计
  const [diffStats, setDiffStats] = useState<Record<string, { additions: number; deletions: number }>>({});

  useEffect(() => {
    if (changedFiles.length === 0) {
      setDiffStats({});
      return;
    }
    let cancelled = false;
    invoke<Array<{ path: string; additions: number; deletions: number }>>(
      "unified_get_changed_files_diff_stats",
      { transport: { Local: { project_path: project.path } } }
    )
      .then((stats) => {
        if (cancelled) return;
        const map: Record<string, { additions: number; deletions: number }> = {};
        for (const s of stats) {
          map[s.path] = { additions: s.additions, deletions: s.deletions };
        }
        setDiffStats(map);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [project.id, changedFiles.length]);

  // 合并 diff stats 到文件列表
  const changedFilesWithStats = changedFiles.map((f) => ({
    ...f,
    additions: diffStats[f.path]?.additions ?? f.additions,
    deletions: diffStats[f.path]?.deletions ?? f.deletions,
  }));

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
    if (!project.gitInfo) return;
    refreshAheadBehind();
  }, [project.id]);

  // Guard against userSelect/cursor leak: if this component unmounts while a
  // divider drag is still in progress the document-level mouseup handler will
  // never fire, leaving body styles permanently dirty.
  useEffect(() => {
    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, []);

  // AI 按钮仅当 capabilities.canGenerateCommitMessage 且已选择 agent 时可用
  const canAiGenerate = capabilities.canGenerateCommitMessage && !!project.selectedAgent;

  const handleAiGenerate = useCallback(async () => {
    if (!capabilities.canGenerateCommitMessage || !project.selectedAgent) return;
    const files = Array.from(selectedFiles);
    if (files.length === 0) {
      onShowToast?.("No files selected. Please select files to generate commit message.", "error");
      return;
    }
    setAiGenerating(true);
    try {
      const agentCommandOverride = config.agentCommandOverrides?.[project.selectedAgent] ?? null;
      const generated = await commands.generateCommitMessage(
        project.selectedAgent,
        files,
        agentCommandOverride,
      );
      setCommitMessage(generated.trim());
    } catch (e: unknown) {
      onShowToast?.(String(e), "error");
    } finally {
      setAiGenerating(false);
    }
  }, [capabilities.canGenerateCommitMessage, project.selectedAgent, selectedFiles, commands, config.agentCommandOverrides, onShowToast]);

  const refreshAheadBehind = async () => {
    try {
      const ab = await commands.getAheadBehind();
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
        await withTimeout(commands.discardFile(path), TIMEOUT_LOCAL_MS, "discard");
        await onRefreshGit();
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
    [commands, onRefreshGit, onShowToast]
  );

  const handleStageFile = useCallback(
    async (path: string) => {
      setLoading(true);
      try {
        await withTimeout(commands.stageFiles([path]), TIMEOUT_LOCAL_MS, "stage");
        await onRefreshGit();
        onShowToast?.("Staged file", "info");
      } catch (e: unknown) {
        onShowToast?.(String(e), "error");
      } finally {
        setLoading(false);
      }
    },
    [commands, onRefreshGit, onShowToast]
  );

  const handleStageAllUntracked = useCallback(
    async () => {
      const untrackedPaths = changedFiles
        .filter((f) => f.status === "Untracked")
        .map((f) => f.path);
      if (untrackedPaths.length === 0) return;
      setLoading(true);
      try {
        await withTimeout(commands.stageFiles(untrackedPaths), TIMEOUT_LOCAL_MS, "stage-all");
        await onRefreshGit();
        onShowToast?.(`Staged ${untrackedPaths.length} file(s)`, "info");
      } catch (e: unknown) {
        onShowToast?.(String(e), "error");
      } finally {
        setLoading(false);
      }
    },
    [changedFiles, commands, onRefreshGit, onShowToast]
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
        const result = await withTimeout(commands.commitFiles(files, message), TIMEOUT_LOCAL_MS, "commit") as CommitResult;
        await onRefreshGit();
        refreshAheadBehind();
        setSelectedFiles(new Set());
        setCommitMessage("");
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
    [selectedFiles, commands, onRefreshGit, refreshAheadBehind, onShowToast]
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
        await withTimeout(commands.commitFiles(files, message), TIMEOUT_LOCAL_MS, "commit");
        await withTimeout(commands.push(false), TIMEOUT_NETWORK_MS, "push");
        await onRefreshGit();
        refreshAheadBehind();
        setSelectedFiles(new Set());
        setCommitMessage("");
        onShowToast?.("Committed & pushed successfully", "info");
      } catch (e: unknown) {
        onShowToast?.(String(e), "error");
      } finally {
        setLoading(false);
      }
    },
    [selectedFiles, commands, onRefreshGit, onShowToast]
  );

  const handleFetch = useCallback(async () => {
    setLoading(true);
    try {
      await withTimeout(commands.fetch(), TIMEOUT_NETWORK_MS, "fetch");
      refreshAheadBehind();
      onShowToast?.("Fetched successfully", "info");
    } catch (e: unknown) {
      onShowToast?.(String(e), "error");
    } finally {
      setLoading(false);
    }
  }, [commands, onShowToast]);

  const handlePull = useCallback(async () => {
    setLoading(true);
    try {
      await withTimeout(commands.pull(), TIMEOUT_NETWORK_MS, "pull");
      await onRefreshGit();
      refreshAheadBehind();
      onShowToast?.("Pulled successfully", "info");
    } catch (e: unknown) {
      onShowToast?.(String(e), "error");
    } finally {
      setLoading(false);
    }
  }, [commands, onRefreshGit, onShowToast]);

  const handlePush = useCallback(async () => {
    setLoading(true);
    try {
      await withTimeout(commands.push(false), TIMEOUT_NETWORK_MS, "push");
      await onRefreshGit();
      refreshAheadBehind();
      onShowToast?.("Pushed successfully", "info");
    } catch (e: unknown) {
      onShowToast?.(String(e), "error");
    } finally {
      setLoading(false);
    }
  }, [commands, onRefreshGit, onShowToast]);

  const handleNewBranch = useCallback(() => {
    if (onOpenDialog) {
      onOpenDialog("new-branch", {} as React.MouseEvent);
    } else {
      setDialog({
        type: "new-branch",
        projectId: project.id,
        branches: project.gitInfo?.branches ?? [],
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
        branches: project.gitInfo?.branches ?? [],
        projectPath: project.path,
      });
    }
  }, [onOpenDialog, project]);

  const handleCheckoutBranch = useCallback(async (branchName: string) => {
    try {
      await commands.checkoutBranch(branchName);
      await onRefreshGit();
    } catch (e: unknown) {
      onShowToast?.(String(e), "error");
    }
  }, [commands, onRefreshGit, onShowToast]);

  const handleDialogClose = useCallback(() => {
    setDialog(null);
  }, []);

  // GitDialog onRefreshGit shim: local dialogs pass projectId, but we use onRefreshGit() directly
  const handleDialogRefreshGit = useCallback((_projectId: string) => {
    onRefreshGit().catch(console.error);
  }, [onRefreshGit]);

  return (
    <div className="flex flex-col h-full gap-0.5 p-1.5">
      {dialog && (
        <GitDialog
          dialog={dialog}
          onClose={handleDialogClose}
          onRefreshGit={handleDialogRefreshGit}
        />
      )}
      <BranchInfo
        gitInfo={project.gitInfo ?? null}
        aheadBehind={aheadBehind}
        loading={loading}
        onFetch={handleFetch}
        onPull={handlePull}
        onPush={handlePush}
        onRefresh={() => {
          onRefreshGit().catch(console.error);
          refreshAheadBehind();
        }}
        onNewBranch={handleNewBranch}
        onNewWorktree={handleNewWorktree}
        onCheckoutBranch={handleCheckoutBranch}
      />

      <div className="flex-1 min-h-0 flex flex-col overflow-hidden rounded-md">
        {noCommits ? (
          <div className="flex-1 flex items-center justify-center">
            <span className="text-[var(--font-size)] text-text-muted py-4">No commits yet</span>
          </div>
        ) : (
          <ChangesList
            files={changedFilesWithStats}
            selectedFiles={selectedFiles}
            onToggleFile={toggleFile}
            onDiscardFile={handleDiscardFile}
            onStageFile={handleStageFile}
            onStageAllUntracked={handleStageAllUntracked}
            onFileSelect={(path) => onSelectFile?.(path)}
            loading={loading}
          />
        )}
      </div>

      {/* Draggable divider */}
      <div
        className="group h-1.5 shrink-0 cursor-row-resize flex items-center justify-center"
        onMouseDown={handleDividerMouseDown}
      >
        <div className="w-8 h-[3px] rounded-full bg-border group-hover:bg-accent-blue/50 transition-colors duration-150" />
      </div>

      <CommitForm
        message={commitMessage}
        onMessageChange={setCommitMessage}
        onCommit={handleCommit}
        onCommitAndPush={handleCommitAndPush}
        onAiGenerate={capabilities.canGenerateCommitMessage ? handleAiGenerate : undefined}
        canAiGenerate={canAiGenerate}
        aiGenerating={aiGenerating}
        loading={loading}
        textareaHeight={textareaHeight}
      />

      {capabilities.canManagePRs && (
        <PullRequestsPanel
          projectId={project.id}
          onShowToast={onShowToast}
          onRefreshGit={handleDialogRefreshGit}
        />
      )}
    </div>
  );
};

export default React.memo(GitCommitPanel);
