import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { homeDir } from "@tauri-apps/api/path";
import { cn } from "../../../utils/cn";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/ui/dialog";
import { Input } from "@/ui/input";
import { Button } from "@/ui/button";
import { Checkbox } from "@/ui/checkbox";

export type DialogType = "new-branch" | "new-worktree";

export interface DialogState {
  type: DialogType;
  projectId?: string;
  branches: string[];
  projectPath?: string;
  source?: {
    type: "wsl" | "remote";
    distro?: string;
    entryId?: string;
    projectPath: string;
  };
}

interface GitDialogProps {
  dialog: DialogState;
  onClose: () => void;
  onRefreshGit: (projectId: string) => void;
  onRefreshAfterWslSsh?: () => void;
  remoteHomeDir?: string;
}

function ErrorMessage({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-accent-red bg-accent-red/10 border border-accent-red rounded-md p-3 mt-3 text-[13px]">
      {children}
    </p>
  );
}

const GitDialog: React.FC<GitDialogProps> = ({
  dialog,
  onClose,
  onRefreshGit,
  onRefreshAfterWslSsh,
  remoteHomeDir,
}) => {
  const [branchName, setBranchName] = useState("");
  const [worktreePath, setWorktreePath] = useState("");
  const [worktreeBranch, setWorktreeBranch] = useState("");
  const [newBranch, setNewBranch] = useState(false);
  const [customMode, setCustomMode] = useState(false);
  const [quickName, setQuickName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [homeDirPath, setHomeDirPath] = useState("");

  useEffect(() => {
    if (dialog.type !== "new-worktree") return;
    const src = dialog.source;
    if (src?.type === "wsl" && src.distro) {
      invoke<string>("get_wsl_home_dir", { distro: src.distro }).then(setHomeDirPath).catch(() => {});
    } else if (src?.type === "remote") {
      if (remoteHomeDir) setHomeDirPath(remoteHomeDir);
    } else {
      homeDir().then(setHomeDirPath).catch(() => {});
    }
  }, [dialog, remoteHomeDir]);

  const handleCreateBranch = async () => {
    if (!branchName.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const src = dialog.source;
      if (src?.type === "wsl") {
        await invoke("create_branch", {
          transport: { Wsl: { distro: src.distro, project_path: src.projectPath } },
          branchName: branchName.trim(),
        });
        onRefreshAfterWslSsh?.();
      } else if (src?.type === "remote") {
        setError("SSH branch creation not yet supported");
        setSubmitting(false);
        return;
      } else {
        await invoke("create_branch", {
          transport: { Local: { project_path: dialog.projectPath ?? "" } },
          branchName: branchName.trim(),
        });
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
    const computedPath = `${homeDirPath}/.neeko/worktrees/${name}`;
    setSubmitting(true);
    setError(null);
    try {
      const src = dialog.source;
      if (src?.type === "wsl") {
        await invoke("create_worktree", {
          transport: { Wsl: { distro: src.distro, project_path: src.projectPath } },
          worktreePath: computedPath,
          branchName: name,
          newBranch: true,
        });
        onRefreshAfterWslSsh?.();
      } else if (src?.type === "remote") {
        setError("SSH worktree creation not yet supported");
        setSubmitting(false);
        return;
      } else {
        await invoke("create_worktree", {
          transport: { Local: { project_path: dialog.projectPath ?? "" } },
          worktreePath: computedPath,
          branchName: name,
          newBranch: true,
        });
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
        await invoke("create_worktree", {
          transport: { Wsl: { distro: src.distro, project_path: src.projectPath } },
          worktreePath: worktreePath.trim(),
          branchName: worktreeBranch.trim(),
          newBranch,
        });
        onRefreshAfterWslSsh?.();
      } else if (src?.type === "remote") {
        setError("SSH worktree creation not yet supported");
        setSubmitting(false);
        return;
      } else {
        await invoke("create_worktree", {
          transport: { Local: { project_path: dialog.projectPath ?? "" } },
          worktreePath: worktreePath.trim(),
          branchName: worktreeBranch.trim(),
          newBranch,
        });
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
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[500px]">
        {dialog.type === "new-branch" ? (
          <>
            <DialogHeader>
              <DialogTitle>New Branch</DialogTitle>
            </DialogHeader>
            <Input
              placeholder="Branch name"
              value={branchName}
              onChange={(e) => setBranchName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateBranch()}
              autoFocus
            />
            {error && <ErrorMessage>{error}</ErrorMessage>}
            <DialogFooter>
              <Button variant="secondary" onClick={onClose}>Cancel</Button>
              <Button variant="primary" onClick={handleCreateBranch} disabled={!branchName.trim() || submitting}>
                {submitting ? "Creating..." : "Create Branch"}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>New Worktree</DialogTitle>
            </DialogHeader>
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
                <Input
                  placeholder="../my-feature"
                  value={worktreePath}
                  onChange={(e) => setWorktreePath(e.target.value)}
                  autoFocus
                />
                <label className="block text-xs font-medium text-text-secondary mb-1.5 mt-3 uppercase tracking-wide">
                  Branch
                </label>
                <Input
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
                <div className="mt-2.5">
                  <Checkbox
                    checked={newBranch}
                    onCheckedChange={(checked) => setNewBranch(!!checked)}
                    label="Create new branch"
                  />
                </div>
                {error && <ErrorMessage>{error}</ErrorMessage>}
                <DialogFooter>
                  <Button variant="secondary" onClick={onClose}>Cancel</Button>
                  <Button
                    variant="primary"
                    onClick={handleCreateWorktree}
                    disabled={!worktreePath.trim() || !worktreeBranch.trim() || submitting}
                  >
                    {submitting ? "Creating..." : "Create Worktree"}
                  </Button>
                </DialogFooter>
              </>
            ) : (
              <>
                <label className="block text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-wide">Worktree name</label>
                <Input
                  placeholder="feature-x"
                  value={quickName}
                  onChange={(e) => setQuickName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && quickName.trim() && handleCreateQuickWorktree()}
                  autoFocus
                />
                <div className="mt-1.5 text-[11px] text-text-muted font-mono break-all leading-[1.4]">
                  {homeDirPath && quickName.trim()
                    ? `${homeDirPath}/.neeko/worktrees/${quickName.trim()}`
                    : "Path: <home>/.neeko/worktrees/<name>"}
                </div>
                {error && <ErrorMessage>{error}</ErrorMessage>}
                <DialogFooter>
                  <Button variant="secondary" onClick={onClose}>Cancel</Button>
                  <Button
                    variant="primary"
                    onClick={handleCreateQuickWorktree}
                    disabled={!quickName.trim() || submitting}
                  >
                    {submitting ? "Creating..." : "Create Worktree"}
                  </Button>
                </DialogFooter>
              </>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default React.memo(GitDialog);
