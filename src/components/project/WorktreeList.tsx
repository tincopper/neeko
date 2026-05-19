import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Worktree, FileChange } from "../../types";
import { BranchIcon, CloseIcon, TrashIcon, FolderGitIcon } from "../icons";
import { terminalCache, destroyTerminalCache } from "../terminal";
import { cn } from "../../utils/cn";
import { useAppStore } from "../../store/appStore";
import SessionChips from "./SessionChips";

interface WorktreeListProps {
  worktrees: Worktree[];
  projectId: string;
  onOpenWorktreeTerminal?: (projectId: string, path: string, branch: string) => void;
  onRefreshGit: (projectId: string) => void;
  onShowToast?: (message: string, type?: "info" | "error") => void;
}

interface ChangeStat {
  add: number;
  del: number;
}

const WorktreeList: React.FC<WorktreeListProps> = ({
  worktrees,
  projectId,
  onOpenWorktreeTerminal,
  onRefreshGit,
  onShowToast,
}) => {
  const [changeStats, setChangeStats] = useState<Record<string, ChangeStat>>({});
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ path: string; branch: string; isDirty: boolean } | null>(null);
  const activeWorktreePath = useAppStore((s) => s.activeWorktreePath);

  const filteredWorktrees = useMemo(() => worktrees, [worktrees]);

  useEffect(() => {
    if (renaming !== null && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renaming]);

  // Worktree changes 仅用于 +A -D chip 聚合，懒加载一次。
  // 不再展开 FileTree（移到 DiffView）。
  useEffect(() => {
    let cancelled = false;
    for (const wt of filteredWorktrees) {
      if (changeStats[wt.path]) continue;
      invoke<FileChange[]>("get_worktree_changed_files", {
        projectId,
        worktreePath: wt.path,
      })
        .then((files) => {
          if (cancelled) return;
          const add = files.reduce((s, f) => s + f.additions, 0);
          const del = files.reduce((s, f) => s + f.deletions, 0);
          setChangeStats((prev) => ({ ...prev, [wt.path]: { add, del } }));
        })
        .catch(() => {
          if (cancelled) return;
          setChangeStats((prev) => ({ ...prev, [wt.path]: { add: 0, del: 0 } }));
        });
    }
    return () => {
      cancelled = true;
    };
    // intentionally rerun on worktrees identity / projectId
  }, [filteredWorktrees, projectId, changeStats]);

  const handleRemove = useCallback(async (worktreePath: string, branch: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const isDirty = await invoke<boolean>("is_worktree_dirty", { projectId, worktreePath });
      setConfirmDelete({ path: worktreePath, branch, isDirty });
    } catch {
      setConfirmDelete({ path: worktreePath, branch, isDirty: false });
    }
  }, [projectId]);

  const performRemove = useCallback(async (worktreePath: string, branch: string) => {
    setConfirmDelete(null);
    setDeleting(worktreePath);
    try {
      const wtCacheKey = `${projectId}:wt:${worktreePath}`;
      const wtCache = terminalCache.get(wtCacheKey);
      if (wtCache?.sessionId) {
        await invoke("close_terminal_session", { sessionId: wtCache.sessionId }).catch(() => {});
      }
      destroyTerminalCache(wtCacheKey);
      await invoke("remove_worktree", { projectId, worktreePath });
      let branchError: string | null = null;
      try {
        await invoke("delete_branch", { projectId, branchName: branch });
      } catch (e: unknown) {
        branchError = String(e);
      }
      await new Promise((r) => setTimeout(r, 450));
      onRefreshGit(projectId);
      if (branchError) {
        onShowToast?.(`Branch "${branch}" could not be deleted: ${branchError}`, "error");
      }
    } catch (e: unknown) {
      onShowToast?.(`Failed to remove worktree: ${String(e)}`, "error");
    } finally {
      setDeleting(null);
    }
  }, [projectId, onRefreshGit, onShowToast]);

  const startRename = useCallback((worktreePath: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setRenaming(worktreePath);
    setRenameValue(worktreePath.split(/[\\/]/).pop() ?? worktreePath);
  }, []);

  const commitRename = useCallback(async () => {
    const oldPath = renaming;
    if (!oldPath) return;
    const newName = renameValue.trim();
    setRenaming(null);
    if (!newName) return;
    const oldDirName = oldPath.split(/[\\/]/).pop() ?? "";
    if (newName === oldDirName) return;
    try {
      await invoke("rename_worktree", { projectId, worktreePath: oldPath, newName });
      onRefreshGit(projectId);
    } catch (e: unknown) {
      onShowToast?.(String(e), "error");
    }
  }, [renaming, renameValue, projectId, onRefreshGit, onShowToast]);

  const cancelRename = useCallback(() => {
    setRenaming(null);
    setRenameValue("");
  }, []);

  if (filteredWorktrees.length === 0) return null;

  return (
    <>
      {filteredWorktrees.map((wt) => {
        const stats = changeStats[wt.path];
        const isRenaming = renaming === wt.path;
        const isDeleting = deleting === wt.path;
        const isActive = activeWorktreePath === wt.path;
        const label = wt.path.split(/[\\/]/).pop() ?? wt.path;

        return (
          <div
            key={wt.path}
            className={cn(
              "group flex items-center gap-2.5 pl-4 pr-3 py-2 mx-1.5 rounded-md cursor-pointer transition-colors",
              isDeleting && "wt-deleting",
              isActive ? "bg-white/[0.04]" : "hover:bg-white/[0.025]",
            )}
            onClick={(e) => {
              e.stopPropagation();
              if (isRenaming || isDeleting) return;
              onOpenWorktreeTerminal?.(projectId, wt.path, wt.branch);
            }}
            title={`${wt.path}\nClick to open terminal`}
          >
            <span
              className={cn(
                "w-7 h-7 rounded-md flex items-center justify-center shrink-0",
                isActive ? "text-text-primary" : "text-text-muted",
              )}
              style={{
                backgroundColor: isActive ? "rgba(255,255,255,0.04)" : "transparent",
              }}
            >
              <FolderGitIcon size={16} />
            </span>
            <div className="flex-1 min-w-0">
              {isRenaming ? (
                <input
                  ref={renameInputRef}
                  className="w-full bg-bg-tertiary border border-accent-blue rounded text-text-primary text-[var(--font-size)] font-semibold px-1 py-0.5 outline-none box-border"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitRename();
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      cancelRename();
                    }
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <>
                  <div
                    className="text-[var(--font-size)] font-semibold text-text-primary truncate"
                    onDoubleClick={(e) => startRename(wt.path, e)}
                    title="Double-click to rename"
                  >
                    {label}
                  </div>
                  <div className="text-[0.85em] font-mono text-text-muted truncate">{wt.branch}</div>
                </>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {stats && (stats.add > 0 || stats.del > 0) && (
                <SessionChips.Changes add={stats.add} del={stats.del} />
              )}
              {isDeleting ? (
                <span className="wt-spinner" title="Removing..." />
              ) : (
                <button
                  data-no-drag
                  className="bg-transparent border-none text-text-muted cursor-pointer px-1.5 py-0.5 rounded flex items-center transition-all duration-150 hover:bg-bg-tertiary hover:!text-accent-red opacity-0 group-hover:opacity-100"
                  onClick={(e) => handleRemove(wt.path, wt.branch, e)}
                  title="Remove worktree and branch"
                >
                  <TrashIcon size={12} />
                </button>
              )}
            </div>
          </div>
        );
      })}
      {confirmDelete && (
        <div className="modal-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Remove Worktree</h3>
            {confirmDelete.isDirty ? (
              <p className="text-[13px] text-text-primary mb-3 leading-relaxed text-accent-yellow bg-accent-yellow/[0.08] p-2 px-3 rounded-md border-l-[3px] border-accent-yellow">
                This worktree has uncommitted changes. Removing it will discard all local changes. Are you sure?
              </p>
            ) : (
              <p className="text-[13px] text-text-primary mb-3 leading-relaxed">
                Remove worktree <strong className="text-accent-blue">{confirmDelete.path.split(/[\\/]/).pop()}</strong> and delete branch <strong className="text-accent-blue">{confirmDelete.branch}</strong>?
              </p>
            )}
            <div className="flex flex-col gap-1 p-2 px-3 bg-bg-tertiary rounded-md mb-4 font-mono text-xs">
              <span className="text-text-muted break-all">{confirmDelete.path}</span>
              <span className="flex items-center gap-1 text-accent-green">
                <BranchIcon size={11} /> {confirmDelete.branch}
              </span>
            </div>
            <div className="flex justify-end gap-3 mt-5">
              <button
                className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] bg-bg-tertiary border border-border rounded-md text-text-primary hover:bg-bg-hover transition-colors cursor-pointer"
                onClick={() => setConfirmDelete(null)}
              >
                <CloseIcon size={14} />
                Cancel
              </button>
              <button
                className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] bg-accent-red border-none rounded-md text-white font-medium hover:brightness-110 transition-colors cursor-pointer"
                onClick={() => performRemove(confirmDelete.path, confirmDelete.branch)}
              >
                <TrashIcon size={13} />
                {confirmDelete.isDirty ? "Force Remove" : "Remove"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default React.memo(WorktreeList);
