import React, { useState, useEffect, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { GitBranch } from "lucide-react";
import { Project, AgentConfig, AppConfig } from "../../types";
import { DialogType, DialogState } from "./GitDialog";
import FileTree, { buildTree } from "./FileTree";
import WorktreeList from "./WorktreeList";
import ContextMenu, { ContextMenuItem } from "./ContextMenu";
import ProjectSettingsDialog from "./ProjectSettingsDialog";
import { getIdeIconByCommand } from "../../utils/idePresets";
import { BranchIcon, ChevronRightIcon, GitLogoIcon, TrashIcon, SearchIcon, PlusIcon, FolderGitIcon, TerminalIcon } from "../icons";

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
  onOpenWorktreeTerminal?: (projectId: string, worktreePath: string, branch: string) => void;
  onSelectWorktreeFile?: (worktreePath: string, filePath: string) => void;
  ideCommandOverrides?: Record<string, string>;
  onOpenSettings?: () => void;
  onRefresh?: (projectId: string) => void;
  agents?: AgentConfig[];
  config?: AppConfig;
  onSaveProjectSettings?: (projectId: string, agentId: string | null, ideCommand: string | null) => void;
  onDragEnd?: (draggedId: string, targetId: string) => void;
  onShowToast?: (message: string, type?: "info" | "error") => void;
  gitViewState?: "hidden" | "open" | "minimized";
  onToggleGitView?: () => void;
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
  onOpenWorktreeTerminal,
  onSelectWorktreeFile,
  ideCommandOverrides,
  onOpenSettings,
  onRefresh,
  agents,
  config,
  onSaveProjectSettings,
  onDragEnd,
  onShowToast,
  gitViewState,
  onToggleGitView,
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

  const toggleSection = (key: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));
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
    const gitInfo = project.git_info;

    if (project.selected_ide && onOpenIde) {
      items.push({
        label: "Open in IDE",
        shortcut: "Ctrl+O",
        action: () => onOpenIde(project.id),
      });
    }

    if (gitInfo) {
      items.push({
        label: "New Branch",
        icon: GitLogoIcon,
        action: () => {
          setGitMenuOpen(false);
          onOpenDialog({
            type: "new-branch",
            projectId: project.id,
            branches: gitInfo.branches,
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
            branches: gitInfo.branches,
            projectPath: project.path,
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
   const currentBranch = project.git_info?.current_branch ?? "";
   const localExpanded = expandedSections["__local__"] !== false;
   const localChangesExpanded = expandedSections["__local_changes__"] !== false;

   // 被 worktree 占用的 branch 不在 Branches 列表中展示
   const filteredBranches = useMemo(() => {
     const worktreeBranchSet = new Set(worktrees.map((wt) => wt.branch));
     return branches.filter((b) => !worktreeBranchSet.has(b));
   }, [worktrees, branches]);

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
        onShowToast?.(String(e), "error");
      }
   };

  return (
    <div
      className={`gh-project mb-0.5 rounded-md overflow-visible transition-[opacity,transform] duration-150 ${isActive ? "active" : ""} ${isDragOver ? "border-t-2 border-accent-blue -mt-0.5" : ""}`}
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div
        className={`gh-project-header group flex items-center p-1.5 px-2 cursor-pointer gap-1.5 rounded-md transition-colors duration-[120ms] select-none hover:bg-bg-hover ${isActive ? "bg-bg-tertiary" : ""}`}
        onClick={() => void toggleCollapsed()}
        onContextMenu={handleContextMenu}
      >
        <span
          className="gh-project-avatar w-5 h-5 rounded text-[11px] font-semibold flex items-center justify-center shrink-0 uppercase"
          style={getAvatarStyle(project.name)}
        >
          {project.name.charAt(0).toUpperCase()}
        </span>
        <div className="flex-1 flex items-center gap-1.5 min-w-0 overflow-hidden">
          <span className="text-[var(--font-size)] font-semibold text-text-primary truncate">{project.name}</span>
        </div>
        {/* Git 面板按钮 */}
        {project.git_info && onToggleGitView && (
          <button
            className={`bg-transparent border-none cursor-pointer p-1 rounded flex items-center transition-all duration-150 shrink-0 ${
              gitViewState && gitViewState !== "hidden" ? "text-accent-blue" : "text-text-muted hover:text-accent-blue"
            }`}
            title="Git Commit & Log"
            onClick={(e) => { e.stopPropagation(); onToggleGitView(); }}
          >
            <GitBranch size={13} />
          </button>
        )}
        {/* IDE 按钮 */}
        {project.selected_ide && onOpenIde && (
          <button
            className={`gh-ide-btn bg-transparent border-none cursor-pointer px-1.5 py-1 rounded flex items-center transition-all duration-150 ml-0.5 text-text-muted hover:!text-accent-blue shrink-0 ${isActive ? "opacity-0 group-hover:opacity-100" : "opacity-0 pointer-events-none"}`}
            title={`Open in IDE (Ctrl+O)\n${project.selected_ide}`}
            onClick={(e) => { e.stopPropagation(); onOpenIde(project.id); }}
          >
            <img src={getIdeIconByCommand(project.selected_ide, ideCommandOverrides)} className="w-3.5 h-3.5 object-contain block" alt="" />
          </button>
        )}
        <div className={`gh-project-actions flex items-center gap-0.5 shrink-0 ${isActive ? "opacity-0 group-hover:opacity-100" : "opacity-0 pointer-events-none"} transition-opacity duration-150`}>
          {/* Git 操作下拉菜单 */}
          {project.git_info && (
            <div className="relative" onClick={(e) => e.stopPropagation()}>
              <button
                className="bg-transparent border-none cursor-pointer p-1 rounded flex items-center text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors duration-150"
                onClick={(e) => { e.stopPropagation(); setGitMenuOpen(v => !v); }}
                title="Git actions"
              >
                <FolderGitIcon size={12} />
              </button>
              {gitMenuOpen && (
                <div className="absolute top-[calc(100%+2px)] right-0 bg-bg-secondary border border-border rounded-md min-w-[140px] z-[1000] shadow-lg overflow-hidden">
                  <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-text-secondary cursor-pointer hover:bg-bg-hover hover:text-text-primary transition-colors duration-100" onClick={(e) => { setGitMenuOpen(false); openDialog("new-branch", e); }}>
                    <GitLogoIcon size={12} />
                    New Branch
                  </div>
                  <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-text-secondary cursor-pointer hover:bg-bg-hover hover:text-text-primary transition-colors duration-100" onClick={(e) => { setGitMenuOpen(false); openDialog("new-worktree", e); }}>
                    <FolderGitIcon size={12} />
                    New Worktree
                  </div>
                </div>
              )}
            </div>
          )}
          <button
            className="bg-transparent border-none cursor-pointer p-1 rounded flex items-center text-text-muted hover:text-accent-red hover:bg-bg-hover transition-colors duration-150"
            onClick={(e) => { e.stopPropagation(); onRemoveProject(project.id); }}
            title="Remove"
          >
            <TrashIcon size={12} />
          </button>
        </div>
        <ChevronRightIcon
          size={13}
          className={`text-text-muted w-3.5 shrink-0 transition-transform duration-150 ${projectCollapsed ? "" : "rotate-90"}`}
        />
      </div>

      {!projectCollapsed && (
        <div className="py-0.5 pb-1">
          <div
            className={`group flex items-center gap-1 py-1 px-2 ml-2 mr-1 rounded-md transition-colors duration-100 cursor-pointer ${isActive ? "bg-bg-tertiary/60 text-text-primary" : "text-text-secondary hover:bg-bg-hover hover:text-text-primary"}`}
            onClick={() => onSelectProject(project.id)}
            title="Open primary terminal"
          >
            <button
              className="bg-transparent border-none cursor-pointer p-0 m-0 w-3 h-3 flex items-center justify-center text-text-muted hover:text-text-primary"
              onClick={(e) => toggleSection("__local__", e)}
              title="Toggle local details"
            >
              <ChevronRightIcon size={9} className={`transition-transform duration-150 ${localExpanded ? "rotate-90" : ""}`} />
            </button>
            <TerminalIcon size={13} className="opacity-70 shrink-0" />
            <span className="flex-1 text-[var(--font-size)] font-semibold truncate min-w-0">local</span>
            {project.git_info && (
              <div className="relative min-w-0" ref={branchDropdownRef} onClick={(e) => e.stopPropagation()}>
                <span
                  className={`gh-branch-inline flex items-center gap-1 text-xs text-accent-blue font-mono bg-accent-blue/10 border border-accent-blue/20 rounded-full px-1.5 truncate cursor-pointer transition-colors duration-150 hover:bg-accent-blue/20 hover:border-accent-blue/40 ${branchDropdownOpen ? "bg-accent-blue/20 border-accent-blue/40" : ""}`}
                  title={project.git_info.current_branch}
                  onClick={() => setBranchDropdownOpen((v) => !v)}
                >
                  <BranchIcon size={11} />
                  {project.git_info.current_branch}
                </span>
                {branchDropdownOpen && (
                  <div className="absolute top-[calc(100%+4px)] right-0 bg-bg-secondary border border-border rounded-lg min-w-[220px] max-w-[320px] z-[1000] shadow-xl overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
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
                            className={`flex items-center gap-1.5 py-1 px-3 text-xs font-mono text-text-secondary cursor-pointer transition-colors duration-100 hover:bg-bg-hover hover:text-text-primary ${isCurrent ? "!text-accent-blue cursor-default" : ""}`}
                            onClick={() => handleCheckoutFromDropdown(branch)}
                            title={isCurrent ? "Current branch" : "Click to checkout"}
                          >
                            <BranchIcon size={11} />
                            <span className="flex-1 truncate">{branch}</span>
                            {isCurrent && <span className="w-1.5 h-1.5 rounded-full bg-[#3fb950] shrink-0" title="current" />}
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

          {localExpanded && project.git_info && (
            <>
              {tree.length > 0 && (
                <>
                  <div
                    className="text-[0.72em] font-semibold uppercase tracking-[0.06em] text-text-muted py-0.5 px-2 ml-8 mr-1 select-none flex items-center gap-1 cursor-pointer rounded transition-colors duration-100 hover:bg-bg-hover hover:text-text-secondary"
                    onClick={(e) => toggleSection("__local_changes__", e)}
                  >
                    <ChevronRightIcon size={9} className={`text-[0.6em] text-text-muted w-2.5 shrink-0 transition-transform duration-150 ${localChangesExpanded ? "rotate-90" : ""}`} />
                    Changes ({changedFiles.length})
                    {(totalAdditions > 0 || totalDeletions > 0) && (
                      <span className="inline-flex items-center gap-1 ml-auto font-semibold text-[1.1em]">
                        {totalAdditions > 0 && <span className="text-[#3fb950] font-semibold">+{totalAdditions}</span>}
                        {totalDeletions > 0 && <span className="text-[#f85149] font-semibold">-{totalDeletions}</span>}
                      </span>
                    )}
                  </div>
                  {localChangesExpanded && (
                    <div className="ml-10">
                      <FileTree nodes={tree} projectId={project.id} onSelectFile={onSelectFile} />
                    </div>
                  )}
                </>
              )}
            </>
          )}

          <div className="ml-6">
              <WorktreeList
                worktrees={worktrees}
                projectId={project.id}
                expandedSections={expandedSections}
                toggleSection={toggleSection}
                onOpenWorktreeTerminal={onOpenWorktreeTerminal}
                onSelectWorktreeFile={onSelectWorktreeFile}
                onRefreshGit={onRefreshGit}
                onShowToast={onShowToast}
              />
          </div>
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
