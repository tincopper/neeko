import React, { useState, useEffect, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Project } from "../../types";
import { DialogType, DialogState } from "./GitDialog";
import FileTree, { buildTree } from "./FileTree";
import { getIdeIconByCommand } from "../../utils/idePresets";
import { BranchIcon, ChevronRightIcon, FileIcon, SideTerminalIcon, GitLogoIcon, TrashIcon } from "../icons";

const AVATAR_COLORS = [
  "#61afef", "#98c379", "#e5c07b", "#e06c75", "#c678dd",
  "#56b6c2", "#d19a66", "#67a8e4", "#abb2bf", "#be5046",
];

function getAvatarStyle(name: string): React.CSSProperties {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const color = AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
  return { color, backgroundColor: color + "26" };
}

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
  ideCommandOverrides?: Record<string, string>;
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
  ideCommandOverrides,
}) => {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const [projectCollapsed, setProjectCollapsed] = useState(project.collapsed ?? true);
  const [gitMenuOpen, setGitMenuOpen] = useState(false);

  // Inline rename state
  const [renamingBranch, setRenamingBranch] = useState<string | null>(null);
  const [renameBranchValue, setRenameBranchValue] = useState("");
  const [renamingWorktree, setRenamingWorktree] = useState<string | null>(null); // stores wt.path
  const [renameWorktreeValue, setRenameWorktreeValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  // 切换折叠状态并持久化
  const toggleCollapsed = async () => {
    const newCollapsed = !projectCollapsed;
    setProjectCollapsed(newCollapsed);
    try {
      await invoke("set_project_collapsed", { projectId: project.id, collapsed: newCollapsed });
    } catch (e) {
      console.error("Failed to save collapsed state:", e);
    }
  };

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
  const tree = useMemo(() => buildTree(changedFiles), [changedFiles]);
   const branches = project.git_info?.branches ?? [];
   const worktrees = project.git_info?.worktrees ?? [];

   // 被 worktree 占用的 branch 不在 Branches 列表中展示
   const filteredBranches = useMemo(() => {
     const worktreeBranchSet = new Set(worktrees.map((wt) => wt.branch));
     return branches.filter((b) => !worktreeBranchSet.has(b));
   }, [worktrees, branches]);

   // Filter out worktrees that are on the current branch (to avoid duplication)
   const filteredWorktrees = useMemo(() => {
     const currentBranch = project.git_info?.current_branch ?? "";
     return worktrees.filter((wt) => wt.branch !== currentBranch);
   }, [worktrees, project.git_info?.current_branch]);

  const branchesExpanded = expandedSections["__branches__"] ?? true;
  const worktreesExpanded = expandedSections["__worktrees__"] ?? true;

  return (
    <div className={`gh-project ${isActive ? "active" : ""}`}>
      <div className="gh-project-header" onClick={() => onSelectProject(project.id)}>
        <span
          className="gh-project-avatar"
          style={{ ...getAvatarStyle(project.name), cursor: "pointer" }}
          onClick={(e) => { e.stopPropagation(); toggleCollapsed(); }}
        >
          {project.name.charAt(0).toUpperCase()}
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
            <img src={getIdeIconByCommand(project.selected_ide, ideCommandOverrides)} className="gh-ide-icon" alt="" />
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
              <SideTerminalIcon size={12} />
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
                <GitLogoIcon size={12} />
              </button>
              {gitMenuOpen && (
                <div className="gh-git-dropdown">
                  <div className="gh-git-dropdown-item" onClick={(e) => { setGitMenuOpen(false); openDialog("new-branch", e); }}>
                    <GitLogoIcon size={12} />
                    New Branch
                  </div>
                  <div className="gh-git-dropdown-item" onClick={(e) => { setGitMenuOpen(false); openDialog("new-worktree", e); }}>
                    <GitLogoIcon size={12} />
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
            <TrashIcon size={12} />
          </button>
        </div>
        {project.git_info && (
          <span className="gh-branch-inline" title={project.git_info.current_branch}>
            <BranchIcon size={11} />
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
                <ChevronRightIcon size={9} className={`gh-section-chevron ${branchesExpanded ? "expanded" : ""}`} />
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
                        <BranchIcon size={11} />
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
                    <ChevronRightIcon size={9} className={`gh-section-chevron ${worktreesExpanded ? "expanded" : ""}`} />
                    Worktrees
                  </div>
               {worktreesExpanded && (
                   <div className="gh-worktree-list">
                     {filteredWorktrees.map((wt) => (
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
                        <FileIcon size={11} style={{ opacity: 0.7 }} />
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
                        <span className="gh-branch-inline" title={wt.branch}>
                          <BranchIcon size={11} />
                          {wt.branch}
                        </span>
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

export default React.memo(ProjectItem);
