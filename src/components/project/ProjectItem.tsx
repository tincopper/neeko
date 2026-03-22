import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Project, Worktree } from "../../types";
import { DialogType, DialogState } from "./GitDialog";
import FileTree, { buildTree } from "./FileTree";

interface ProjectItemProps {
  project: Project;
  isActive: boolean;
  onSelectProject: (projectId: string) => void;
  onRemoveProject: (projectId: string) => void;
  onSelectFile: (projectId: string, filePath: string) => void;
  onRefreshGit: (projectId: string) => void;
  onOpenDialog: (dialog: DialogState) => void;
  onOpenIde?: (projectId: string) => void;
  onOpenSideTerminal?: (projectId: string) => void;
}

const ProjectItem: React.FC<ProjectItemProps> = ({
  project,
  isActive,
  onSelectProject,
  onRemoveProject,
  onSelectFile,
  onRefreshGit,
  onOpenDialog,
  onOpenIde,
  onOpenSideTerminal,
}) => {
  const isExpanded = true;
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const [gitMenuOpen, setGitMenuOpen] = useState(false);

  useEffect(() => {
    if (!gitMenuOpen) return;
    const close = () => setGitMenuOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [gitMenuOpen]);

  const toggleSection = (key: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleCheckout = async (branchName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await invoke("checkout_branch", { projectId: project.id, branchName });
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

  const worktreesByBranch: Record<string, Worktree[]> = {};
  for (const wt of worktrees) {
    (worktreesByBranch[wt.branch] ??= []).push(wt);
  }

  return (
    <div className={`gh-project ${isActive ? "active" : ""}`}>
      <div className="gh-project-header" onClick={() => onSelectProject(project.id)}>
        <span className="gh-repo-icon">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8Z"/>
          </svg>
        </span>
        <div className="gh-project-meta">
          <span className="gh-project-name">{project.name}</span>
        </div>
        {/* IDE 按钮（始终可见） */}
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

      {isExpanded && (
        <div className="gh-project-body">
          {project.git_info && (
            <>
              {/* 分支列表 */}
              <div className="gh-branch-list">
                {branches.map((branch) => {
                  const isCurrent = branch === project.git_info!.current_branch;
                  const branchWts = worktreesByBranch[branch] ?? [];
                  const hasWt = branchWts.length > 0;
                  const branchNodeKey = `br-${branch}`;
                  const branchNodeExpanded = expandedSections[branchNodeKey] ?? false;
                  // 当前分支默认展开
                  const isNodeExpanded = isCurrent
                    ? (expandedSections[branchNodeKey] ?? true)
                    : branchNodeExpanded;

                  return (
                    <React.Fragment key={branch}>
                      <div className={`gh-branch-item ${isCurrent ? "current" : ""}`}>
                        <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
                          <path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Zm-6 0a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Zm8.25-.75a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z"/>
                        </svg>
                        <span
                          className="gh-branch-item-name"
                          onClick={(e) => {
                            if (isCurrent) toggleSection(branchNodeKey, e);
                            else handleCheckout(branch, e);
                          }}
                          title={isCurrent ? "Click to collapse/expand" : `Checkout ${branch}`}
                        >{branch}</span>
                        {isCurrent && <span className="gh-current-dot" title="current" />}
                        {hasWt && <span className="gh-wt-count">{branchWts.length}</span>}
                      </div>

                      {isNodeExpanded && (
                        <div className="gh-branch-children">
                          {/* worktrees */}
                          {hasWt && (
                            <div className="gh-branch-worktrees">
                              {branchWts.map((wt) => (
                                <div key={wt.path} className="gh-worktree-item">
                                  <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" className="gh-wt-icon">
                                    <path d="M1 2.5A2.5 2.5 0 0 1 3.5 0h8.75a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0V1.5H3.5a1 1 0 0 0-1 1V7c0 .55.45 1 1 1h2a.75.75 0 0 1 0 1.5h-2A2.5 2.5 0 0 1 1 7V2.5Z"/>
                                  </svg>
                                  <span className="gh-worktree-path" title={wt.path}>
                                    {wt.path.split(/[\\/]/).pop()}
                                  </span>
                                  <button
                                    className="gh-icon-btn gh-icon-btn-danger gh-worktree-remove"
                                    onClick={(e) => handleRemoveWorktree(wt.path, e)}
                                    title="Remove worktree"
                                  >×</button>
                                </div>
                              ))}
                            </div>
                          )}
                          {/* 当前分支下显示变更文件树 */}
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
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default ProjectItem;
