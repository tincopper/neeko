import React, { useState, useCallback } from "react";
import { FileTree, buildTree } from "../files";
import {
  BranchIcon,
  ChevronRightIcon,
  CloseIcon,
  FolderGitIcon,
  TerminalIcon,
  TrashIcon,
} from "../icons";
import { cn } from "../../utils/cn";
import type { ProjectBodyProps } from "./types";
import type { FileChange } from "../../types";

const ProjectBody: React.FC<ProjectBodyProps> = React.memo(
  ({
    gitInfo,
    projectId,
    expandedSections,
    renamingWorktree,
    renameWorktreeValue,
    onToggleSection,
    onSelectFile,
    onOpenWorktreeTerminal,
    onStartRenameWorktree,
    onRenameWorktreeChange,
    onCommitRenameWorktree,
    onRemoveWorktree,
    onCancelRenameWorktree,
    renameWtInputRef,
    onSelectProject,
    isActive,
    onShowToast: _onShowToast,
    onGetWorktreeChangedFiles,
    onIsWorktreeDirty,
  }) => {
    const worktrees = gitInfo?.worktrees ?? [];

    // Worktree expand state & lazy-load changed files
    const [expandedWt, setExpandedWt] = useState<Set<string>>(new Set());
    const [wtChangedFiles, setWtChangedFiles] = useState<Record<string, FileChange[]>>({});
    const [deletingWorktree, setDeletingWorktree] = useState<string | null>(null);
    const [confirmDelete, setConfirmDelete] = useState<{ path: string; branch: string; isDirty: boolean } | null>(null);

    const toggleWorktreeExpand = useCallback(async (worktreePath: string) => {
      setExpandedWt((prev) => {
        const next = new Set(prev);
        if (next.has(worktreePath)) next.delete(worktreePath);
        else next.add(worktreePath);
        return next;
      });
      if (!wtChangedFiles[worktreePath] && onGetWorktreeChangedFiles) {
        try {
          const files = await onGetWorktreeChangedFiles(worktreePath);
          setWtChangedFiles((prev) => ({ ...prev, [worktreePath]: files }));
        } catch {
          setWtChangedFiles((prev) => ({ ...prev, [worktreePath]: [] }));
        }
      }
    }, [onGetWorktreeChangedFiles, wtChangedFiles]);

    const handleRemoveWorktree = useCallback(async (worktreePath: string, branch: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (onIsWorktreeDirty) {
        try {
          const isDirty = await onIsWorktreeDirty(worktreePath);
          setConfirmDelete({ path: worktreePath, branch, isDirty });
        } catch {
          setConfirmDelete({ path: worktreePath, branch, isDirty: false });
        }
      } else {
        setConfirmDelete({ path: worktreePath, branch, isDirty: false });
      }
    }, [onIsWorktreeDirty]);

    const performRemove = useCallback(() => {
      if (!confirmDelete) return;
      setDeletingWorktree(confirmDelete.path);
      onRemoveWorktree(confirmDelete.path, confirmDelete.branch);
      setConfirmDelete(null);
      setTimeout(() => setDeletingWorktree(null), 500);
    }, [confirmDelete, onRemoveWorktree]);

    return (
      <div className="py-0.5 pb-1">
        {/* "local" row — TerminalIcon + label */}
        <div
          className={cn(
            "group flex items-center gap-1 py-1 px-2 pl-4 mr-1 rounded-md transition-colors duration-100 cursor-pointer",
            isActive ? "bg-bg-tertiary/60 text-text-primary" : "text-text-secondary hover:bg-bg-hover hover:text-text-primary"
          )}
          onClick={() => onSelectProject()}
          title="Open primary terminal"
        >
          <TerminalIcon size={13} className="opacity-70 shrink-0" />
          <span className="flex-1 text-[var(--font-size)] font-semibold truncate min-w-0">
            local
          </span>
        </div>

        {/* Worktrees section */}
        {worktrees.length > 0 && (
          <div>
            <div>
              {worktrees.map((wt) => {
                const isExpanded = expandedWt.has(wt.path);
                const wtFiles = wtChangedFiles[wt.path] ?? [];
                const wtTree = isExpanded ? buildTree(wtFiles) : [];
                const wtAdd = wtFiles.reduce((s, f) => s + f.additions, 0);
                const wtDel = wtFiles.reduce((s, f) => s + f.deletions, 0);
                const isRenaming = renamingWorktree === wt.path;
                return (
                  <div key={wt.path} className="mb-0.5">
                    <div
                      className={cn(
                        "group flex items-center gap-1 py-1 px-2 pl-4 mr-1 text-[var(--font-size)] rounded-md text-text-secondary transition-colors duration-100 cursor-pointer hover:bg-bg-hover hover:text-text-primary",
                        deletingWorktree === wt.path && "wt-deleting"
                      )}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (isRenaming || deletingWorktree === wt.path) return;
                        onOpenWorktreeTerminal(wt.path, wt.branch);
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        if (!isRenaming) onStartRenameWorktree(wt.path);
                      }}
                      title={`${wt.path}\nClick to open terminal`}
                    >
                      <FolderGitIcon
                        size={15}
                        className="opacity-70 cursor-pointer shrink-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isRenaming || deletingWorktree === wt.path) return;
                          toggleWorktreeExpand(wt.path);
                        }}
                      />
                      {isRenaming ? (
                        <input
                          ref={renameWtInputRef}
                          className="flex-1 min-w-0 bg-bg-tertiary border border-accent-blue rounded text-text-primary text-inherit font-inherit px-1 py-0.5 outline-none box-border"
                          value={renameWorktreeValue}
                          onChange={(e) => onRenameWorktreeChange(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") { e.preventDefault(); onCommitRenameWorktree(); }
                            if (e.key === "Escape") { e.preventDefault(); onCancelRenameWorktree(); }
                          }}
                          onBlur={onCommitRenameWorktree}
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <span
                          className="flex-1 text-[var(--font-size)] truncate min-w-0"
                          onDoubleClick={() => onStartRenameWorktree(wt.path)}
                          title="Double-click to rename"
                        >
                          {wt.path.split(/[\\/]/).pop()}
                        </span>
                      )}
                      {deletingWorktree === wt.path ? (
                        <span className="wt-spinner" title="Removing..." />
                      ) : (
                        <button
                          className="bg-transparent border-none text-text-muted cursor-pointer px-1.5 py-0.5 rounded flex items-center transition-all duration-150 hover:bg-bg-tertiary hover:text-text-primary hover:text-accent-red opacity-0 group-hover:opacity-100"
                          onClick={(e) => handleRemoveWorktree(wt.path, wt.branch, e)}
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
                              onClick={(e) => onToggleSection("wt-changes:" + wt.path, e)}
                            >
                              <ChevronRightIcon
                                size={9}
                                className={cn("text-[0.6em] text-text-muted w-2.5 shrink-0 transition-transform duration-150", expandedSections["wt-changes:" + wt.path] !== false && "rotate-90")}
                              />
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
                                <FileTree
                                  nodes={wtTree}
                                  projectId={projectId}
                                  onSelectFile={(_, fp) => onSelectFile(fp)}
                                />
                              </div>
                            )}
                          </>
                        ) : wtChangedFiles[wt.path] !== undefined ? (
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
          </div>
        )}

        {/* Confirm delete modal */}
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
                  Remove worktree{" "}
                  <strong className="text-accent-blue">{confirmDelete.path.split(/[\\/]/).pop()}</strong>{" "}
                  and delete branch{" "}
                  <strong className="text-accent-blue">{confirmDelete.branch}</strong>?
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
                  onClick={performRemove}
                >
                  <TrashIcon size={13} />
                  {confirmDelete.isDirty ? "Force Remove" : "Remove"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  },
);

ProjectBody.displayName = "ProjectBody";

export default ProjectBody;
