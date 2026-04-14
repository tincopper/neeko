import React, { useState, useRef, useCallback, useMemo } from "react";
import { WSLEntrySession, WSLProject, RemoteEntrySession, RemoteProject, GitInfo, AgentConfig, AppConfig } from "../../types";
import { getDistroIcon } from "../../utils/distros";
import { getIdeIconByCommand } from "../../utils/idePresets";
import FileTree, { buildTree } from "../project/FileTree";
import ContextMenu, { ContextMenuItem } from "../project/ContextMenu";
import ProjectSettingsDialog from "../project/ProjectSettingsDialog";
import serverIcon from "../../assets/server.svg";
import { BranchIcon, ChevronRightIcon, CloseTerminalIcon, GitLogoIcon, PlusIcon, TrashIcon, FolderGitIcon } from "../icons";

// Confirm dialog for worktree removal
interface WtConfirmState {
  path: string;
  branch: string;
}

// ─── Active selection type ───────────────────────────────────────────────────
export type ActiveWslKey = { distro: string; projectId: string } | null;
export type ActiveRemoteKey = { host: string; projectId: string } | null;

const AVATAR_COLORS = [
  "#e06c75", "#d19a66", "#e5c07b", "#98c379",
  "#56b6c2", "#61afef", "#c678dd", "#be5046", "#5c6370",
];

function getAvatarStyle(name: string): React.CSSProperties {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const color = AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
  return { color, backgroundColor: color + "26" };
}

// ─── Generic project body (branches, worktrees, changed files) ───────────────

interface ProjectBodyProps {
  gitInfo: GitInfo;
  projectId: string;
  expandedSections: Record<string, boolean>;
  renamingBranch: string | null;
  renameBranchValue: string;
  renamingWorktree: string | null;
  renameWorktreeValue: string;
  onToggleSection: (section: string, e: React.MouseEvent) => void;
  onCheckoutBranch: (branch: string) => void;
  onStartRenameBranch: (branch: string, currentBranch: string) => void;
  onRenameBranchChange: (val: string) => void;
  onCommitRenameBranch: () => void;
  onCancelRename: () => void;
  onSelectFile: (filePath: string) => void;
  onOpenWorktreeTerminal: (path: string, branch: string) => void;
  onStartRenameWorktree: (path: string) => void;
  onRenameWorktreeChange: (val: string) => void;
  onCommitRenameWorktree: () => void;
  onRemoveWorktree: (path: string, branch: string) => void;
  onCancelRenameWorktree: () => void;
  renameInputRef: React.RefObject<HTMLInputElement>;
  renameWtInputRef: React.RefObject<HTMLInputElement>;
  currentBranch: string;
}

