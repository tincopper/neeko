import React, { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export type DialogType = "new-branch" | "new-worktree";

export interface DialogState {
  type: DialogType;
  projectId: string;
  branches: string[];
}

interface GitDialogProps {
  dialog: DialogState;
  onClose: () => void;
  onRefreshGit: (projectId: string) => void;
}

const GitDialog: React.FC<GitDialogProps> = ({
  dialog,
  onClose,
  onRefreshGit,
}) => {
  const [branchName, setBranchName] = useState("");
  const [worktreePath, setWorktreePath] = useState("");
  const [worktreeBranch, setWorktreeBranch] = useState("");
  const [newBranch, setNewBranch] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handleCreateBranch = async () => {
    if (!branchName.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await invoke("create_branch", {
        projectId: dialog.projectId,
        branchName: branchName.trim(),
      });
      onRefreshGit(dialog.projectId);
      onClose();
    } catch (e: any) {
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
      await invoke("create_worktree", {
        projectId: dialog.projectId,
        worktreePath: worktreePath.trim(),
        branchName: worktreeBranch.trim(),
        newBranch,
      });
      onRefreshGit(dialog.projectId);
      onClose();
    } catch (e: any) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {dialog.type === "new-branch" ? (
          <>
            <h3>New Branch</h3>
            <input
              className="path-input"
              placeholder="Branch name"
              value={branchName}
              onChange={(e) => setBranchName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateBranch()}
              autoFocus
            />
            {error && <p className="gh-dialog-error">{error}</p>}
            <div className="modal-actions">
              <button className="cancel-btn" onClick={onClose}>
                Cancel
              </button>
              <button
                className="confirm-btn"
                onClick={handleCreateBranch}
                disabled={!branchName.trim() || submitting}
              >
                {submitting ? "Creating..." : "Create Branch"}
              </button>
            </div>
          </>
        ) : (
          <>
            <h3>New Worktree</h3>
            <label className="gh-dialog-label">Worktree path</label>
            <input
              className="path-input"
              placeholder="../my-feature"
              value={worktreePath}
              onChange={(e) => setWorktreePath(e.target.value)}
              autoFocus
            />
            <label className="gh-dialog-label" style={{ marginTop: 12 }}>
              Branch
            </label>
            <input
              className="path-input"
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
            <label className="gh-dialog-checkbox" style={{ marginTop: 10 }}>
              <input
                type="checkbox"
                checked={newBranch}
                onChange={(e) => setNewBranch(e.target.checked)}
              />
              Create new branch
            </label>
            {error && <p className="gh-dialog-error">{error}</p>}
            <div className="modal-actions">
              <button className="cancel-btn" onClick={onClose}>
                Cancel
              </button>
              <button
                className="confirm-btn"
                onClick={handleCreateWorktree}
                disabled={
                  !worktreePath.trim() || !worktreeBranch.trim() || submitting
                }
              >
                {submitting ? "Creating..." : "Create Worktree"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default GitDialog;
