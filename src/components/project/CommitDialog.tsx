import React, { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../ui/dialog";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import type { FileChange, CommitEntry } from "../../types";
import { useProjectStore } from "../../store/projectStore";

interface CommitDialogProps {
  projectId: string;
  onClose: () => void;
  onRefreshGit: (projectId: string) => void;
}

function CommitDialog({ projectId, onClose, onRefreshGit }: CommitDialogProps) {
  const [files, setFiles] = useState<FileChange[]>([]);
  const [untrackedCount, setUntrackedCount] = useState(0);
  const [filesLoading, setFilesLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [amend, setAmend] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const projectPath = useProjectStore.getState().projects.find(p => p.id === projectId)?.path ?? "";
    invoke<FileChange[]>("unified_get_worktree_changed_files", {
      transport: { Local: { project_path: projectPath } },
      worktreePath: "",
    })
      .then((result) => {
        const untracked = result.filter((f) => f.status === "Untracked");
        setUntrackedCount(untracked.length);
        setFiles(result.filter((f) => f.status !== "Untracked"));
      })
      .catch((e) => setError(String(e)))
      .finally(() => setFilesLoading(false));
  }, [projectId]);

  useEffect(() => {
    if (!amend) {
      setMessage("");
      return;
    }
    const projectPath = useProjectStore.getState().projects.find(p => p.id === projectId)?.path ?? "";
    invoke<CommitEntry[]>("unified_get_commit_log", {
      transport: { Local: { project_path: projectPath } },
      count: 1,
    })
      .then((entries) => {
        if (entries.length > 0) setMessage(entries[0].message);
      })
      .catch(() => {});
  }, [amend, projectId]);

  const getProjectPath = useCallback(() => {
    return useProjectStore.getState().projects.find(p => p.id === projectId)?.path ?? "";
  }, [projectId]);

  const handleCommit = useCallback(async (pushAfter: boolean) => {
    if (!message.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const filePaths = files.map((f) => f.path);
      const projectPath = getProjectPath();
      await invoke("unified_commit_files", {
        transport: { Local: { project_path: projectPath } },
        filePaths,
        message: message.trim(),
      });
      if (pushAfter) {
        await invoke("unified_push", {
          transport: { Local: { project_path: projectPath } },
          setUpstream: false,
        });
      }
      onRefreshGit(projectId);
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  }, [projectId, message, files, onRefreshGit, onClose, getProjectPath]);

  const handlePush = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      const projectPath = getProjectPath();
      await invoke("unified_push", {
        transport: { Local: { project_path: projectPath } },
        setUpstream: false,
      });
      onRefreshGit(projectId);
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  }, [projectId, onRefreshGit, onClose, getProjectPath]);

  const handlePull = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      const projectPath = getProjectPath();
      await invoke("unified_pull", {
        transport: { Local: { project_path: projectPath } },
      });
      onRefreshGit(projectId);
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  }, [projectId, onRefreshGit, onClose, getProjectPath]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Commit Changes</DialogTitle>
        </DialogHeader>

        {/* File list */}
        <div className="mb-3">
          <span className="text-xs text-text-secondary uppercase tracking-wide">
            Files ({files.length})
          </span>
          {filesLoading ? (
            <p className="text-text-muted text-[13px] mt-1">Loading...</p>
          ) : files.length === 0 && untrackedCount === 0 ? (
            <p className="text-text-muted text-[13px] mt-1">No uncommitted changes</p>
          ) : (
            <div className="max-h-[140px] overflow-y-auto mt-1 border border-border rounded-md bg-bg-secondary/50">
              {files.map((f) => (
                <div key={f.path} className="flex items-center gap-2 px-2.5 py-1.5 text-[13px] border-b border-border/50 last:border-b-0">
                  <span className="text-accent-green shrink-0 text-[11px] font-bold w-4">
                    {f.status[0]}
                  </span>
                  <span className="text-text-primary truncate">{f.path}</span>
                  {f.additions > 0 && (
                    <span className="text-green-500 text-[11px] shrink-0">+{f.additions}</span>
                  )}
                  {f.deletions > 0 && (
                    <span className="text-red-500 text-[11px] shrink-0">-{f.deletions}</span>
                  )}
                </div>
              ))}
            </div>
          )}
          {untrackedCount > 0 && (
            <p className="text-[11px] text-text-muted mt-1">
              {untrackedCount} untracked file{untrackedCount > 1 ? "s" : ""} not shown (stage them in the Git panel first)
            </p>
          )}
        </div>

        {/* Amend checkbox */}
        <div className="mb-3">
          <Checkbox
            checked={amend}
            onCheckedChange={(checked) => setAmend(!!checked)}
            label="Amend last commit"
          />
        </div>

        {/* Message */}
        <textarea
          className="w-full bg-bg-secondary border border-border rounded-md px-3 py-2 text-[13px] text-text-primary placeholder-text-muted resize-none outline-none focus:border-accent"
          rows={4}
          placeholder="Commit message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              handleCommit(false);
            }
          }}
          autoFocus
        />

        {error && (
          <p className="text-accent-red bg-accent-red/10 border border-accent-red rounded-md p-3 mt-3 text-[13px]">
            {error}
          </p>
        )}

        <DialogFooter className="flex-col gap-2">
          <div className="flex items-center gap-2 w-full">
            <Button
              variant="secondary"
              onClick={handlePull}
              disabled={submitting}
              className="flex-1"
            >
              {submitting ? "..." : "Pull"}
            </Button>
            <Button
              variant="secondary"
              onClick={handlePush}
              disabled={submitting}
              className="flex-1"
            >
              {submitting ? "..." : "Push"}
            </Button>
          </div>
          <div className="flex items-center gap-2 w-full">
            <Button variant="secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => handleCommit(false)}
              disabled={!message.trim() || submitting || files.length === 0}
              className="flex-1"
            >
              {submitting ? "Committing..." : "Commit"}
            </Button>
            <Button
              variant="primary"
              onClick={() => handleCommit(true)}
              disabled={!message.trim() || submitting || files.length === 0}
              className="flex-1"
            >
              {submitting ? "..." : "Commit & Push"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default React.memo(CommitDialog);
