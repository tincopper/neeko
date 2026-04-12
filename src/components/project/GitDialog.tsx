import React, { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { cn } from "../../utils/cn";

export type DialogType = "new-branch" | "new-worktree";

export interface DialogState {
  type: DialogType;
  projectId?: string;           // local project ID
  branches: string[];
  projectPath?: string;         // local project path (for quick worktree)
  source?: {                    // WSL/SSH source
    type: "wsl" | "remote";
    distro?: string;            // for WSL
    entryId?: string;           // for SSH
    projectPath: string;
  };
}

interface GitDialogProps {
  dialog: DialogState;
  onClose: () => void;
  onRefreshGit: (projectId: string) => void;
  onRefreshAfterWslSsh?: () => void;  // 用于 WSL/SSH dialog 完成后刷新
}

const GitDialog: React.FC<GitDialogProps> = ({
  dialog,
  onClose,
  onRefreshGit,
  onRefreshAfterWslSsh,
}) => {
  const [branchName, setBranchName] = useState("");
  const [worktreePath, setWorktreePath] = useState("");
  const [worktreeBranch, setWorktreeBranch] = useState("");
  const [newBranch, setNewBranch] = useState(false);
  const [customMode, setCustomMode] = useState(false);
  const [quickName, setQuickName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handleCreateBranch = async () => {
    if (!branchName.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const src = dialog.source;
      if (src?.type === "wsl") {
        await invoke("wsl_create_branch", { distro: src.distro, projectPath: src.projectPath, branchName: branchName.trim() });
        onRefreshAfterWslSsh?.();
      } else if (src?.type === "remote") {
        // SSH git commands need auth — not supported in this dialog yet
        setError("SSH branch creation not yet supported");
        setSubmitting(false);
        return;
      } else {
        await invoke("create_branch", { projectId: dialog.projectId, branchName: branchName.trim() });
        onRefreshGit(dialog.projectId ?? "");
      }
      onClose();
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateQuickWorktree = async () => {
    if (!quickName.trim()) return;
    const name = quickName.trim();
    const computedPath = `.neeko/worktrees/${name}`;
    setSubmitting(true);
    setError(null);
    try {
      const src = dialog.source;
      if (src?.type === "wsl") {
        await invoke("wsl_create_worktree", { distro: src.distro, projectPath: src.projectPath, worktreePath: computedPath, branchName: name, newBranch: true });
        onRefreshAfterWslSsh?.();
      } else if (src?.type === "remote") {
        setError("SSH worktree creation not yet supported");
        setSubmitting(false);
        return;
      } else {
        await invoke("create_worktree", { projectId: dialog.projectId, worktreePath: computedPath, branchName: name, newBranch: true });
        onRefreshGit(dialog.projectId ?? "");
      }
      onClose();
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateWorktree = async () => {
    if (!worktreePath.trim() || !worktreeBranch.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const src = dialog.source;
      if (src?.type === "wsl") {
        await invoke("wsl_create_worktree", { distro: src.distro, projectPath: src.projectPath, worktreePath: worktreePath.trim(), branchName: worktreeBranch.trim(), newBranch });
        onRefreshAfterWslSsh?.();
      } else if (src?.type === "remote") {
        setError("SSH worktree creation not yet supported");
        setSubmitting(false);
        return;
      } else {
        await invoke("create_worktree", { projectId: dialog.projectId, worktreePath: worktreePath.trim(), branchName: worktreeBranch.trim(), newBranch });
        onRefreshGit(dialog.projectId ?? "");
      }
      onClose();
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[1000]" onClick={onClose}>
      <div className="bg-bg-secondary border border-border rounded-lg p-6 min-w-[400px] max-w-[500px] shadow-xl overflow-visible" onClick={(e) => e.stopPropagation()}>
        {dialog.type === "new-branch" ? (
          <>
            <h3 className="mb-3 text-lg font-semibold text-text-primary">New Branch</h3>
            <input
              className="w-full p-3 bg-bg-primary border border-border rounded-md text-text-primary text-[var(--font-size)] font-mono outline-none transition-border-color duration-200 focus:border-accent-blue"
              placeholder="Branch name"
              value={branchName}
              onChange={(e) => setBranchName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateBranch()}
              autoFocus
            />
            {error && <p className="text-accent-red bg-accent-red/10 border border-accent-red rounded-md p-3 mb-4 text-[13px]">{error}</p>}
            <div className="flex justify-end gap-3 mt-5">
              <button className="px-4 py-2 bg-bg-tertiary border border-border rounded-md text-text-primary text-[var(--font-size)] cursor-pointer transition-all duration-200 hover:bg-bg-hover" onClick={onClose}>
                Cancel
              </button>
              <button
                className="px-4 py-2 bg-accent-blue border-none rounded-md text-white text-[var(--font-size)] font-medium cursor-pointer transition-colors duration-200 hover:bg-[#005a9e] disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={handleCreateBranch}
                disabled={!branchName.trim() || submitting}
              >
                {submitting ? "Creating..." : "Create Branch"}
              </button>
            </div>
          </>
        ) : (
          <>
            <h3 className="mb-3 text-lg font-semibold text-text-primary">New Worktree</h3>
            {dialog.projectId && !dialog.source && (
              <div className="flex items-center gap-2 mb-3.5">
                <span className={cn("text-xs text-text-muted font-medium uppercase tracking-[0.3px] transition-colors duration-150", !customMode && "text-text-primary")}>Quick</span>
                <button
                  className="relative w-[34px] h-[18px] bg-bg-tertiary border border-border rounded-[9px] cursor-pointer p-0 outline-none transition-background duration-200 hover:bg-bg-hover focus-visible:outline-2 focus-visible:outline-accent-blue focus-visible:outline-offset-[1px]"
                  onClick={() => setCustomMode(!customMode)}
                  title={customMode ? "Switch to Quick mode" : "Switch to Custom mode"}
                  aria-label={customMode ? "Switch to Quick mode" : "Switch to Custom mode"}
                >
                  <span className={cn("absolute top-0.5 left-0.5 w-3 h-3 bg-text-secondary rounded-full transition-all duration-200", customMode && "translate-x-4 bg-accent-blue")} />
                </button>
                <span className={cn("text-xs text-text-muted font-medium uppercase tracking-[0.3px] transition-colors duration-150", customMode && "text-text-primary")}>Custom</span>
              </div>
            )}
            {customMode || !dialog.projectId || dialog.source ? (
              <>
                <label className="block text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-wide">Worktree path</label>
                <input
                  className="w-full p-3 bg-bg-primary border border-border rounded-md text-text-primary text-[var(--font-size)] font-mono outline-none transition-border-color duration-200 focus:border-accent-blue"
                  placeholder="../my-feature"
                  value={worktreePath}
                  onChange={(e) => setWorktreePath(e.target.value)}
                  autoFocus
                />
                <label className="block text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-wide" style={{ marginTop: 12 }}>
                  Branch
                </label>
                <input
                  className="w-full p-3 bg-bg-primary border border-border rounded-md text-text-primary text-[var(--font-size)] font-mono outline-none transition-border-color duration-200 focus:border-accent-blue"
                  placeholder="Branch name"
                  value={worktreeBranch}
                  onChange={(e) => setWorktreeBranch(e.target.value)}
                  list={`branches-${dialog.projectId}`}
                />
                <datalist id={`branches-${dialog.projectId}`}>
                  {dialog.branches.map((b) => (
                    <option key={b} value={b} />
                  ))}
                </datalist>
                <label className="custom-checkbox flex items-center gap-1.5 text-sm text-text-secondary cursor-pointer" style={{ marginTop: 10 }}>
                  <input
                    type="checkbox"
                    checked={newBranch}
                    onChange={(e) => setNewBranch(e.target.checked)}
                  />
                  <span className="checkbox-mark" />
                  Create new branch
                </label>
                {error && <p className="text-accent-red bg-accent-red/10 border border-accent-red rounded-md p-3 mb-4 text-[13px]">{error}</p>}
                <div className="flex justify-end gap-3 mt-5">
                  <button className="px-4 py-2 bg-bg-tertiary border border-border rounded-md text-text-primary text-[var(--font-size)] cursor-pointer transition-all duration-200 hover:bg-bg-hover" onClick={onClose}>
                    Cancel
                  </button>
                  <button
                    className="px-4 py-2 bg-accent-blue border-none rounded-md text-white text-[var(--font-size)] font-medium cursor-pointer transition-colors duration-200 hover:bg-[#005a9e] disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={handleCreateWorktree}
                    disabled={
                      !worktreePath.trim() || !worktreeBranch.trim() || submitting
                    }
                  >
                    {submitting ? "Creating..." : "Create Worktree"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <label className="block text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-wide">Worktree name</label>
                <input
                  className="w-full p-3 bg-bg-primary border border-border rounded-md text-text-primary text-[var(--font-size)] font-mono outline-none transition-border-color duration-200 focus:border-accent-blue"
                  placeholder="feature-x"
                  value={quickName}
                  onChange={(e) => setQuickName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && quickName.trim() && handleCreateQuickWorktree()}
                  autoFocus
                />
                <div className="mt-1.5 text-[11px] text-text-muted font-mono break-all leading-[1.4]">
                  {dialog.projectPath && quickName.trim()
                    ? `${dialog.projectPath}/.neeko/worktrees/${quickName.trim()}`
                    : "Path: <project>/.neeko/worktrees/<name>"}
                </div>
                {error && <p className="text-accent-red bg-accent-red/10 border border-accent-red rounded-md p-3 mb-4 text-[13px]">{error}</p>}
                <div className="flex justify-end gap-3 mt-5">
                  <button className="px-4 py-2 bg-bg-tertiary border border-border rounded-md text-text-primary text-[var(--font-size)] cursor-pointer transition-all duration-200 hover:bg-bg-hover" onClick={onClose}>
                    Cancel
                  </button>
                  <button
                    className="px-4 py-2 bg-accent-blue border-none rounded-md text-white text-[var(--font-size)] font-medium cursor-pointer transition-colors duration-200 hover:bg-[#005a9e] disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={handleCreateQuickWorktree}
                    disabled={!quickName.trim() || submitting}
                  >
                    {submitting ? "Creating..." : "Create Worktree"}
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default React.memo(GitDialog);