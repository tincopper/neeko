import React, { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { FileTree, buildTree } from "../files";
import {
  BranchIcon,
  ChevronRightIcon,
  FolderGitIcon,
  PlusIcon,
  SearchIcon,
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
    renamingBranch: _renamingBranch,
    renameBranchValue: _renameBranchValue,
    renamingWorktree,
    renameWorktreeValue,
    onToggleSection,
    onCheckoutBranch,
    onStartRenameBranch: _onStartRenameBranch,
    onRenameBranchChange: _onRenameBranchChange,
    onCommitRenameBranch: _onCommitRenameBranch,
    onCancelRename: _onCancelRename,
    onSelectFile,
    onOpenWorktreeTerminal,
    onStartRenameWorktree,
    onRenameWorktreeChange,
    onCommitRenameWorktree,
    onRemoveWorktree,
    onCancelRenameWorktree,
    renameInputRef: _renameInputRef,
    renameWtInputRef,
    currentBranch,
    onSelectProject,
    isActive,
    onRefreshGit: _onRefreshGit,
    onShowToast,
    onOpenDialog,
    onGetWorktreeChangedFiles,
    onIsWorktreeDirty,
    onGetWorktreeFileDiff: _onGetWorktreeFileDiff,
  }) => {
    // Branch dropdown state (same pattern as ProjectGitSection)
    const [branchDropdownOpen, setBranchDropdownOpen] = useState(false);
    const [branchSearchQuery, setBranchSearchQuery] = useState("");
    const branchDropdownRef = useRef<HTMLDivElement>(null);
    const branchSearchInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
      if (!branchDropdownOpen) return;
      const handler = (e: MouseEvent) => {
        if (branchDropdownRef.current && !branchDropdownRef.current.contains(e.target as Node)) {
          setBranchDropdownOpen(false);
          setBranchSearchQuery("");
        }
      };
      document.addEventListener("mousedown", handler);
      return () => document.removeEventListener("mousedown", handler);
    }, [branchDropdownOpen]);

    useEffect(() => {
      if (branchDropdownOpen && branchSearchInputRef.current) {
        branchSearchInputRef.current.focus();
      }
    }, [branchDropdownOpen]);

    // Changed files & tree (same as ProjectGitSection)
    const changedFiles = gitInfo?.changed_files ?? [];
    const tree = useMemo(() => buildTree(changedFiles), [changedFiles]);
    const { totalAdditions, totalDeletions } = useMemo(() => {
      let additions = 0;
      let deletions = 0;
      for (const f of changedFiles) {
        additions += f.additions;
        deletions += f.deletions;
      }
      return { totalAdditions: additions, totalDeletions: deletions };
    }, [changedFiles]);

    // Branches & worktrees
    const branches = gitInfo?.branches ?? [];
    const worktrees = gitInfo?.worktrees ?? [];
    const localExpanded = expandedSections.__local__ !== false;
    const localChangesExpanded = expandedSections.__local_changes__ !== false;

    // Filter branches to exclude worktree branches (for the dropdown)
    const filteredBranches = useMemo(() => {
      const worktreeBranchSet = new Set(worktrees.map((wt) => wt.branch));
      return branches.filter((b) => !worktreeBranchSet.has(b));
    }, [worktrees, branches]);

    const dropdownBranches = useMemo(() => {
      const q = branchSearchQuery.toLowerCase().trim();
      if (!q) return filteredBranches;
      return filteredBranches.filter((b) => b.toLowerCase().includes(q));
    }, [filteredBranches, branchSearchQuery]);

    const handleCheckoutFromDropdown = async (branchName: string) => {
      if (branchName === currentBranch) return;
      setBranchDropdownOpen(false);
      setBranchSearchQuery("");
      try {
        await onCheckoutBranch(branchName);
      } catch (e: unknown) {
        onShowToast?.(String(e), "error");
      }
    };

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
        {/* "local" row — TerminalIcon + label + branch badge dropdown */}
        <div
          className={cn(
            "group flex items-center gap-1 py-1 px-2 ml-2 mr-1 rounded-md transition-colors duration-100 cursor-pointer",
            isActive ? "bg-bg-tertiary/60 text-text-primary" : "text-text-secondary hover:bg-bg-hover hover:text-text-primary"
          )}
          onClick={() => onSelectProject()}
          title="Open primary terminal"
        >
          <button
            className="bg-transparent border-none cursor-pointer p-0 m-0 w-3 h-3 flex items-center justify-center text-text-muted hover:text-text-primary"
            onClick={(e) => onToggleSection("__local__", e)}
            title="Toggle local details"
          >
            <ChevronRightIcon
              size={9}
              className={cn("transition-transform duration-150", localExpanded && "rotate-90")}
            />
          </button>
          <TerminalIcon size={13} className="opacity-70 shrink-0" />
          <span className="flex-1 text-[var(--font-size)] font-semibold truncate min-w-0">
            local
          </span>
          {/* Interactive branch badge dropdown -- only when gitInfo is loaded */}
          {gitInfo && (
            <div className="relative min-w-0" ref={branchDropdownRef} onClick={(e) => e.stopPropagation()}>
              <span
                className={cn(
                  "gh-branch-inline flex items-center gap-1 text-xs text-accent-blue font-mono bg-accent-blue/10 border border-accent-blue/20 rounded-full px-1.5 truncate cursor-pointer transition-colors duration-150 hover:bg-accent-blue/20 hover:border-accent-blue/40",
                  branchDropdownOpen && "bg-accent-blue/20 border-accent-blue/40"
                )}
                title={currentBranch}
                onClick={() => setBranchDropdownOpen((v) => !v)}
              >
                <BranchIcon size={11} />
                {currentBranch}
              </span>
              {branchDropdownOpen && (
                <div
                  className="absolute top-[calc(100%+4px)] right-0 bg-bg-secondary border border-border rounded-lg min-w-[220px] max-w-[320px] z-[1000] shadow-xl overflow-hidden flex flex-col"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center gap-1.5 p-2 px-2.5 border-b border-border">
                    <SearchIcon size={12} className="text-text-muted shrink-0" />
                    <input
                      ref={branchSearchInputRef}
                      className="gh-branch-dropdown-search-input flex-1 bg-transparent border-none outline-none text-text-primary text-xs font-inherit"
                      placeholder="Search branches..."
                      value={branchSearchQuery}
                      onChange={(e) => setBranchSearchQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          setBranchDropdownOpen(false);
                          setBranchSearchQuery("");
                        }
                      }}
                    />
                  </div>
                  <div className="max-h-[240px] overflow-y-auto py-1">
                    {dropdownBranches.map((branch) => {
                      const isCurrent = branch === currentBranch;
                      return (
                        <div
                          key={branch}
                          className={cn(
                            "flex items-center gap-1.5 py-1 px-3 text-xs font-mono text-text-secondary cursor-pointer transition-colors duration-100 hover:bg-bg-hover hover:text-text-primary",
                            isCurrent && "!text-accent-blue cursor-default"
                          )}
                          onClick={() => handleCheckoutFromDropdown(branch)}
                          title={isCurrent ? "Current branch" : "Click to checkout"}
                        >
                          <BranchIcon size={11} />
                          <span className="flex-1 truncate">{branch}</span>
                          {isCurrent && (
                            <span className="w-1.5 h-1.5 rounded-full bg-[#3fb950] shrink-0" title="current" />
                          )}
                        </div>
                      );
                    })}
                    {dropdownBranches.length === 0 && (
                      <div className="p-3 text-center text-xs text-text-muted">No branches found</div>
                    )}
                  </div>
                  <div className="border-t border-border py-1">
                    <div
                      className="flex items-center gap-1.5 py-1 px-3 text-xs text-text-secondary cursor-pointer transition-colors duration-100 hover:bg-bg-hover hover:text-text-primary"
                      onClick={(e) => {
                        e.stopPropagation();
                        setBranchDropdownOpen(false);
                        setBranchSearchQuery("");
                        onOpenDialog?.("new-branch", branches);
                      }}
                    >
                      <PlusIcon size={11} />
                      New Branch
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* "Changes (N) +X -Y" collapsible section */}
        {localExpanded && (
          <>
            {tree.length > 0 && (
              <>
                <div
                  className="text-[0.72em] font-semibold uppercase tracking-[0.06em] text-text-muted py-0.5 px-2 ml-8 mr-1 select-none flex items-center gap-1 cursor-pointer rounded transition-colors duration-100 hover:bg-bg-hover hover:text-text-secondary"
                  onClick={(e) => onToggleSection("__local_changes__", e)}
                >
                  <ChevronRightIcon
                    size={9}
                    className={cn("text-[0.6em] text-text-muted w-2.5 shrink-0 transition-transform duration-150", localChangesExpanded && "rotate-90")}
                  />
                  Changes ({changedFiles.length})
                  {(totalAdditions > 0 || totalDeletions > 0) && (
                    <span className="inline-flex items-center gap-1 ml-auto font-semibold text-[1.1em]">
                      {totalAdditions > 0 && (
                        <span className="text-[#3fb950] font-semibold">+{totalAdditions}</span>
                      )}
                      {totalDeletions > 0 && (
                        <span className="text-[#f85149] font-semibold">-{totalDeletions}</span>
                      )}
                    </span>
                  )}
                </div>
                {localChangesExpanded && (
                  <div className="ml-10">
                    <FileTree
                      nodes={tree}
                      projectId={projectId}
                      onSelectFile={(_, fp) => onSelectFile(fp)}
                    />
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* Worktrees section */}
        {worktrees.length > 0 && (
          <div className="ml-6">
            <div className="pl-0.5">
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
                        "group flex items-center gap-1 py-1 px-2 text-[var(--font-size)] rounded-md text-text-secondary transition-colors duration-100 cursor-pointer hover:bg-bg-hover",
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
                      <span
                        className="flex items-center gap-1 text-xs text-accent-blue font-mono bg-accent-blue/10 border border-accent-blue/20 rounded-full px-1.5 shrink-0 max-w-[90px] truncate cursor-pointer transition-colors duration-150 hover:bg-accent-blue/20 hover:border-accent-blue/40"
                        title={wt.branch}
                      >
                        <BranchIcon size={11} /> {wt.branch}
                      </span>
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
              <div className="modal-actions">
                <button className="cancel-btn" onClick={() => setConfirmDelete(null)}>Cancel</button>
                <button className="confirm-btn confirm-btn-danger" onClick={performRemove}>
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
