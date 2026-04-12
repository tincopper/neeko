import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Worktree, FileChange } from "../../types";
import FileTree, { buildTree } from "./FileTree";
import { BranchIcon, ChevronRightIcon, TrashIcon, FolderGitIcon } from "../icons";
import { terminalCache, destroyTerminalCache } from "../terminal";

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

  const filtered = useMemo(
    () => worktrees,
    [worktrees],
  );

  const worktreesExpanded = expandedSections["__worktrees__"] ?? true;

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

  if (filtered.length === 0) return null;

  return (
    <>
      <div className="gh-section-label gh-section-label-collapsible" onClick={(e) => toggleSection("__worktrees__", e)}>
        <ChevronRightIcon size={9} className={`gh-section-chevron ${worktreesExpanded ? "expanded" : ""}`} />
        Worktrees
      </div>
      {worktreesExpanded && (
        <div className="gh-worktree-list">
          {filtered.map((wt) => {
            const isExpanded = expandedWt.has(wt.path);
            const wtFiles = changedFiles[wt.path] ?? [];
            const wtTree = isExpanded ? buildTree(wtFiles) : [];
            const wtAdd = wtFiles.reduce((s, f) => s + f.additions, 0);
            const wtDel = wtFiles.reduce((s, f) => s + f.deletions, 0);
            return (
              <div key={wt.path} className="gh-worktree-wrapper">
                <div
                  className={`gh-worktree-item gh-worktree-item-standalone${deleting === wt.path ? " wt-deleting" : ""}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (renaming === wt.path || deleting === wt.path) return;
                    onOpenWorktreeTerminal?.(projectId, wt.path, wt.branch);
                  }}
                  title={`${wt.path}\nClick to open terminal`}
                >
                  <FolderGitIcon
                    size={15}
                    style={{ opacity: 0.7, cursor: "pointer", flexShrink: 0 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (renaming === wt.path || deleting === wt.path) return;
                      toggleExpand(wt.path);
                    }}
                  />
                  {renaming === wt.path ? (
                    <input
                      ref={renameInputRef}
                      className="gh-inline-rename-input"
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
                    <span className="gh-worktree-name" onDoubleClick={(e) => startRename(wt.path, e)} title="Double-click to rename">
                      {wt.path.split(/[\\/]/).pop()}
                    </span>
                  )}
                  {deleting === wt.path ? (
                    <span className="wt-spinner" title="Removing..." />
                  ) : (
                    <button className="gh-icon-btn gh-icon-btn-danger gh-worktree-remove" onClick={(e) => handleRemove(wt.path, wt.branch, e)} title="Remove worktree and branch">
                      <TrashIcon size={12} />
                    </button>
                  )}
                  <span className="gh-branch-inline" title={wt.branch}>
                    <BranchIcon size={11} /> {wt.branch}
                  </span>
                </div>
                {isExpanded && (
                  <div className="gh-worktree-changes">
                    {wtTree.length > 0 ? (
                      <>
                        <div className="gh-section-label gh-section-label-collapsible" onClick={(e) => toggleSection("wt-changes:" + wt.path, e)}>
                          <ChevronRightIcon size={9} className={`gh-section-chevron ${expandedSections["wt-changes:" + wt.path] !== false ? "expanded" : ""}`} />
                          Changes ({wtFiles.length})
                          {(wtAdd > 0 || wtDel > 0) && (
                            <span className="gh-changes-stats">
                              {wtAdd > 0 && <span className="gh-changes-additions">+{wtAdd}</span>}
                              {wtDel > 0 && <span className="gh-changes-deletions">-{wtDel}</span>}
                            </span>
                          )}
                        </div>
                        {expandedSections["wt-changes:" + wt.path] !== false && (
                          <div className="gh-file-tree">
                            <FileTree nodes={wtTree} projectId={projectId} onSelectFile={(_, fp) => onSelectWorktreeFile?.(wt.path, fp)} />
                          </div>
                        )}
                      </>
                    ) : changedFiles[wt.path] !== undefined ? (
                      <div className="gh-section-label gh-section-label-collapsible" style={{ cursor: "default" }}>
                        <ChevronRightIcon size={9} style={{ opacity: 0 }} />No changes
                      </div>
                    ) : (
                      <div className="gh-section-label gh-section-label-collapsible" style={{ cursor: "default" }}>
                        <ChevronRightIcon size={9} style={{ opacity: 0 }} />Loading...
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {confirmDelete && (
        <div className="modal-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Remove Worktree</h3>
            {confirmDelete.isDirty ? (
              <p className="wt-confirm-message wt-confirm-warning">This worktree has uncommitted changes. Removing it will discard all local changes. Are you sure?</p>
            ) : (
              <p className="wt-confirm-message">Remove worktree <strong>{confirmDelete.path.split(/[\\/]/).pop()}</strong> and delete branch <strong>{confirmDelete.branch}</strong>?</p>
            )}
            <div className="wt-confirm-details">
              <span className="wt-confirm-path">{confirmDelete.path}</span>
              <span className="wt-confirm-branch"><BranchIcon size={11} /> {confirmDelete.branch}</span>
            </div>
            <div className="modal-actions">
              <button className="cancel-btn" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="confirm-btn confirm-btn-danger" onClick={() => performRemove(confirmDelete.path, confirmDelete.branch)}>
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
