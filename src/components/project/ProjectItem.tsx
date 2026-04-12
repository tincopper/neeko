import React, { useState, useEffect, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Project, AgentConfig, AppConfig } from "../../types";
import { DialogType, DialogState } from "./GitDialog";
import FileTree, { buildTree } from "./FileTree";
import WorktreeList from "./WorktreeList";
import ContextMenu, { ContextMenuItem } from "./ContextMenu";
import ProjectSettingsDialog from "./ProjectSettingsDialog";
import { getIdeIconByCommand } from "../../utils/idePresets";
import { cn } from "../../utils/cn";
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
  onSelectWorktreeFile,
  ideCommandOverrides,
  onOpenSettings,
  onRefresh,
  agents,
  config,
  onSaveProjectSettings,
  onDragEnd,
  onShowToast,
}) => {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const [projectCollapsed, setProjectCollapsed] = useState(project.collapsed ?? true);
  const [gitMenuOpen, setGitMenuOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // State-based drag (replaces classList manipulation)
  const [isDragging, setIsDragging] = useState(false);
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);
  const dragRef = useRef<{ startY: number; started: boolean } | null>(null);

  // Branch dropdown state
  const [branchDropdownOpen, setBranchDropdownOpen] = useState(false);
  const [branchSearchQuery, setBranchSearchQuery] = useState("");
  const branchDropdownRef = useRef<HTMLDivElement>(null);
  const branchSearchInputRef = useRef<HTMLInputElement>(null);

  // Toggle collapsed and persist
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

  // Pointer-based drag handlers (state-based instead of classList)
  const handleHeaderPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("button, input, select, a")) return;

    dragRef.current = { startY: e.clientY, started: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handleHeaderPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const DRAG_THRESHOLD = 5;
    if (!dragRef.current.started) {
      if (Math.abs(e.clientY - dragRef.current.startY) < DRAG_THRESHOLD) return;
      dragRef.current.started = true;
      setIsDragging(true);
    }
    // Detect drop target via elementFromPoint
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-project-id]") as HTMLElement | null;
    const targetId = el?.dataset.projectId;
    if (targetId && targetId !== project.id) {
      setDragOverTarget(targetId);
    } else {
      setDragOverTarget(null);
    }
  };

  const handleHeaderPointerUp = (_e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const wasDragging = dragRef.current.started;
    if (wasDragging && dragOverTarget && onDragEnd) {
      onDragEnd(project.id, dragOverTarget);
    }
    setIsDragging(false);
    setDragOverTarget(null);
    dragRef.current = null;
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

   // Branches occupied by worktrees are not shown in the Branches list
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
      className={cn(
        "mb-0.5 rounded-md overflow-visible transition-[opacity,transform] duration-150",
        isDragging && "opacity-40 scale-[0.98] cursor-grabbing",
        dragOverTarget === project.id && "border-t-2 border-accent-blue -mt-0.5"
      )}
      data-project-id={project.id}
    >
      <div
        className="group flex items-center p-1.5 px-2 cursor-pointer gap-1.5 rounded-md transition-colors duration-[120ms] select-none hover:bg-bg-hover"
        onClick={() => onSelectProject(project.id)}
        onContextMenu={handleContextMenu}
        onPointerDown={handleHeaderPointerDown}
        onPointerMove={handleHeaderPointerMove}
        onPointerUp={handleHeaderPointerUp}
      >
        <span
          className="w-5 h-5 rounded text-[11px] font-semibold flex items-center justify-center shrink-0 uppercase cursor-pointer"
          style={getAvatarStyle(project.name)}
          onClick={(e) => { e.stopPropagation(); toggleCollapsed(); }}
        >
          {project.name.charAt(0).toUpperCase()}
        </span>
        <div className="flex-1 flex items-center gap-1.5 min-w-0 overflow-hidden">
          <span className="text-[0.93em] font-semibold text-text-primary truncate">{project.name}</span>
        </div>
        {/* IDE button */}
        {project.selected_ide && onOpenIde && (
          <button
            className={cn(
              "bg-transparent border-none cursor-pointer px-1.5 py-1 rounded flex items-center transition-all duration-150 opacity-100 ml-0.5 text-text-muted hover:!text-accent-blue",
              isActive ? "opacity-0 hover:opacity-100" : "opacity-0 group-hover:opacity-100"
            )}
            title={`Open in IDE (Ctrl+O)\n${project.selected_ide}`}
            onClick={(e) => { e.stopPropagation(); onOpenIde(project.id); }}
          >
            <img src={getIdeIconByCommand(project.selected_ide, ideCommandOverrides)} className="w-3.5 h-3.5 object-contain block" alt="" />
          </button>
        )}
        <div className={cn(
          "flex gap-0.5 shrink-0 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
        )}>
          {/* Side Terminal button */}
          {onOpenSideTerminal && isActive && project.active_view === "Terminal" && (
            <button
              className="bg-transparent border-none text-text-muted cursor-pointer px-1.5 py-1 rounded flex items-center transition-all duration-150 hover:bg-bg-tertiary hover:text-text-primary"
              onClick={(e) => { e.stopPropagation(); onOpenSideTerminal(project.id); }}
              title="Open side terminal (Ctrl+Alt+T)"
            >
              <SideTerminalIcon size={12} />
            </button>
          )}
          {/* Git actions dropdown */}
          {project.git_info && (
            <div className="relative" onClick={(e) => e.stopPropagation()}>
              <button
                className="bg-transparent border-none text-text-muted cursor-pointer px-1.5 py-1 rounded flex items-center transition-all duration-150 hover:bg-bg-tertiary hover:text-text-primary flex items-center gap-0.5"
                onClick={(e) => { e.stopPropagation(); setGitMenuOpen(v => !v); }}
                title="Git actions"
              >
                <GitLogoIcon size={12} />
              </button>
              {gitMenuOpen && (
                <div className="absolute top-[calc(100%+4px)] right-0 bg-bg-tertiary border border-border rounded-md min-w-[150px] z-[1000] shadow-lg overflow-hidden">
                  <div className="flex items-center gap-2 p-1.5 px-3 text-base text-text-primary cursor-pointer transition-colors duration-100 hover:bg-bg-hover" onClick={(e) => { setGitMenuOpen(false); openDialog("new-branch", e); }}>
                    <GitLogoIcon size={12} />
                    New Branch
                  </div>
                  <div className="flex items-center gap-2 p-1.5 px-3 text-base text-text-primary cursor-pointer transition-colors duration-100 hover:bg-bg-hover" onClick={(e) => { setGitMenuOpen(false); openDialog("new-worktree", e); }}>
                    <FolderGitIcon size={12} />
                    New Worktree
                  </div>
                </div>
              )}
            </div>
          )}
          <button
            className="bg-transparent border-none text-text-muted cursor-pointer px-1.5 py-1 rounded flex items-center transition-all duration-150 hover:bg-bg-tertiary hover:text-text-primary hover:text-accent-red"
            onClick={(e) => { e.stopPropagation(); onRemoveProject(project.id); }}
            title="Remove"
          >
            <TrashIcon size={12} />
          </button>
        </div>
        {project.git_info && (
          <div className="relative shrink-0" ref={branchDropdownRef}>
            <span
              className={cn(
                "flex items-center gap-1 text-xs text-accent-blue font-mono bg-accent-blue/10 border border-accent-blue/20 rounded-full px-1.5 shrink-0 max-w-[90px] truncate cursor-pointer transition-colors duration-150 hover:bg-accent-blue/20 hover:border-accent-blue/40",
                branchDropdownOpen && "bg-accent-blue/20 border-accent-blue/40"
              )}
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
              <div className="absolute top-[calc(100%+4px)] right-0 bg-bg-secondary border border-border rounded-lg min-w-[220px] max-w-[320px] z-[1000] shadow-xl overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center gap-1.5 p-2 px-2.5 border-b border-border">
                  <SearchIcon size={12} className="text-text-muted shrink-0" />
                  <input
                    ref={branchSearchInputRef}
                    className="flex-1 bg-transparent border-none outline-none text-text-primary text-xs font-inherit"
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
                    const isCurrent = branch === project.git_info!.current_branch;
                    return (
                      <div
                        key={branch}
                        className={cn(
                          "flex items-center gap-1.5 py-1 px-3 text-xs font-mono text-text-secondary cursor-pointer transition-colors duration-100 hover:bg-bg-hover hover:text-text-primary",
                          isCurrent && "text-accent-blue cursor-default"
                        )}
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

      {!projectCollapsed && (
        <div className="py-0.5 pb-1">
          {project.git_info && (
            <>
              {/* Changed Files (current branch) */}
              {tree.length > 0 && (
                <>
                  <div
                    className="text-[0.72em] font-semibold uppercase tracking-[0.06em] text-text-muted py-1.5 px-2.5 select-none flex items-center gap-1 cursor-pointer rounded py-1 px-2 transition-colors duration-100 hover:bg-bg-hover hover:text-text-secondary"
                    onClick={(e) => toggleSection("__changes__", e)}
                  >
                    <ChevronRightIcon size={9} className={cn("text-[0.6em] text-text-muted w-2.5 shrink-0 transition-transform duration-150", expandedSections["__changes__"] !== false && "rotate-90")} />
                    Changes ({changedFiles.length})
                    {(totalAdditions > 0 || totalDeletions > 0) && (
                      <span className="inline-flex items-center gap-1 ml-auto font-semibold text-[1.1em]">
                        {totalAdditions > 0 && <span className="text-[#3fb950] font-semibold">+{totalAdditions}</span>}
                        {totalDeletions > 0 && <span className="text-[#f85149] font-semibold">-{totalDeletions}</span>}
                      </span>
                    )}
                  </div>
                  {expandedSections["__changes__"] !== false && (
                    <div className="mt-0.5 pl-4">
                      <FileTree nodes={tree} projectId={project.id} onSelectFile={onSelectFile} />
                    </div>
                  )}
                </>
              )}

              {/* Worktrees */}
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