const ProjectBody: React.FC<ProjectBodyProps> = React.memo(({
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
    if (!confirmDelete) return;
    setDeletingWorktree(confirmDelete.path);
    onRemoveWorktree(confirmDelete.path, confirmDelete.branch);
    setConfirmDelete(null);
    // spinner + 淡出动画（450ms），之后由 refresh 重新渲染列表
    setTimeout(() => setDeletingWorktree(null), 500);
  }, [confirmDelete, onRemoveWorktree]);

  return (
    <div className="py-0.5 pb-1">
      {/* Branches section */}
      <div
        className="text-[0.72em] font-semibold uppercase tracking-[0.06em] text-text-muted py-1.5 px-2.5 select-none flex items-center gap-1 cursor-pointer rounded transition-colors duration-100 hover:bg-bg-hover hover:text-text-secondary"
        onClick={(e) => onToggleSection("__branches__", e)}
      >
        <ChevronRightIcon size={10} className={`text-[0.6em] text-text-muted w-2.5 shrink-0 transition-transform duration-150 ${branchesExpanded ? "rotate-90" : ""}`} />
        Branches
      </div>
      {branchesExpanded && (
        <div className="py-0 pb-1 pl-2">
          {gitInfo.branches.map((branch) => {
            const isCurrent = branch === gitInfo.current_branch;
            const isRenaming = renamingBranch === branch;
            // 当前分支默认展开显示变更文件；其他分支默认折叠
            const isExpanded = expandedSections[`branch:${branch}`] ?? isCurrent;

            return (
              <div key={branch}>
                <div
                  className={`gh-branch-item flex items-center gap-1 py-1 px-2 text-base rounded-md text-text-secondary transition-colors duration-100 hover:bg-bg-hover hover:text-text-primary cursor-pointer ${isCurrent ? "!text-accent-blue cursor-default" : ""}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isRenaming) return;
                    if (!isCurrent) {
                      onCheckoutBranch(branch);
                    } else {
                      onToggleSection(`branch:${branch}`, e);
                    }
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    if (!isRenaming) onStartRenameBranch(branch, gitInfo.current_branch);
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
                        if (e.key === "Enter") { e.preventDefault(); onCommitRenameBranch(); }
                        if (e.key === "Escape") { e.preventDefault(); onCancelRename(); }
                      }}
                      onBlur={onCommitRenameBranch}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span className="flex-1 whitespace-nowrap overflow-hidden text-ellipsis text-base cursor-pointer">{branch}</span>
                  )}
                </div>
                {/* Expanded current branch: show changed files as tree */}
                {isCurrent && isExpanded && gitInfo.changed_files.length > 0 && (
                  <div className="mt-0.5 pl-4">
                    <FileTree nodes={fileTree} projectId={projectId} onSelectFile={(_, fp) => onSelectFile(fp)} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Worktrees section */}
      {gitInfo.worktrees.length > 0 && (
        <>
          <div
            className="text-[0.72em] font-semibold uppercase tracking-[0.06em] text-text-muted py-1.5 px-2.5 select-none flex items-center gap-1 cursor-pointer rounded transition-colors duration-100 hover:bg-bg-hover hover:text-text-secondary"
            onClick={(e) => onToggleSection("__worktrees__", e)}
          >
            <ChevronRightIcon size={10} className={`text-[0.6em] text-text-muted w-2.5 shrink-0 transition-transform duration-150 ${worktreesExpanded ? "rotate-90" : ""}`} />
            Worktrees
          </div>
          {worktreesExpanded && (
            <div className="py-0 pb-1 pl-4">
              {gitInfo.worktrees.filter((wt) => wt.branch !== currentBranch).map((wt) => {
                const isRenaming = renamingWorktree === wt.path;
                return (
                  <div
                    key={wt.path}
                    className={`flex items-center gap-1 py-1 px-2 text-base rounded-md text-text-secondary transition-colors duration-100 cursor-pointer hover:bg-bg-hover ${deletingWorktree === wt.path ? "wt-deleting" : ""}`}
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
                    <FolderGitIcon size={15} style={{ opacity: 0.7 }} />
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
                      <span className="flex-1 text-base truncate min-w-0">{wt.path.split('/').pop()}</span>
                    )}
                    {!isRenaming && (
                      deletingWorktree === wt.path ? (
                        <span className="wt-spinner" title="Removing..." />
                      ) : (
                        <button
                          className="bg-transparent border-none text-text-muted cursor-pointer px-1.5 py-0.5 rounded flex items-center transition-all duration-150 hover:bg-bg-tertiary hover:text-accent-red opacity-0 group-hover:opacity-100"
                          onClick={(e) => { e.stopPropagation(); handleConfirmRemove(wt.path, wt.branch); }}
                          title="Remove worktree and branch"
                        >
                          <TrashIcon size={12} />
                        </button>
                      )
                    )}
                    <span className="flex items-center gap-1 text-xs text-accent-blue font-mono bg-accent-blue/10 border border-accent-blue/20 rounded-full px-1.5 shrink-0 max-w-[90px] truncate cursor-pointer transition-colors duration-150 hover:bg-accent-blue/20 hover:border-accent-blue/40" title={wt.branch}>
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
              Remove worktree <strong className="text-accent-blue">{confirmDelete.path.split(/[\\/]/).pop()}</strong> and delete branch <strong className="text-accent-blue">{confirmDelete.branch}</strong>?
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
              <button
                className="confirm-btn confirm-btn-danger"
                onClick={performRemove}
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
ProjectBody.displayName = "ProjectBody";

// ─── Generic project item header + expandable body ──────────────────────────

interface ProjectItemCardProps {
  project: { id: string; name: string; path: string; git_info?: GitInfo | null; selected_ide?: string | null; selected_agent?: string | null };
  isActive: boolean;
  hasSession: boolean;
  onSelectProject: () => void;
  onSelectFile: (filePath: string) => void;
  onCheckoutBranch: (branch: string) => void;
  onCommitRenameBranch: (oldName: string, newName: string) => void;
  onOpenWorktreeTerminal: (path: string, branch: string) => void;
  onCommitRenameWorktree: (oldPath: string, newName: string) => void;
  onRemoveWorktree: (path: string, branch: string) => void;
  onRemoveProject: () => void;
  onOpenIde?: () => void;
  onOpenDialog?: (type: string, branches: string[]) => void;
  currentBranch: string;
  ideCommandOverrides?: Record<string, string>;
  onOpenSettings?: () => void;
  onRefresh?: () => void;
  agents?: AgentConfig[];
  config?: AppConfig;
  onSaveProjectSettings?: (agentId: string | null, ideCommand: string | null) => void;
}

const ProjectItemCard: React.FC<ProjectItemCardProps> = React.memo(({
  project, isActive, hasSession,
  onSelectProject, onSelectFile,
  onCheckoutBranch, onCommitRenameBranch,
  onOpenWorktreeTerminal, onCommitRenameWorktree, onRemoveWorktree,
  onRemoveProject, onOpenIde, onOpenDialog,
  currentBranch, ideCommandOverrides,
  onOpenSettings, onRefresh, agents, config, onSaveProjectSettings,
}) => {
  const [collapsed, setCollapsed] = useState(true);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const [renamingBranch, setRenamingBranch] = useState<string | null>(null);
  const [renameBranchValue, setRenameBranchValue] = useState("");
  const [renamingWorktree, setRenamingWorktree] = useState<string | null>(null);
  const [renameWorktreeValue, setRenameWorktreeValue] = useState("");
  const [gitMenuOpen, setGitMenuOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const renameWtInputRef = useRef<HTMLInputElement>(null);
  const gitInfoLoaded = useRef(false);

  const gitInfo = project.git_info;

  // git_info 异步加载后自动展开（只展开一次）
  React.useEffect(() => {
    if (gitInfo && !gitInfoLoaded.current) {
      gitInfoLoaded.current = true;
      setCollapsed(false);
    }
  }, [gitInfo]);

  const toggleSection = useCallback((section: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  }, []);

  const handleStartRenameBranch = useCallback((branch: string, _currentBranch: string) => {
    setRenamingBranch(branch);
    setRenameBranchValue(branch);
    setTimeout(() => renameInputRef.current?.focus(), 0);
  }, []);

  const handleCommitRenameBranch = useCallback(() => {
    if (renamingBranch && renameBranchValue.trim() && renameBranchValue !== renamingBranch) {
      onCommitRenameBranch(renamingBranch, renameBranchValue.trim());
    }
    setRenamingBranch(null);
  }, [renamingBranch, renameBranchValue, onCommitRenameBranch]);

  const handleStartRenameWorktree = useCallback((path: string) => {
    setRenamingWorktree(path);
    const name = path.split('/').pop() || "";
    setRenameWorktreeValue(name);
    setTimeout(() => renameWtInputRef.current?.focus(), 0);
  }, []);

  const handleCommitRenameWorktree = useCallback(() => {
    if (renamingWorktree && renameWorktreeValue.trim()) {
      onCommitRenameWorktree(renamingWorktree, renameWorktreeValue.trim());
    }
    setRenamingWorktree(null);
  }, [renamingWorktree, renameWorktreeValue, onCommitRenameWorktree]);

  // Close git menu on outside click
  React.useEffect(() => {
    if (!gitMenuOpen) return;
    const handler = () => setGitMenuOpen(false);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [gitMenuOpen]);

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
        action: () => onOpenIde(),
      });
    }

    if (project.git_info) {
      items.push({
        label: "New Branch",
        icon: GitLogoIcon,
        action: () => {
          setGitMenuOpen(false);
          onOpenDialog?.("new-branch", project.git_info!.branches);
        },
      });
      items.push({
        label: "New Worktree",
        icon: FolderGitIcon,
        action: () => {
          setGitMenuOpen(false);
          onOpenDialog?.("new-worktree", project.git_info!.branches);
        },
      });
    }

    if (onRefresh) {
      items.push({
        label: "Refresh Terminal",
        shortcut: "Ctrl+R",
        action: () => onRefresh(),
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
      action: () => onRemoveProject(),
      danger: true,
    });

    return items;
  };

  return (
    <div className={`gh-project mb-0.5 rounded-md overflow-visible ${isActive ? "active" : ""}`}>
      {/* Project header */}
      <div
        className={`gh-project-header group flex items-center p-1.5 px-2 cursor-pointer gap-1.5 rounded-md transition-colors duration-[120ms] select-none hover:bg-bg-hover ${isActive ? "bg-bg-tertiary" : ""}`}
        onClick={() => onSelectProject()}
        onContextMenu={handleContextMenu}
      >
        <span
          className="w-5 h-5 rounded text-[11px] font-semibold flex items-center justify-center shrink-0 uppercase cursor-pointer"
          style={getAvatarStyle(project.name)}
          onClick={(e) => { e.stopPropagation(); setCollapsed(v => !v); }}
        >
          {project.name.charAt(0).toUpperCase()}
        </span>
        <div className="flex-1 flex items-center gap-1.5 min-w-0 overflow-hidden">
          <span className="text-[var(--font-size)] font-semibold text-text-primary truncate">{project.name}</span>
        </div>

        {/* IDE 按钮 */}
        {onOpenIde && (
          <button
            className={`gh-ide-btn bg-transparent border-none cursor-pointer px-1.5 py-1 rounded flex items-center transition-all duration-150 ml-0.5 text-text-muted hover:!text-accent-blue shrink-0 ${isActive ? "opacity-0 group-hover:opacity-100" : "opacity-0 pointer-events-none"}`}
            title={project.selected_ide ? `Open in IDE (Ctrl+O)\n${project.selected_ide}` : "Open in IDE (Ctrl+O)"}
            onClick={(e) => { e.stopPropagation(); onOpenIde(); }}
          >
            <img src={getIdeIconByCommand(project.selected_ide ?? null, ideCommandOverrides)} className="w-3.5 h-3.5 object-contain block" alt="" />
          </button>
        )}

        <div className={`gh-project-actions flex items-center gap-0.5 shrink-0 ${isActive ? "opacity-0 group-hover:opacity-100" : "opacity-0 pointer-events-none"} transition-opacity duration-150`} onClick={(e) => e.stopPropagation()}>
          {/* Git 操作下拉菜单 */}
          {gitInfo && onOpenDialog && (
            <div className="relative" onClick={(e) => e.stopPropagation()}>
              <button
                className="bg-transparent border-none cursor-pointer p-1 rounded flex items-center text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors duration-150"
                onClick={(e) => { e.stopPropagation(); setGitMenuOpen(v => !v); }}
                title="Git actions"
              >
                <GitLogoIcon size={11} />
              </button>
              {gitMenuOpen && (
                <div className="absolute top-[calc(100%+2px)] right-0 bg-bg-secondary border border-border rounded-md min-w-[140px] z-[1000] shadow-lg overflow-hidden">
                  <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-text-secondary cursor-pointer hover:bg-bg-hover hover:text-text-primary transition-colors duration-100"
                    onClick={() => { setGitMenuOpen(false); onOpenDialog("new-branch", gitInfo.branches); }}>
                    <GitLogoIcon size={12} />
                    New Branch
                  </div>
                  <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-text-secondary cursor-pointer hover:bg-bg-hover hover:text-text-primary transition-colors duration-100"
                    onClick={() => { setGitMenuOpen(false); onOpenDialog("new-worktree", gitInfo.branches); }}>
                    <FolderGitIcon size={12} />
                    New Worktree
                  </div>
                </div>
              )}
            </div>
          )}
          {hasSession && (
            <button className="bg-transparent border-none cursor-pointer p-1 rounded flex items-center text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors duration-150" title="Close terminal"
              onClick={() => onRemoveProject()}>
              <CloseTerminalIcon size={10} />
            </button>
          )}
          <button className="bg-transparent border-none cursor-pointer p-1 rounded flex items-center text-text-muted hover:text-accent-red hover:bg-bg-hover transition-colors duration-150" title="Remove project"
            onClick={() => onRemoveProject()}>×</button>
        </div>

        {/* Branch badge */}
        {gitInfo && (
          <span className="gh-branch-inline flex items-center gap-1 text-xs text-accent-blue font-mono bg-accent-blue/10 border border-accent-blue/20 rounded-full px-1.5 shrink-0 max-w-[90px] truncate" title={gitInfo.current_branch}>
            <BranchIcon size={11} style={{ opacity: 0.6 }} />
            {gitInfo.current_branch}
          </span>
        )}
      </div>

      {/* Expandable git body */}
      {!collapsed && gitInfo && (
        <ProjectBody
          gitInfo={gitInfo}
          projectId={project.id}
          expandedSections={expandedSections}
          renamingBranch={renamingBranch}
          renameBranchValue={renameBranchValue}
          renamingWorktree={renamingWorktree}
          renameWorktreeValue={renameWorktreeValue}
          onToggleSection={toggleSection}
          onCheckoutBranch={(branch) => onCheckoutBranch(branch)}
          onStartRenameBranch={handleStartRenameBranch}
          onRenameBranchChange={setRenameBranchValue}
          onCommitRenameBranch={handleCommitRenameBranch}
          onCancelRename={() => setRenamingBranch(null)}
          onSelectFile={onSelectFile}
          onOpenWorktreeTerminal={onOpenWorktreeTerminal}
          onStartRenameWorktree={handleStartRenameWorktree}
          onRenameWorktreeChange={setRenameWorktreeValue}
          onCommitRenameWorktree={handleCommitRenameWorktree}
          onRemoveWorktree={onRemoveWorktree}
          onCancelRenameWorktree={() => setRenamingWorktree(null)}
          renameInputRef={renameInputRef}
          renameWtInputRef={renameWtInputRef}
          currentBranch={currentBranch}
        />
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
          currentAgent={project.selected_agent ?? null}
          currentIde={project.selected_ide ?? null}
          agents={agents ?? []}
          config={config}
          onClose={() => setSettingsOpen(false)}
          onSave={(agentId, ideCmd) => {
            onSaveProjectSettings?.(agentId, ideCmd);
            setSettingsOpen(false);
          }}
        />
      )}
    </div>
  );
});
ProjectItemCard.displayName = "ProjectItemCard";

// ─── WSL Project Card (extracted to stabilize callbacks for React.memo) ──

interface WSLProjectCardProps {
  project: WSLProject;
  entryId: string;
  distro: string;
  isActive: boolean;
  hasSession: boolean;
  onSelectProject: (distro: string, project: WSLProject) => void;
  onRemoveProject: (entryId: string, projectId: string) => void;
  onSelectFile?: (distro: string, projectPath: string, filePath: string) => void;
  onRefreshGit?: (distro: string, projectId: string, projectPath: string) => void;
  onOpenIde?: (distro: string, projectPath: string, ide: string) => void;
  onOpenWorktreeTerminal?: (distro: string, worktreePath: string, branch: string) => void;
  onOpenDialog?: (dialog: { type: string; source: { type: string; distro: string; projectPath: string }; branches: string[] }) => void;
  ideCommandOverrides?: Record<string, string>;
  onOpenSettings?: () => void;
  onRefresh?: () => void;
  agents?: AgentConfig[];
  config?: AppConfig;
  onSaveProjectSettings?: (agentId: string | null, ideCommand: string | null) => void;
}

const WSLProjectCard: React.FC<WSLProjectCardProps> = React.memo(({
  project, entryId, distro, isActive, hasSession,
  onSelectProject, onRemoveProject, onSelectFile, onRefreshGit,
  onOpenIde, onOpenWorktreeTerminal, onOpenDialog,
  ideCommandOverrides,
  onOpenSettings, onRefresh, agents, config, onSaveProjectSettings,
}) => {
  const handleSelectFile = useCallback((fp: string) => {
    onSelectFile?.(distro, project.path, fp);
  }, [onSelectFile, distro, project.path]);

  const handleCheckout = useCallback((branch: string) => {
    import("@tauri-apps/api/core").then(({ invoke }) =>
      invoke("wsl_checkout_branch", { distro, projectPath: project.path, branchName: branch })
        .then(() => onRefreshGit?.(distro, project.id, project.path))
    );
  }, [distro, project.path, project.id, onRefreshGit]);

  const handleRenameBranch = useCallback((oldName: string, newName: string) => {
    import("@tauri-apps/api/core").then(({ invoke }) =>
      invoke("wsl_rename_branch", { distro, projectPath: project.path, oldName, newName })
        .then(() => onRefreshGit?.(distro, project.id, project.path))
        .catch(console.error)
    );
  }, [distro, project.path, project.id, onRefreshGit]);

  const handleOpenWorktree = useCallback((wtPath: string, branch: string) => {
    onOpenWorktreeTerminal?.(distro, wtPath, branch);
  }, [onOpenWorktreeTerminal, distro]);

  const handleRenameWorktree = useCallback((oldPath: string, newName: string) => {
    import("@tauri-apps/api/core").then(({ invoke }) =>
      invoke("wsl_rename_worktree", { distro, projectPath: project.path, worktreePath: oldPath, newName })
        .then(() => onRefreshGit?.(distro, project.id, project.path))
        .catch(console.error)
    );
  }, [distro, project.path, project.id, onRefreshGit]);

  const handleRemoveWorktree = useCallback((wtPath: string, _branch: string) => {
    import("@tauri-apps/api/core").then(({ invoke }) =>
      invoke("wsl_remove_worktree", { distro, projectPath: project.path, worktreePath: wtPath })
        .then(() => onRefreshGit?.(distro, project.id, project.path))
        .catch((e: unknown) => { console.error("[WSL] Failed to remove worktree:", e); })
    );
  }, [distro, project.path, project.id, onRefreshGit]);

  const handleRemove = useCallback(() => {
    onRemoveProject(entryId, project.id);
  }, [onRemoveProject, entryId, project.id]);

  const handleOpenIde = useMemo(() =>
    onOpenIde ? () => onOpenIde(distro, project.path, project.selected_ide ?? "") : undefined,
    [onOpenIde, distro, project.path, project.selected_ide]
  );

  const handleOpenDialog = useMemo(() =>
    onOpenDialog
      ? (type: string, branches: string[]) =>
          onOpenDialog({ type, source: { type: "wsl", distro, projectPath: project.path }, branches })
      : undefined,
    [onOpenDialog, distro, project.path]
  );

  return (
    <ProjectItemCard
      project={project}
      isActive={isActive}
      hasSession={hasSession}
      onSelectProject={() => onSelectProject(distro, project)}
      onSelectFile={handleSelectFile}
      onCheckoutBranch={handleCheckout}
      onCommitRenameBranch={handleRenameBranch}
      onOpenWorktreeTerminal={handleOpenWorktree}
      onCommitRenameWorktree={handleRenameWorktree}
      onRemoveWorktree={handleRemoveWorktree}
      onRemoveProject={handleRemove}
      onOpenIde={handleOpenIde}
      onOpenDialog={handleOpenDialog}
      currentBranch={project.git_info?.current_branch ?? ""}
      ideCommandOverrides={ideCommandOverrides}
      onOpenSettings={onOpenSettings}
      onRefresh={onRefresh}
      agents={agents}
      config={config}
      onSaveProjectSettings={onSaveProjectSettings}
    />
  );
});
WSLProjectCard.displayName = "WSLProjectCard";

// ─── WSLItem ──────────────────────────────────────────────────────────────────

interface WSLItemProps {
  entry: WSLEntrySession;
  activeKey: ActiveWslKey;
  openSessions: Set<string>;
  onSelectProject: (distro: string, project: WSLProject) => void;
  onCloseProject: (entryId: string, projectId: string) => void;
  onRemoveProject: (entryId: string, projectId: string) => void;
  onRemoveEntry: (entryId: string) => void;
  onAddProject: (entryId: string) => void;
  onSelectFile?: (distro: string, projectPath: string, filePath: string) => void;
  onRefreshGit?: (distro: string, projectId: string, projectPath: string) => void;
  onOpenIde?: (distro: string, projectPath: string, ide: string) => void;
  onOpenWorktreeTerminal?: (distro: string, worktreePath: string, branch: string) => void;
  onOpenDialog?: (dialog: { type: string; source: { type: string; distro: string; projectPath: string }; branches: string[] }) => void;
  ideCommandOverrides?: Record<string, string>;
  onOpenSettings?: () => void;
  onRefresh?: (distro: string, projectId: string) => void;
  agents?: AgentConfig[];
  config?: AppConfig;
  onSaveProjectSettings?: (agentId: string | null, ideCommand: string | null) => void;
}

export const WSLItem = React.memo<WSLItemProps>(({
  entry,
  activeKey,
  openSessions,
  onSelectProject,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onCloseProject,
  onRemoveProject,
  onRemoveEntry,
  onAddProject,
  onSelectFile,
  onRefreshGit,
  onOpenIde,
  onOpenWorktreeTerminal,
  onOpenDialog,
  ideCommandOverrides,
  onOpenSettings,
  onRefresh,
  agents,
  config,
  onSaveProjectSettings,
}) => {
  void onCloseProject; // intentionally unused — close handled by terminal session
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="gh-project mb-0.5 rounded-md overflow-visible">
      <div className="gh-project-header group flex items-center p-1.5 px-2 cursor-pointer gap-1.5 rounded-md transition-colors duration-[120ms] select-none hover:bg-bg-hover">
        <img
          src={getDistroIcon(entry.distro)}
          className="sidebar-distro-icon w-5 h-5 shrink-0"
          alt=""
          style={{ cursor: "pointer" }}
          onClick={(e) => { e.stopPropagation(); setCollapsed((v) => !v); }}
        />
        <div className="flex-1 flex items-center gap-1.5 min-w-0 overflow-hidden">
          <span className="text-[var(--font-size)] font-semibold text-text-primary truncate">{entry.distro}</span>
          <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 4 }}>WSL</span>
        </div>
        <div className="gh-project-actions flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-150" onClick={(e) => e.stopPropagation()}>
          <button className="bg-transparent border-none cursor-pointer p-1 rounded flex items-center text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors duration-150" title="Add WSL project" onClick={() => onAddProject(entry.id)}>
            <PlusIcon size={11} />
          </button>
          <button className="bg-transparent border-none cursor-pointer p-1 rounded flex items-center text-text-muted hover:text-accent-red hover:bg-bg-hover transition-colors duration-150" title="Remove distro" onClick={() => onRemoveEntry(entry.id)}>
            <TrashIcon size={11} />
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="py-0.5 pb-1" style={{ paddingLeft: 16 }}>
          {entry.projects.length === 0 ? (
            <div className="text-xs text-text-muted py-2" style={{ paddingLeft: 28 }}>No projects</div>
          ) : (
            entry.projects.map((project) => {
              const isActive = activeKey?.distro === entry.distro && activeKey?.projectId === project.id;
              const hasSession = openSessions.has(project.id);
              return (
                <WSLProjectCard
                  key={project.id}
                  project={project}
                  entryId={entry.id}
                  distro={entry.distro}
                  isActive={isActive}
                  hasSession={hasSession}
                  onSelectProject={onSelectProject}
                  onRemoveProject={onRemoveProject}
                  onSelectFile={onSelectFile}
                  onRefreshGit={onRefreshGit}
                  onOpenIde={onOpenIde}
                  onOpenWorktreeTerminal={onOpenWorktreeTerminal}
                  onOpenDialog={onOpenDialog}
                  ideCommandOverrides={ideCommandOverrides}
                  onOpenSettings={onOpenSettings}
                  onRefresh={onRefresh ? () => onRefresh(entry.distro, project.id) : undefined}
                  agents={agents}
                  config={config}
                  onSaveProjectSettings={onSaveProjectSettings}
                />
              );
            })
          )}
        </div>
      )}
    </div>
  );
});

// ─── Remote Project Card (extracted to stabilize callbacks for React.memo) ──

interface RemoteProjectCardProps {
  project: RemoteProject;
  entryId: string;
  host: string;
  isActive: boolean;
  hasSession: boolean;
  onSelectProject: (host: string, project: RemoteProject) => void;
  onRemoveProject: (entryId: string, projectId: string) => void;
  onSelectFile?: (entryId: string, projectPath: string, filePath: string) => void;
  onRefreshGit?: (entryId: string, projectId: string, projectPath: string) => void;
  onOpenIde?: (entryId: string, projectPath: string, ide: string) => void;
  onOpenWorktreeTerminal?: (entryId: string, worktreePath: string, branch: string) => void;
  invokeRemoteGit?: (command: string, entryId: string, extra: Record<string, unknown>) => Promise<unknown>;
  onOpenDialog?: (dialog: { type: string; source: { type: string; entryId: string; projectPath: string }; branches: string[] }) => void;
  ideCommandOverrides?: Record<string, string>;
  onOpenSettings?: () => void;
  onRefresh?: () => void;
  agents?: AgentConfig[];
  config?: AppConfig;
  onSaveProjectSettings?: (agentId: string | null, ideCommand: string | null) => void;
}

const RemoteProjectCard: React.FC<RemoteProjectCardProps> = React.memo(({
  project, entryId, host, isActive, hasSession,
  onSelectProject, onRemoveProject, onSelectFile, onRefreshGit,
  onOpenIde, onOpenWorktreeTerminal,
  invokeRemoteGit, onOpenDialog, ideCommandOverrides,
  onOpenSettings, onRefresh, agents, config, onSaveProjectSettings,
}) => {
  const handleSelectFile = useCallback((fp: string) => {
    onSelectFile?.(entryId, project.path, fp);
  }, [onSelectFile, entryId, project.path]);

  const handleCheckout = useCallback((branch: string) => {
    if (invokeRemoteGit) {
      invokeRemoteGit("remote_checkout_branch", entryId, { projectPath: project.path, branchName: branch })
        .then(() => onRefreshGit?.(entryId, project.id, project.path));
    }
  }, [invokeRemoteGit, entryId, project.path, project.id, onRefreshGit]);

  const handleRenameBranch = useCallback((oldName: string, newName: string) => {
    if (invokeRemoteGit) {
      invokeRemoteGit("remote_rename_branch", entryId, { projectPath: project.path, oldName, newName })
        .then(() => onRefreshGit?.(entryId, project.id, project.path))
        .catch(console.error);
    }
  }, [invokeRemoteGit, entryId, project.path, project.id, onRefreshGit]);

  const handleOpenWorktree = useCallback((wtPath: string, branch: string) => {
    onOpenWorktreeTerminal?.(entryId, wtPath, branch);
  }, [onOpenWorktreeTerminal, entryId]);

  const handleRenameWorktree = useCallback((oldPath: string, newName: string) => {
    if (invokeRemoteGit) {
      invokeRemoteGit("remote_rename_worktree", entryId, { projectPath: project.path, worktreePath: oldPath, newName })
        .then(() => onRefreshGit?.(entryId, project.id, project.path))
        .catch(console.error);
    }
  }, [invokeRemoteGit, entryId, project.path, project.id, onRefreshGit]);

  const handleRemoveWorktree = useCallback((wtPath: string, _branch: string) => {
    if (invokeRemoteGit) {
      invokeRemoteGit("remote_remove_worktree", entryId, { projectPath: project.path, worktreePath: wtPath })
        .then(() => onRefreshGit?.(entryId, project.id, project.path))
        .catch((e: unknown) => { console.error("[SSH] Failed to remove worktree:", e); });
    }
  }, [invokeRemoteGit, entryId, project.path, project.id, onRefreshGit]);

  const handleRemove = useCallback(() => {
    onRemoveProject(entryId, project.id);
  }, [onRemoveProject, entryId, project.id]);

  const handleOpenIde = useMemo(() =>
    onOpenIde ? () => onOpenIde(entryId, project.path, project.selected_ide ?? "") : undefined,
    [onOpenIde, entryId, project.path, project.selected_ide]
  );

  const handleOpenDialog = useMemo(() =>
    onOpenDialog
      ? (type: string, branches: string[]) =>
          onOpenDialog({ type, source: { type: "remote", entryId, projectPath: project.path }, branches })
      : undefined,
    [onOpenDialog, entryId, project.path]
  );

  return (
    <ProjectItemCard
      project={project}
      isActive={isActive}
      hasSession={hasSession}
      onSelectProject={() => onSelectProject(host, project)}
      onSelectFile={handleSelectFile}
      onCheckoutBranch={handleCheckout}
      onCommitRenameBranch={handleRenameBranch}
      onOpenWorktreeTerminal={handleOpenWorktree}
      onCommitRenameWorktree={handleRenameWorktree}
      onRemoveWorktree={handleRemoveWorktree}
      onRemoveProject={handleRemove}
      onOpenIde={handleOpenIde}
      onOpenDialog={handleOpenDialog}
      currentBranch={project.git_info?.current_branch ?? ""}
      ideCommandOverrides={ideCommandOverrides}
      onOpenSettings={onOpenSettings}
      onRefresh={onRefresh}
      agents={agents}
      config={config}
      onSaveProjectSettings={onSaveProjectSettings}
    />
  );
});
RemoteProjectCard.displayName = "RemoteProjectCard";

// ─── RemoteItem ───────────────────────────────────────────────────────────────

interface RemoteItemProps {
  entry: RemoteEntrySession;
  activeKey: ActiveRemoteKey;
  openSessions: Set<string>;
  onSelectProject: (host: string, project: RemoteProject) => void;
  onCloseProject: (entryId: string, projectId: string) => void;
  onRemoveProject: (entryId: string, projectId: string) => void;
  onRemoveEntry: (entryId: string) => void;
  onAddProject: (entryId: string) => void;
  onSelectFile?: (entryId: string, projectPath: string, filePath: string) => void;
  onRefreshGit?: (entryId: string, projectId: string, projectPath: string) => void;
  onOpenIde?: (entryId: string, projectPath: string, ide: string) => void;
  onOpenWorktreeTerminal?: (entryId: string, worktreePath: string, branch: string) => void;
  invokeRemoteGit?: (command: string, entryId: string, extra: Record<string, unknown>) => Promise<unknown>;
  onOpenDialog?: (dialog: { type: string; source: { type: string; entryId: string; projectPath: string }; branches: string[] }) => void;
  ideCommandOverrides?: Record<string, string>;
  onOpenSettings?: () => void;
  onRefresh?: (entryId: string, projectId: string) => void;
  agents?: AgentConfig[];
  config?: AppConfig;
  onSaveProjectSettings?: (agentId: string | null, ideCommand: string | null) => void;
}

export const RemoteItem = React.memo<RemoteItemProps>(({
  entry,
  activeKey,
  openSessions,
  onSelectProject,
  onCloseProject,
  onRemoveProject,
  onRemoveEntry,
  onAddProject,
  onSelectFile,
  onRefreshGit,
  onOpenIde,
  onOpenWorktreeTerminal,
  invokeRemoteGit,
  onOpenDialog,
  ideCommandOverrides,
  onOpenSettings,
  onRefresh,
  agents,
  config,
  onSaveProjectSettings,
}) => {
  void onCloseProject;
  const [collapsed, setCollapsed] = useState(false);
  const label = `${entry.host}:${entry.port}`;

  return (
    <div className="gh-project mb-0.5 rounded-md overflow-visible">
      <div className="gh-project-header group flex items-center p-1.5 px-2 cursor-pointer gap-1.5 rounded-md transition-colors duration-[120ms] select-none hover:bg-bg-hover">
        <img
          src={serverIcon}
          className="sidebar-distro-icon w-5 h-5 shrink-0"
          alt=""
          style={{ cursor: "pointer" }}
          onClick={(e) => { e.stopPropagation(); setCollapsed((v) => !v); }}
        />
        <div className="flex-1 flex items-center gap-1.5 min-w-0 overflow-hidden">
          <span className="text-[var(--font-size)] font-semibold text-text-primary truncate">{label}</span>
          <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 4 }}>SSH</span>
        </div>
        <div className="gh-project-actions flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-150" onClick={(e) => e.stopPropagation()}>
          <button className="bg-transparent border-none cursor-pointer p-1 rounded flex items-center text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors duration-150" title="Add remote project" onClick={() => onAddProject(entry.id)}>
            <PlusIcon size={11} />
          </button>
          <button className="bg-transparent border-none cursor-pointer p-1 rounded flex items-center text-text-muted hover:text-accent-red hover:bg-bg-hover transition-colors duration-150" title="Remove server" onClick={() => onRemoveEntry(entry.id)}>
            <TrashIcon size={11} />
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="py-0.5 pb-1" style={{ paddingLeft: 16 }}>
          {entry.projects.length === 0 ? (
            <div className="text-xs text-text-muted py-2" style={{ paddingLeft: 28 }}>No projects</div>
          ) : (
            entry.projects.map((project) => {
              const isActive = activeKey?.host === entry.host && activeKey?.projectId === project.id;
              const hasSession = openSessions.has(project.id);
              return (
                <RemoteProjectCard
                  key={project.id}
                  project={project}
                  entryId={entry.id}
                  host={entry.host}
                  isActive={isActive}
                  hasSession={hasSession}
                  onSelectProject={onSelectProject}
                  onRemoveProject={onRemoveProject}
                  onSelectFile={onSelectFile}
                  onRefreshGit={onRefreshGit}
                  onOpenIde={onOpenIde}
                  onOpenWorktreeTerminal={onOpenWorktreeTerminal}
                  invokeRemoteGit={invokeRemoteGit}
                  onOpenDialog={onOpenDialog}
                  ideCommandOverrides={ideCommandOverrides}
                  onOpenSettings={onOpenSettings}
                  onRefresh={onRefresh ? () => onRefresh(entry.id, project.id) : undefined}
                  agents={agents}
                  config={config}
                  onSaveProjectSettings={onSaveProjectSettings}
                />
              );
            })
          )}
        </div>
      )}
    </div>
  );
});
