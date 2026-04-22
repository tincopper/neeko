import React, { useState, useCallback, useMemo } from "react";
import { FileTree, buildTree } from "../files";
import {
  BranchIcon,
  ChevronRightIcon,
  FolderGitIcon,
  TrashIcon,
} from "../icons";
import type { ProjectBodyProps, WtConfirmState } from "./types";

const ProjectBody: React.FC<ProjectBodyProps> = React.memo(
  ({
    gitInfo,
    projectId,
    expandedSections,
    renamingBranch,
    renameBranchValue,
    renamingWorktree,
    renameWorktreeValue,
    onToggleSection,
    onCheckoutBranch,
    onStartRenameBranch,
    onRenameBranchChange,
    onCommitRenameBranch,
    onCancelRename,
    onSelectFile,
    onOpenWorktreeTerminal,
    onStartRenameWorktree,
    onRenameWorktreeChange,
    onCommitRenameWorktree,
    onRemoveWorktree,
    onCancelRenameWorktree,
    renameInputRef,
    renameWtInputRef,
    currentBranch,
  }) => {
    const fileTree = useMemo(() => buildTree(gitInfo.changed_files), [gitInfo.changed_files]);
    const branchesExpanded = expandedSections["__branches__"] ?? true;
    const worktreesExpanded = expandedSections["__worktrees__"] ?? true;
    const [deletingWorktree, setDeletingWorktree] = useState<string | null>(null);
    const [confirmDelete, setConfirmDelete] = useState<WtConfirmState | null>(null);

    const handleConfirmRemove = useCallback((path: string, branch: string) => {
      setConfirmDelete({ path, branch });
    }, []);

    const performRemove = useCallback(() => {
      if (!confirmDelete) {
        return;
      }
      setDeletingWorktree(confirmDelete.path);
      onRemoveWorktree(confirmDelete.path, confirmDelete.branch);
      setConfirmDelete(null);
      setTimeout(() => setDeletingWorktree(null), 500);
    }, [confirmDelete, onRemoveWorktree]);

    return (
      <div className="py-0.5 pb-1">
        <div
          className="text-[0.72em] font-semibold uppercase tracking-[0.06em] text-text-muted py-1.5 px-2.5 select-none flex items-center gap-1 cursor-pointer rounded transition-colors duration-100 hover:bg-bg-hover hover:text-text-secondary"
          onClick={(e) => onToggleSection("__branches__", e)}
        >
          <ChevronRightIcon
            size={10}
            className={`text-[0.6em] text-text-muted w-2.5 shrink-0 transition-transform duration-150 ${
              branchesExpanded ? "rotate-90" : ""
            }`}
          />
          Branches
        </div>

        {branchesExpanded && (
          <div className="py-0 pb-1 pl-2">
            {gitInfo.branches.map((branch) => {
              const isCurrent = branch === gitInfo.current_branch;
              const isRenaming = renamingBranch === branch;
              const isExpanded = expandedSections[`branch:${branch}`] ?? isCurrent;

              return (
                <div key={branch}>
                  <div
                    className={`gh-branch-item flex items-center gap-1 py-1 px-2 text-base rounded-md text-text-secondary transition-colors duration-100 hover:bg-bg-hover hover:text-text-primary cursor-pointer ${
                      isCurrent ? "!text-accent-blue cursor-default" : ""
                    }`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isRenaming) {
                        return;
                      }
                      if (!isCurrent) {
                        onCheckoutBranch(branch);
                      } else {
                        onToggleSection(`branch:${branch}`, e);
                      }
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      if (!isRenaming) {
                        onStartRenameBranch(branch, gitInfo.current_branch);
                      }
                    }}
                  >
                    <BranchIcon size={11} style={{ opacity: 0.6 }} />
                    {isRenaming ? (
                      <input
                        ref={renameInputRef}
                        className="flex-1 min-w-0 bg-bg-tertiary border border-accent-blue rounded text-text-primary text-inherit font-inherit px-1 py-0.5 outline-none box-border"
                        value={renameBranchValue}
                        onChange={(e) => onRenameBranchChange(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            onCommitRenameBranch();
                          }
                          if (e.key === "Escape") {
                            e.preventDefault();
                            onCancelRename();
                          }
                        }}
                        onBlur={onCommitRenameBranch}
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <span className="flex-1 whitespace-nowrap overflow-hidden text-ellipsis text-base cursor-pointer">
                        {branch}
                      </span>
                    )}
                  </div>

                  {isCurrent && isExpanded && gitInfo.changed_files.length > 0 && (
                    <div className="mt-0.5 pl-4">
                      <FileTree
                        nodes={fileTree}
                        projectId={projectId}
                        onSelectFile={(_, fp) => onSelectFile(fp)}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {gitInfo.worktrees.length > 0 && (
          <>
            <div
              className="text-[0.72em] font-semibold uppercase tracking-[0.06em] text-text-muted py-1.5 px-2.5 select-none flex items-center gap-1 cursor-pointer rounded transition-colors duration-100 hover:bg-bg-hover hover:text-text-secondary"
              onClick={(e) => onToggleSection("__worktrees__", e)}
            >
              <ChevronRightIcon
                size={10}
                className={`text-[0.6em] text-text-muted w-2.5 shrink-0 transition-transform duration-150 ${
                  worktreesExpanded ? "rotate-90" : ""
                }`}
              />
              Worktrees
            </div>

            {worktreesExpanded && (
              <div className="py-0 pb-1 pl-4">
                {gitInfo.worktrees
                  .filter((wt) => wt.branch !== currentBranch)
                  .map((wt) => {
                    const isRenaming = renamingWorktree === wt.path;
                    return (
                      <div
                        key={wt.path}
                        className={`flex items-center gap-1 py-1 px-2 text-base rounded-md text-text-secondary transition-colors duration-100 cursor-pointer hover:bg-bg-hover ${
                          deletingWorktree === wt.path ? "wt-deleting" : ""
                        }`}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isRenaming || deletingWorktree === wt.path) {
                            return;
                          }
                          onOpenWorktreeTerminal(wt.path, wt.branch);
                        }}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          if (!isRenaming) {
                            onStartRenameWorktree(wt.path);
                          }
                        }}
                        title={`${wt.path}\nClick to open terminal`}
                      >
                        <FolderGitIcon size={15} style={{ opacity: 0.7 }} />
                        {isRenaming ? (
                          <input
                            ref={renameWtInputRef}
                            className="flex-1 min-w-0 bg-bg-tertiary border border-accent-blue rounded text-text-primary text-inherit font-inherit px-1 py-0.5 outline-none box-border"
                            value={renameWorktreeValue}
                            onChange={(e) => onRenameWorktreeChange(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                onCommitRenameWorktree();
                              }
                              if (e.key === "Escape") {
                                e.preventDefault();
                                onCancelRenameWorktree();
                              }
                            }}
                            onBlur={onCommitRenameWorktree}
                            onClick={(e) => e.stopPropagation()}
                          />
                        ) : (
                          <span className="flex-1 text-base truncate min-w-0">
                            {wt.path.split("/").pop()}
                          </span>
                        )}

                        {!isRenaming &&
                          (deletingWorktree === wt.path ? (
                            <span className="wt-spinner" title="Removing..." />
                          ) : (
                            <button
                              className="bg-transparent border-none text-text-muted cursor-pointer px-1.5 py-0.5 rounded flex items-center transition-all duration-150 hover:bg-bg-tertiary hover:text-accent-red opacity-0 group-hover:opacity-100"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleConfirmRemove(wt.path, wt.branch);
                              }}
                              title="Remove worktree and branch"
                            >
                              <TrashIcon size={12} />
                            </button>
                          ))}

                        <span
                          className="flex items-center gap-1 text-xs text-accent-blue font-mono bg-accent-blue/10 border border-accent-blue/20 rounded-full px-1.5 shrink-0 max-w-[90px] truncate cursor-pointer transition-colors duration-150 hover:bg-accent-blue/20 hover:border-accent-blue/40"
                          title={wt.branch}
                        >
                          <BranchIcon size={11} />
                          {wt.branch}
                        </span>
                      </div>
                    );
                  })}
              </div>
            )}
          </>
        )}

        {confirmDelete && (
          <div className="modal-overlay" onClick={() => setConfirmDelete(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <h3>Remove Worktree</h3>
              <p className="text-[13px] text-text-primary mb-3 leading-relaxed">
                Remove worktree{" "}
                <strong className="text-accent-blue">
                  {confirmDelete.path.split(/[\\/]/).pop()}
                </strong>{" "}
                and delete branch{" "}
                <strong className="text-accent-blue">{confirmDelete.branch}</strong>?
              </p>
              <div className="flex flex-col gap-1 p-2 px-3 bg-bg-tertiary rounded-md mb-4 font-mono text-xs">
                <span className="text-text-muted break-all">{confirmDelete.path}</span>
                <span className="flex items-center gap-1 text-accent-green">
                  <BranchIcon size={11} /> {confirmDelete.branch}
                </span>
              </div>
              <div className="modal-actions">
                <button className="cancel-btn" onClick={() => setConfirmDelete(null)}>
                  Cancel
                </button>
                <button className="confirm-btn confirm-btn-danger" onClick={performRemove}>
                  Remove
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
