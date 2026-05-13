import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Worktree, FileChange } from "../../types";
import { FileTree, buildTree } from "../files";
import { BranchIcon, ChevronRightIcon, CloseIcon, TrashIcon, FolderGitIcon } from "../icons";
import { terminalCache, destroyTerminalCache } from "../terminal";
import { cn } from "../../utils/cn";
import { useAppStore } from "../../store/appStore";

interface WorktreeListProps {
  worktrees: Worktree[];
  projectId: string;
  expandedSections: Record<string, boolean>;
  toggleSection: (key: string, e: React.MouseEvent) => void;
  onOpenWorktreeTerminal?: (projectId: string, path: string, branch: string) => void;
  onSelectWorktreeFile?: (path: string, filePath: string) => void;
  onRefreshGit: (projectId: string) => void;
  onShowToast?: (message: string, type?: "info" | "error") => void;
}

const WorktreeList: React.FC<WorktreeListProps> = ({
  worktrees,
  projectId,
  expandedSections,
  toggleSection,
  onOpenWorktreeTerminal,
  onSelectWorktreeFile,
  onRefreshGit,
  onShowToast,
}) => {
  const [expandedWt, setExpandedWt] = useState<Set<string>>(new Set());
  const [changedFiles, setChangedFiles] = useState<Record<string, FileChange[]>>({});
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

  const toggleExpand = useCallback(async (worktreePath: string) => {
    setExpandedWt((prev) => {
      const next = new Set(prev);
      if (next.has(worktreePath)) next.delete(worktreePath);
      else next.add(worktreePath);
      return next;
    });
    if (!changedFiles[worktreePath]) {
      try {
        const files = await invoke<FileChange[]>("get_worktree_changed_files", {
          projectId,
          worktreePath,
        });
        setChangedFiles((prev) => ({ ...prev, [worktreePath]: files }));
      } catch {
        setChangedFiles((prev) => ({ ...prev, [worktreePath]: [] }));
      }
    }
  }, [projectId, changedFiles]);

  const handleRemove = async (worktreePath: string, branch: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const isDirty = await invoke<boolean>("is_worktree_dirty", { projectId, worktreePath });
      setConfirmDelete({ path: worktreePath, branch, isDirty });
    } catch {
      setConfirmDelete({ path: worktreePath, branch, isDirty: false });
    }
  };

  const performRemove = async (worktreePath: string, branch: string) => {
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
  };

  const startRename = (worktreePath: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setRenaming(worktreePath);
    setRenameValue(worktreePath.split(/[\\/]/).pop() ?? worktreePath);
  };

  const commitRename = async () => {
    const oldPath = renaming!;
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
  };

  const cancelRename = () => {
    setRenaming(null);
    setRenameValue("");
  };

  if (filteredWorktrees.length === 0) return null;

  return (
    <>
      <div>
        {filteredWorktrees.map((wt) => {
          const isExpanded = expandedWt.has(wt.path);
          const wtFiles = changedFiles[wt.path] ?? [];
          const wtTree = isExpanded ? buildTree(wtFiles) : [];
          const wtAdd = wtFiles.reduce((s, f) => s + f.additions, 0);
          const wtDel = wtFiles.reduce((s, f) => s + f.deletions, 0);
          return (
            <div key={wt.path} className="mb-0.5">
              <div
                className={cn(
                  "group flex items-center gap-1 py-1 px-2 pl-4 mr-1 text-[var(--font-size)] rounded-md transition-colors duration-100 cursor-pointer",
                  deleting === wt.path && "wt-deleting",
                  activeWorktreePath === wt.path
                    ? "bg-bg-tertiary/60 text-text-primary"
                    : "text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  if (renaming === wt.path || deleting === wt.path) return;
                  onOpenWorktreeTerminal?.(projectId, wt.path, wt.branch);
                }}
                title={`${wt.path}\nClick to open terminal`}
              >
                <FolderGitIcon
                  size={15}
                  className="opacity-70 cursor-pointer shrink-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (renaming === wt.path || deleting === wt.path) return;
                    toggleExpand(wt.path);
                  }}
                />
                {renaming === wt.path ? (
                  <input
                    ref={renameInputRef}
                    className="flex-1 min-w-0 bg-bg-tertiary border border-accent-blue rounded text-text-primary text-inherit font-inherit px-1 py-0.5 outline-none box-border"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); commitRename(); }
                      if (e.key === "Escape") { e.preventDefault(); cancelRename(); }
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span className="flex-1 text-[var(--font-size)] truncate min-w-0" onDoubleClick={(e) => startRename(wt.path, e)} title="Double-click to rename">
                    {wt.path.split(/[\\/]/).pop()}
                  </span>
                )}
                {deleting === wt.path ? (
                  <span className="wt-spinner" title="Removing..." />
                ) : (
                  <button
                    className="bg-transparent border-none text-text-muted cursor-pointer px-1.5 py-0.5 rounded flex items-center transition-all duration-150 hover:bg-bg-tertiary hover:text-text-primary hover:text-accent-red opacity-0 group-hover:opacity-100"
                    onClick={(e) => handleRemove(wt.path, wt.branch, e)}
                    title="Remove worktree and branch"
                  >
                    <TrashIcon size={12} />
                  </button>
                )}
              </div>
              {isExpanded && (
                <div>
                  {wtTree.length > 0 ? (
                    <>
                      <div
                        className="text-[0.72em] font-semibold uppercase tracking-[0.06em] text-text-muted py-0.5 px-2 select-none flex items-center gap-1 cursor-pointer rounded transition-colors duration-100 hover:bg-bg-hover hover:text-text-secondary"
                        onClick={(e) => toggleSection("wt-changes:" + wt.path, e)}
                      >
                        <ChevronRightIcon size={9} className={cn("text-[0.6em] text-text-muted w-2.5 shrink-0 transition-transform duration-150", expandedSections["wt-changes:" + wt.path] !== false && "rotate-90")} />
                        Changes ({wtFiles.length})
                        {(wtAdd > 0 || wtDel > 0) && (
                          <span className="inline-flex items-center gap-1 ml-auto font-semibold text-[1.1em]">
                            {wtAdd > 0 && <span className="text-[#3fb950] font-semibold">+{wtAdd}</span>}
                            {wtDel > 0 && <span className="text-[#f85149] font-semibold">-{wtDel}</span>}
                          </span>
                        )}
                      </div>
                      {expandedSections["wt-changes:" + wt.path] !== false && (
                        <div className="mt-0.5 pl-4">
                          <FileTree nodes={wtTree} projectId={projectId} onSelectFile={(_, fp) => onSelectWorktreeFile?.(wt.path, fp)} />
                        </div>
                      )}
                    </>
                  ) : changedFiles[wt.path] !== undefined ? (
                    <div className="text-[0.72em] font-semibold uppercase tracking-[0.06em] text-text-muted py-1 px-2 select-none flex items-center gap-1 cursor-default rounded">
                      <ChevronRightIcon size={9} className="opacity-0" />No changes
                    </div>
                  ) : (
                    <div className="text-[0.72em] font-semibold uppercase tracking-[0.06em] text-text-muted py-1 px-2 select-none flex items-center gap-1 cursor-default rounded">
                      <ChevronRightIcon size={9} className="opacity-0" />Loading...
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {confirmDelete && (
        <div className="modal-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Remove Worktree</h3>
            {confirmDelete.isDirty ? (
              <p className="text-[13px] text-text-primary mb-3 leading-relaxed text-accent-yellow bg-accent-yellow/[0.08] p-2 px-3 rounded-md border-l-[3px] border-accent-yellow">This worktree has uncommitted changes. Removing it will discard all local changes. Are you sure?</p>
            ) : (
              <p className="text-[13px] text-text-primary mb-3 leading-relaxed">Remove worktree <strong className="text-accent-blue">{confirmDelete.path.split(/[\\/]/).pop()}</strong> and delete branch <strong className="text-accent-blue">{confirmDelete.branch}</strong>?</p>
            )}
            <div className="flex flex-col gap-1 p-2 px-3 bg-bg-tertiary rounded-md mb-4 font-mono text-xs">
              <span className="text-text-muted break-all">{confirmDelete.path}</span>
              <span className="flex items-center gap-1 text-accent-green"><BranchIcon size={11} /> {confirmDelete.branch}</span>
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
