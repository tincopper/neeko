import React, { useState, useEffect, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Project, AgentConfig, AppConfig } from "../../types";
import { DialogType, DialogState } from "./GitDialog";
import FileTree, { buildTree } from "./FileTree";
import ContextMenu, { ContextMenuItem } from "./ContextMenu";
import ProjectSettingsDialog from "./ProjectSettingsDialog";
import { getIdeIconByCommand } from "../../utils/idePresets";
import { BranchIcon, ChevronRightIcon, SideTerminalIcon, GitLogoIcon, TrashIcon, SearchIcon, PlusIcon, FolderGitIcon } from "../icons";

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
  onOpenSettings?: () => void;
  onRefresh?: (projectId: string) => void;
  agents?: AgentConfig[];
  config?: AppConfig;
  onSaveProjectSettings?: (projectId: string, agentId: string | null, ideCommand: string | null) => void;
  onDragEnd?: (draggedId: string, targetId: string) => void;
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
  onOpenSettings,
  onRefresh,
  agents,
  config,
  onSaveProjectSettings,
  onDragEnd,
}) => {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const [projectCollapsed, setProjectCollapsed] = useState(project.collapsed ?? true);
  const [gitMenuOpen, setGitMenuOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  // Branch dropdown state
  const [branchDropdownOpen, setBranchDropdownOpen] = useState(false);
  const [branchSearchQuery, setBranchSearchQuery] = useState("");
  const branchDropdownRef = useRef<HTMLDivElement>(null);
  const branchSearchInputRef = useRef<HTMLInputElement>(null);

  // Inline rename state (worktree only)
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

  // Close branch dropdown on outside click
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

  // Auto-focus search input when branch dropdown opens
  useEffect(() => {
    if (branchDropdownOpen && branchSearchInputRef.current) {
      branchSearchInputRef.current.focus();
    }
  }, [branchDropdownOpen]);

  // Auto-focus the rename input when it appears
  useEffect(() => {
    if (renamingWorktree !== null && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingWorktree]);

  const toggleSection = (key: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };


  const handleRemoveWorktree = async (worktreePath: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await invoke("remove_worktree", { projectId: project.id, worktreePath });
      onRefreshGit(project.id);
    } catch (e: unknown) {
      alert(String(e));
    }
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
    } catch (e: unknown) {
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

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  const buildContextMenuItems = (): ContextMenuItem[] => {
    const items: ContextMenuItem[] = [];

    if (project.selected_ide && onOpenIde) {
      items.push({
        label: "Open in IDE",
        shortcut: "Ctrl+O",
        action: () => onOpenIde(project.id),
      });
    }

    if (isActive && project.active_view === "Terminal" && onOpenSideTerminal) {
      items.push({
        label: "Open Side Terminal",
        shortcut: "Ctrl+Alt+T",
        action: () => onOpenSideTerminal(project.id),
      });
    }

    if (project.git_info) {
      items.push({
        label: "New Branch",
        icon: GitLogoIcon,
        action: () => {
          setGitMenuOpen(false);
          onOpenDialog({
            type: "new-branch",
            projectId: project.id,
            branches: project.git_info!.branches,
          });
        },
      });
      items.push({
        label: "New Worktree",
        icon: FolderGitIcon,
        action: () => {
          setGitMenuOpen(false);
          onOpenDialog({
            type: "new-worktree",
            projectId: project.id,
            branches: project.git_info!.branches,
          });
        },
      });
    }

    if (onRefresh) {
      items.push({
        label: "Refresh Terminal",
        shortcut: "Ctrl+R",
        action: () => onRefresh(project.id),
      });
    }

    items.push({ label: "", separator: true, action: () => {} });

    if (onOpenSettings && config) {
      items.push({
        label: "Project Settings",
        action: () => setSettingsOpen(true),
      });
    }

    items.push({
      label: "Remove Project",
      action: () => onRemoveProject(project.id),
      danger: true,
    });

    return items;
  };

  // Drag handlers
  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData("text/plain", project.id);
    e.dataTransfer.effectAllowed = "move";
    // Add a slight delay to allow the drag image to be captured
    (e.target as HTMLElement).classList.add("dragging");
  };

  const handleDragEnd = (e: React.DragEvent) => {
    (e.target as HTMLElement).classList.remove("dragging");
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const draggedId = e.dataTransfer.getData("text/plain");
    if (draggedId && draggedId !== project.id && onDragEnd) {
      onDragEnd(draggedId, project.id);
    }
  };

  const changedFiles = project.git_info?.changed_files ?? [];
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

   // Branch dropdown: filter by search query
   const dropdownBranches = useMemo(() => {
     const q = branchSearchQuery.toLowerCase().trim();
     if (!q) return filteredBranches;
     return filteredBranches.filter((b) => b.toLowerCase().includes(q));
   }, [filteredBranches, branchSearchQuery]);

   const handleCheckoutFromDropdown = async (branchName: string) => {
     if (branchName === project.git_info?.current_branch) return;
     setBranchDropdownOpen(false);
     setBranchSearchQuery("");
     try {
       await invoke("checkout_branch", { projectId: project.id, branchName });
       onBackToMainTerminal(project.id);
       onRefreshGit(project.id);
     } catch (e: unknown) {
       alert(String(e));
     }
   };

  const worktreesExpanded = expandedSections["__worktrees__"] ?? true;

  return (
    <div
      className={`gh-project ${isActive ? "active" : ""} ${isDragOver ? "drag-over" : ""}`}
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="gh-project-header" onClick={() => onSelectProject(project.id)} onContextMenu={handleContextMenu}>
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
                    <FolderGitIcon size={12} />
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
          <div className="gh-branch-dropdown-wrap" ref={branchDropdownRef}>
            <span
              className={`gh-branch-inline ${branchDropdownOpen ? "active" : ""}`}
              title={project.git_info.current_branch}
              onClick={(e) => {
                e.stopPropagation();
                setBranchDropdownOpen((v) => !v);
              }}
            >
              <BranchIcon size={11} />
              {project.git_info.current_branch}
            </span>
            {branchDropdownOpen && (
              <div className="gh-branch-dropdown" onClick={(e) => e.stopPropagation()}>
                <div className="gh-branch-dropdown-search">
                  <SearchIcon size={12} className="gh-branch-dropdown-search-icon" />
                  <input
                    ref={branchSearchInputRef}
                    className="gh-branch-dropdown-search-input"
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
                <div className="gh-branch-dropdown-list">
                  {dropdownBranches.map((branch) => {
                    const isCurrent = branch === project.git_info!.current_branch;
                    return (
                      <div
                        key={branch}
                        className={`gh-branch-dropdown-item ${isCurrent ? "current" : ""}`}
                        onClick={() => handleCheckoutFromDropdown(branch)}
                        title={isCurrent ? "Current branch" : "Click to checkout"}
                      >
                        <BranchIcon size={11} />
                        <span className="gh-branch-dropdown-item-name">{branch}</span>
                        {isCurrent && <span className="gh-current-dot" title="current" />}
                      </div>
                    );
                  })}
                  {dropdownBranches.length === 0 && (
                    <div className="gh-branch-dropdown-empty">No branches found</div>
                  )}
                </div>
                <div className="gh-branch-dropdown-footer">
                  <div
                    className="gh-branch-dropdown-action"
                    onClick={(e) => {
                      e.stopPropagation();
                      setBranchDropdownOpen(false);
                      setBranchSearchQuery("");
                      openDialog("new-branch", e as unknown as React.MouseEvent);
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

      {!projectCollapsed && (
        <div className="gh-project-body">
          {project.git_info && (
            <>
              {/* ── Changed Files (current branch) ── */}
              {tree.length > 0 && (
                <>
                  <div
                    className="gh-section-label gh-section-label-collapsible"
                    onClick={(e) => toggleSection("__changes__", e)}
                  >
                    <ChevronRightIcon size={9} className={`gh-section-chevron ${expandedSections["__changes__"] !== false ? "expanded" : ""}`} />
                    Changes ({changedFiles.length})
                    {(totalAdditions > 0 || totalDeletions > 0) && (
                      <span className="gh-changes-stats">
                        {totalAdditions > 0 && <span className="gh-changes-additions">+{totalAdditions}</span>}
                        {totalDeletions > 0 && <span className="gh-changes-deletions">-{totalDeletions}</span>}
                      </span>
                    )}
                  </div>
                  {expandedSections["__changes__"] !== false && (
                    <div className="gh-file-tree">
                      <FileTree nodes={tree} projectId={project.id} onSelectFile={onSelectFile} />
                    </div>
                  )}
                </>
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
                        <FolderGitIcon size={15} style={{ opacity: 0.7 }} />
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
      {contextMenu && (
        <ContextMenu
          position={contextMenu}
          onClose={() => setContextMenu(null)}
          items={buildContextMenuItems()}
        />
      )}
      {settingsOpen && config && (
        <ProjectSettingsDialog
          projectId={project.id}
          projectName={project.name}
          currentAgent={project.selected_agent}
          currentIde={project.selected_ide}
          agents={agents ?? []}
          config={config}
          onClose={() => setSettingsOpen(false)}
          onSave={(agentId, ideCmd) => {
            onSaveProjectSettings?.(project.id, agentId, ideCmd);
            setSettingsOpen(false);
          }}
        />
      )}
    </div>
  );
};

export default React.memo(ProjectItem);
