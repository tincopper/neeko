import React, { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Project } from "../../types";
import { DialogType, DialogState } from "./GitDialog";
import FileTree, { buildTree } from "./FileTree";

interface ProjectItemProps {
  project: Project;
  isActive: boolean;
  onSelectProject: (projectId: string) => void;
  onRemoveProject: (projectId: string) => void;
  onSelectFile: (projectId: string, filePath: string) => void;
  onRefreshGit: (projectId: string) => void;
  onBackToMainTerminal: (projectId: string) => void;
  onOpenDialog: (dialog: DialogState) => void;
  onOpenIde?: (projectId: string) => void;
  onOpenSideTerminal?: (projectId: string) => void;
  onOpenWorktreeTerminal?: (worktreePath: string, branch: string) => void;
}

const ProjectItem: React.FC<ProjectItemProps> = ({
  project,
  isActive,
  onSelectProject,
  onRemoveProject,
  onSelectFile,
  onRefreshGit,
  onBackToMainTerminal,
  onOpenDialog,
  onOpenIde,
  onOpenSideTerminal,
  onOpenWorktreeTerminal,
}) => {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const [projectCollapsed, setProjectCollapsed] = useState(true);
  const [gitMenuOpen, setGitMenuOpen] = useState(false);

  // Inline rename state
  const [renamingBranch, setRenamingBranch] = useState<string | null>(null);
  const [renameBranchValue, setRenameBranchValue] = useState("");
  const [renamingWorktree, setRenamingWorktree] = useState<string | null>(null); // stores wt.path
  const [renameWorktreeValue, setRenameWorktreeValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!gitMenuOpen) return;
    const close = () => setGitMenuOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [gitMenuOpen]);

  // Auto-focus the rename input when it appears
  useEffect(() => {
    if ((renamingBranch !== null || renamingWorktree !== null) && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingBranch, renamingWorktree]);

  const toggleSection = (key: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleCheckout = async (branchName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await invoke("checkout_branch", { projectId: project.id, branchName });
      onBackToMainTerminal(project.id);
      onRefreshGit(project.id);
    } catch (e: any) {
      alert(String(e));
    }
  };

  const handleRemoveWorktree = async (worktreePath: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await invoke("remove_worktree", { projectId: project.id, worktreePath });
      onRefreshGit(project.id);
    } catch (e: any) {
      alert(String(e));
    }
  };

  // Branch rename handlers
  const startRenameBranch = (branch: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setRenamingBranch(branch);
    setRenameBranchValue(branch);
  };

  const commitRenameBranch = async () => {
    const oldName = renamingBranch!;
    const newName = renameBranchValue.trim();
    setRenamingBranch(null);
    if (!newName || newName === oldName) return;
    try {
      await invoke("rename_branch", { projectId: project.id, oldName, newName });
      onRefreshGit(project.id);
    } catch (e: any) {
      alert(String(e));
    }
  };

  const cancelRenameBranch = () => {
    setRenamingBranch(null);
    setRenameBranchValue("");
  };

  // Worktree rename handlers
  const startRenameWorktree = (worktreePath: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const dirName = worktreePath.split(/[\\/]/).pop() ?? worktreePath;
    setRenamingWorktree(worktreePath);
    setRenameWorktreeValue(dirName);
  };

  const commitRenameWorktree = async () => {
    const oldPath = renamingWorktree!;
    const newName = renameWorktreeValue.trim();
    setRenamingWorktree(null);
    if (!newName) return;
    const oldDirName = oldPath.split(/[\\/]/).pop() ?? "";
    if (newName === oldDirName) return;
    try {
      await invoke("rename_worktree", { projectId: project.id, worktreePath: oldPath, newName });
      onRefreshGit(project.id);
    } catch (e: any) {
      alert(String(e));
    }
  };

  const cancelRenameWorktree = () => {
    setRenamingWorktree(null);
    setRenameWorktreeValue("");
  };

  const openDialog = (type: DialogType, e: React.MouseEvent) => {
    e.stopPropagation();
    onOpenDialog({
      type,
      projectId: project.id,
      branches: project.git_info?.branches ?? [],
    });
  };

  const changedFiles = project.git_info?.changed_files ?? [];
  const tree = buildTree(changedFiles);
  const branches = project.git_info?.branches ?? [];
  const worktrees = project.git_info?.worktrees ?? [];

  // 被 worktree 占用的 branch 不在 Branches 列表中展示
  const worktreeBranchSet = new Set(worktrees.map((wt) => wt.branch));
  const filteredBranches = branches.filter((b) => !worktreeBranchSet.has(b));

  const branchesExpanded = expandedSections["__branches__"] ?? true;
  const worktreesExpanded = expandedSections["__worktrees__"] ?? true;

  return (
    <div className={`gh-project ${isActive ? "active" : ""}`}>
      <div className="gh-project-header" onClick={() => onSelectProject(project.id)}>
        {/* 折叠/展开箭头 */}
        <span
          className={`gh-project-chevron ${projectCollapsed ? "collapsed" : ""}`}
          onClick={(e) => { e.stopPropagation(); setProjectCollapsed(v => !v); }}
          title={projectCollapsed ? "Expand" : "Collapse"}
        >
          <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
            <path d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z"/>
          </svg>
        </span>
        <span className="gh-repo-icon">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8Z"/>
          </svg>
        </span>
        <div className="gh-project-meta">
          <span className="gh-project-name">{project.name}</span>
        </div>
        {/* IDE 按钮 */}
        {project.selected_ide && onOpenIde && (
          <button
            className="gh-icon-btn gh-ide-btn"
            title={`Open in IDE (Ctrl+O)\n${project.selected_ide}`}
            onClick={(e) => { e.stopPropagation(); onOpenIde(project.id); }}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
              <path d="M10.604 1h4.146a.25.25 0 0 1 .25.25v4.146a.25.25 0 0 1-.427.177L13.03 4.03 9.28 7.78a.75.75 0 0 1-1.06-1.06l3.75-3.75-1.543-1.543A.25.25 0 0 1 10.604 1ZM3.75 2A1.75 1.75 0 0 0 2 3.75v8.5C2 13.216 2.784 14 3.75 14h8.5A1.75 1.75 0 0 0 14 12.25v-3.5a.75.75 0 0 0-1.5 0v3.5a.25.25 0 0 1-.25.25h-8.5a.25.25 0 0 1-.25-.25v-8.5a.25.25 0 0 1 .25-.25h3.5a.75.75 0 0 0 0-1.5h-3.5Z"/>
            </svg>
          </button>
        )}
        <div className="gh-project-actions">
          {/* Side Terminal 按钮 */}
          {onOpenSideTerminal && isActive && project.active_view === "Terminal" && (
            <button
              className="gh-icon-btn"
              onClick={(e) => { e.stopPropagation(); onOpenSideTerminal(project.id); }}
              title="Open side terminal (Ctrl+Alt+T)"
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                <path d="M0 2.75C0 1.784.784 1 1.75 1h12.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0 1 14.25 15H1.75A1.75 1.75 0 0 1 0 13.25Zm1.75-.25a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25V2.75a.25.25 0 0 0-.25-.25ZM7.25 8a.75.75 0 0 1-.22.53l-2.25 2.25a.75.75 0 1 1-1.06-1.06L5.44 8 3.72 6.28a.75.75 0 1 1 1.06-1.06l2.25 2.25c.141.14.22.331.22.53Zm1.5 1.5h3a.75.75 0 0 1 0 1.5h-3a.75.75 0 0 1 0-1.5Z"/>
              </svg>
            </button>
          )}
          {/* Git 操作下拉菜单 */}
          {project.git_info && (
            <div className="gh-git-menu" onClick={(e) => e.stopPropagation()}>
              <button
                className="gh-icon-btn gh-git-menu-btn"
                onClick={(e) => { e.stopPropagation(); setGitMenuOpen(v => !v); }}
                title="Git actions"
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Zm-6 0a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Zm8.25-.75a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z"/>
                </svg>
              </button>
              {gitMenuOpen && (
                <div className="gh-git-dropdown">
                  <div className="gh-git-dropdown-item" onClick={(e) => { setGitMenuOpen(false); openDialog("new-branch", e); }}>
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Zm-6 0a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Zm8.25-.75a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z"/>
                    </svg>
                    New Branch
                  </div>
                  <div className="gh-git-dropdown-item" onClick={(e) => { setGitMenuOpen(false); openDialog("new-worktree", e); }}>
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M1 2.5A2.5 2.5 0 0 1 3.5 0h8.75a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0V1.5H3.5a1 1 0 0 0-1 1V7c0 .55.45 1 1 1h2a.75.75 0 0 1 0 1.5h-2A2.5 2.5 0 0 1 1 7V2.5ZM8 8.5a.75.75 0 0 1 .75-.75h5.5a.75.75 0 0 1 0 1.5h-5.5A.75.75 0 0 1 8 8.5Zm0 3a.75.75 0 0 1 .75-.75h5.5a.75.75 0 0 1 0 1.5h-5.5A.75.75 0 0 1 8 11.5Zm-4 3a.75.75 0 0 1 .75-.75h9.5a.75.75 0 0 1 0 1.5h-9.5A.75.75 0 0 1 4 14.5Z"/>
                    </svg>
                    New Worktree
                  </div>
                </div>
              )}
            </div>
          )}
          <button
            className="gh-icon-btn gh-icon-btn-danger"
            onClick={(e) => { e.stopPropagation(); onRemoveProject(project.id); }}
            title="Remove"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
              <path d="M11 1.75V3h2.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75ZM4.496 6.675l.66 6.6a.25.25 0 0 0 .249.225h5.19a.25.25 0 0 0 .249-.225l.66-6.6a.75.75 0 0 1 1.492.149l-.66 6.6A1.748 1.748 0 0 1 10.595 15h-5.19a1.75 1.75 0 0 1-1.741-1.575l-.66-6.6a.75.75 0 1 1 1.492-.15ZM6.5 1.75V3h3V1.75a.25.25 0 0 0-.25-.25h-2.5a.25.25 0 0 0-.25.25Z"/>
            </svg>
          </button>
        </div>
        {project.git_info && (
          <span className="gh-branch-inline">
            <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
              <path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Zm-6 0a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Zm8.25-.75a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z"/>
            </svg>
            {project.git_info.current_branch}
          </span>
        )}
      </div>

      {!projectCollapsed && (
        <div className="gh-project-body">
          {project.git_info && (
            <>
              {/* ── Branches ── */}
              <div
                className="gh-section-label gh-section-label-collapsible"
                onClick={(e) => toggleSection("__branches__", e)}
              >
                <svg
                  className={`gh-section-chevron ${branchesExpanded ? "expanded" : ""}`}
                  width="9" height="9" viewBox="0 0 16 16" fill="currentColor"
                >
                  <path d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z"/>
                </svg>
                Branches
              </div>
              {branchesExpanded && (
              <div className="gh-branch-list">
                {filteredBranches.map((branch) => {
                  const isCurrent = branch === project.git_info!.current_branch;
                  const branchNodeKey = `br-${branch}`;
                  const isNodeExpanded = isCurrent
                    ? (expandedSections[branchNodeKey] ?? true)
                    : (expandedSections[branchNodeKey] ?? false);

                  return (
                    <React.Fragment key={branch}>
                      <div className={`gh-branch-item ${isCurrent ? "current" : ""}`}>
                        <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" style={{ flexShrink: 0 }}>
                          <path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Zm-6 0a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Zm8.25-.75a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z"/>
                        </svg>
                        {renamingBranch === branch ? (
                          <input
                            ref={renameInputRef}
                            className="gh-inline-rename-input"
                            value={renameBranchValue}
                            onChange={(e) => setRenameBranchValue(e.target.value)}
                            onBlur={commitRenameBranch}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") { e.preventDefault(); commitRenameBranch(); }
                              if (e.key === "Escape") { e.preventDefault(); cancelRenameBranch(); }
                            }}
                            onClick={(e) => e.stopPropagation()}
                          />
                        ) : (
                          <span
                            className="gh-branch-item-name"
                            onClick={(e) => {
                              if (isCurrent) toggleSection(branchNodeKey, e);
                              else handleCheckout(branch, e);
                            }}
                            onDoubleClick={(e) => startRenameBranch(branch, e)}
                            title="Double-click to rename"
                          >{branch}</span>
                        )}
                        {isCurrent && <span className="gh-current-dot" title="current" />}
                      </div>

                      {isNodeExpanded && (
                        <div className="gh-branch-children">
                          {isCurrent && tree.length > 0 && (
                            <div className="gh-file-tree">
                              <FileTree nodes={tree} projectId={project.id} onSelectFile={onSelectFile} />
                            </div>
                          )}
                        </div>
                      )}
                    </React.Fragment>
                  );
                })}
              </div>
              )}

              {/* ── Worktrees ── */}
              {worktrees.length > 0 && (
                <>
                  <div
                    className="gh-section-label gh-section-label-collapsible"
                    onClick={(e) => toggleSection("__worktrees__", e)}
                  >
                    <svg
                      className={`gh-section-chevron ${worktreesExpanded ? "expanded" : ""}`}
                      width="9" height="9" viewBox="0 0 16 16" fill="currentColor"
                    >
                      <path d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z"/>
                    </svg>
                    Worktrees
                  </div>
                  {worktreesExpanded && (
                  <div className="gh-worktree-list">
                    {worktrees.map((wt) => (
                      <div
                        key={wt.path}
                        className="gh-worktree-item gh-worktree-item-standalone"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (renamingWorktree === wt.path) return;
                          onOpenWorktreeTerminal?.(wt.path, wt.branch);
                        }}
                        title={`${wt.path}\nClick to open terminal`}
                      >
                        <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" style={{ flexShrink: 0, opacity: 0.7 }}>
                          <path d="M0 2.75C0 1.784.784 1 1.75 1h12.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0 1 14.25 15H1.75A1.75 1.75 0 0 1 0 13.25Zm1.75-.25a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25V2.75a.25.25 0 0 0-.25-.25ZM7.25 8a.75.75 0 0 1-.22.53l-2.25 2.25a.75.75 0 1 1-1.06-1.06L5.44 8 3.72 6.28a.75.75 0 1 1 1.06-1.06l2.25 2.25c.141.14.22.331.22.53Zm1.5 1.5h3a.75.75 0 0 1 0 1.5h-3a.75.75 0 0 1 0-1.5Z"/>
                        </svg>
                        {renamingWorktree === wt.path ? (
                          <input
                            ref={renameInputRef}
                            className="gh-inline-rename-input"
                            value={renameWorktreeValue}
                            onChange={(e) => setRenameWorktreeValue(e.target.value)}
                            onBlur={commitRenameWorktree}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") { e.preventDefault(); commitRenameWorktree(); }
                              if (e.key === "Escape") { e.preventDefault(); cancelRenameWorktree(); }
                            }}
                            onClick={(e) => e.stopPropagation()}
                          />
                        ) : (
                          <span
                            className="gh-worktree-name"
                            onDoubleClick={(e) => { e.stopPropagation(); startRenameWorktree(wt.path, e); }}
                            title="Double-click to rename"
                          >
                            {wt.path.split(/[\\/]/).pop()}
                          </span>
                        )}
                        <span className="gh-worktree-branch-tag" title={wt.branch}>{wt.branch}</span>
                        <button
                          className="gh-icon-btn gh-icon-btn-danger gh-worktree-remove"
                          onClick={(e) => { e.stopPropagation(); handleRemoveWorktree(wt.path, e); }}
                          title="Remove worktree"
                        >×</button>
                      </div>
                    ))}
                  </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default ProjectItem;
