import React, { useState, useRef, useCallback } from "react";
import { WSLEntrySession, WSLProject, RemoteEntrySession, RemoteProject, GitInfo } from "../../types";
import { getDistroIcon } from "../../utils/distros";
import serverIcon from "../../assets/server.svg";

// ─── Active selection type ───────────────────────────────────────────────────
export type ActiveWslKey = { distro: string; projectId: string } | null;
export type ActiveRemoteKey = { host: string; projectId: string } | null;

// ─── Shared SVG icons ────────────────────────────────────────────────────────
const FILE_SVG = <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" style={{ flexShrink: 0, opacity: 0.6 }}>
  <path d="M0 2.75C0 1.784.784 1 1.75 1h12.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0 1 14.25 15H1.75A1.75 1.75 0 0 1 0 13.25Zm1.75-.25a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25V2.75a.25.25 0 0 0-.25-.25ZM7.25 8a.75.75 0 0 1-.22.53l-2.25 2.25a.75.75 0 1 1-1.06-1.06L5.44 8 3.72 6.28a.75.75 0 1 1 1.06-1.06l2.25 2.25c.141.14.22.331.22.53Zm1.5 1.5h3a.75.75 0 0 1 0 1.5h-3a.75.75 0 0 1 0-1.5Z" />
</svg>;

const BRANCH_SVG = <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" style={{ flexShrink: 0, opacity: 0.6 }}>
  <path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.5 2.5 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Zm-6 0a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Zm8.25-.75a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z" />
</svg>;

const SIDE_TERMINAL_SVG = <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
  <path d="M0 2.75C0 1.784.784 1 1.75 1h12.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0 1 14.25 15H1.75A1.75 1.75 0 0 1 0 13.25Zm1.75-.25a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25V2.75a.25.25 0 0 0-.25-.25ZM7.25 8a.75.75 0 0 1-.22.53l-2.25 2.25a.75.75 0 1 1-1.06-1.06L5.44 8 3.72 6.28a.75.75 0 1 1 1.06-1.06l2.25 2.25c.141.14.22.331.22.53Zm1.5 1.5h3a.75.75 0 0 1 0 1.5h-3a.75.75 0 0 1 0-1.5Z" />
</svg>;

const CLOSE_TERMINAL_SVG = <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor">
  <rect x="2" y="2" width="8" height="8" rx="1.5" />
</svg>;

const GIT_SVG = <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
  <path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.5 2.5 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Zm-6 0a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Zm8.25-.75a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z" />
</svg>;

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

// ─── File status helpers ─────────────────────────────────────────────────────

function getFileStatusClass(status: string): string {
  switch (status) {
    case "Added": return "file-added";
    case "Modified": return "file-modified";
    case "Deleted": return "file-deleted";
    case "Renamed": return "file-renamed";
    case "Untracked": return "file-untracked";
    default: return "";
  }
}

function getFileStatusLabel(status: string): string {
  switch (status) {
    case "Added": return "A";
    case "Modified": return "M";
    case "Deleted": return "D";
    case "Renamed": return "R";
    case "Untracked": return "?";
    default: return "";
  }
}

// ─── Generic project body (branches, worktrees, changed files) ───────────────

interface ProjectBodyProps {
  gitInfo: GitInfo;
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
  onRemoveWorktree: (path: string) => void;
  onCancelRenameWorktree: () => void;
  renameInputRef: React.RefObject<HTMLInputElement>;
  renameWtInputRef: React.RefObject<HTMLInputElement>;
}

const ProjectBody: React.FC<ProjectBodyProps> = React.memo(({
  gitInfo,
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
}) => {
  const branchesExpanded = expandedSections["__branches__"] ?? true;
  const worktreesExpanded = expandedSections["__worktrees__"] ?? true;

  return (
    <div className="gh-project-body">
      {/* Branches section */}
      <div
        className="gh-section-label gh-section-label-collapsible"
        onClick={(e) => onToggleSection("__branches__", e)}
      >
        <svg className={`gh-section-chevron ${branchesExpanded ? "expanded" : ""}`}
          width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
          <path d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z" />
        </svg>
        Branches
      </div>
      {branchesExpanded && (
        <div className="gh-branch-list">
          {gitInfo.branches.map((branch) => {
            const isCurrent = branch === gitInfo.current_branch;
            const isRenaming = renamingBranch === branch;
            // 当前分支默认展开显示变更文件；其他分支默认折叠
            const isExpanded = expandedSections[`branch:${branch}`] ?? isCurrent;

            return (
              <div key={branch}>
                <div
                  className={`gh-branch-item${isCurrent ? " current" : ""}`}
                  style={{ cursor: "pointer" }}
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
                  {BRANCH_SVG}
                  {isRenaming ? (
                    <input
                      ref={renameInputRef}
                      className="gh-rename-input"
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
                    <span className="gh-branch-item-name">{branch}</span>
                  )}
                </div>
                {/* Expanded current branch: show changed files */}
                {isCurrent && isExpanded && gitInfo.changed_files.length > 0 && (
                  <div className="gh-file-list">
                    {gitInfo.changed_files.map((f) => (
                      <div
                        key={f.path}
                        className={`gh-file-item file-item`}
                        onClick={(e) => { e.stopPropagation(); onSelectFile(f.path); }}
                      >
                        <span className={`file-status-icon ${getFileStatusClass(f.status)}`}>
                          {getFileStatusLabel(f.status)}
                        </span>
                        <span className="file-path-name">{f.path.split('/').pop()}</span>
                        <span className="file-path-full">{f.path}</span>
                        {f.additions > 0 && <span className="file-stat additions">+{f.additions}</span>}
                        {f.deletions > 0 && <span className="file-stat deletions">-{f.deletions}</span>}
                      </div>
                    ))}
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
            className="gh-section-label gh-section-label-collapsible"
            onClick={(e) => onToggleSection("__worktrees__", e)}
          >
            <svg className={`gh-section-chevron ${worktreesExpanded ? "expanded" : ""}`}
              width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
              <path d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z" />
            </svg>
            Worktrees
          </div>
          {worktreesExpanded && (
            <div className="gh-worktree-list">
              {gitInfo.worktrees.map((wt) => {
                const isRenaming = renamingWorktree === wt.path;
                return (
                  <div
                    key={wt.path}
                    className="gh-worktree-item gh-worktree-item-standalone"
                    style={{ cursor: "pointer" }}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isRenaming) return;
                      onOpenWorktreeTerminal(wt.path, wt.branch);
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      if (!isRenaming) onStartRenameWorktree(wt.path);
                    }}
                    title={`${wt.path}\nClick to open terminal`}
                  >
                    {FILE_SVG}
                    {isRenaming ? (
                      <input
                        ref={renameWtInputRef}
                        className="gh-rename-input"
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
                      <span className="gh-branch-item-name">{wt.path.split('/').pop()}</span>
                    )}
                    <span className="gh-worktree-branch" style={{ marginLeft: 8, fontSize: 11, color: "var(--text-muted)" }}>
                      {wt.branch}
                    </span>
                    {!isRenaming && (
                      <button
                        className="gh-icon-btn gh-icon-btn-danger"
                        style={{ marginLeft: "auto" }}
                        onClick={(e) => { e.stopPropagation(); onRemoveWorktree(wt.path); }}
                        title="Remove worktree"
                      >×</button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
});
ProjectBody.displayName = "ProjectBody";

// ─── Generic project item header + expandable body ──────────────────────────

interface ProjectItemCardProps {
  project: { id: string; name: string; path: string; git_info?: GitInfo | null; selected_ide?: string | null };
  isActive: boolean;
  hasSession: boolean;
  onSelectProject: () => void;
  onSelectFile: (filePath: string) => void;
  onCheckoutBranch: (branch: string) => void;
  onCommitRenameBranch: (oldName: string, newName: string) => void;
  onOpenWorktreeTerminal: (path: string, branch: string) => void;
  onCommitRenameWorktree: (oldPath: string, newName: string) => void;
  onRemoveWorktree: (path: string) => void;
  onOpenSideTerminal?: () => void;
  onRemoveProject: () => void;
  onOpenIde?: () => void;
  onOpenDialog?: (type: string, branches: string[]) => void;
}

const ProjectItemCard: React.FC<ProjectItemCardProps> = React.memo(({
  project, isActive, hasSession,
  onSelectProject, onSelectFile,
  onCheckoutBranch, onCommitRenameBranch,
  onOpenWorktreeTerminal, onCommitRenameWorktree, onRemoveWorktree,
  onOpenSideTerminal, onRemoveProject, onOpenIde, onOpenDialog,
}) => {
  const [collapsed, setCollapsed] = useState(true);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const [renamingBranch, setRenamingBranch] = useState<string | null>(null);
  const [renameBranchValue, setRenameBranchValue] = useState("");
  const [renamingWorktree, setRenamingWorktree] = useState<string | null>(null);
  const [renameWorktreeValue, setRenameWorktreeValue] = useState("");
  const [gitMenuOpen, setGitMenuOpen] = useState(false);
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

  return (
    <div className={`gh-project${isActive ? " active" : ""}`}>
      {/* Project header */}
      <div
        className="gh-project-header"
        onClick={() => onSelectProject()}
      >
        <span
          className="gh-project-avatar"
          style={{ ...getAvatarStyle(project.name), cursor: "pointer" }}
          onClick={(e) => { e.stopPropagation(); setCollapsed(v => !v); }}
        >
          {project.name.charAt(0).toUpperCase()}
        </span>
        <div className="gh-project-meta">
          <span className="gh-project-name">{project.name}</span>
        </div>

        {/* IDE 按钮 */}
        {onOpenIde && (
          <button
            className="gh-icon-btn gh-ide-btn"
            title={project.selected_ide ? `Open in IDE (Ctrl+O)\n${project.selected_ide}` : "Open in IDE (Ctrl+O)"}
            onClick={(e) => { e.stopPropagation(); onOpenIde(); }}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
              <path d="M10.604 1h4.146a.25.25 0 0 1 .25.25v4.146a.25.25 0 0 1-.427.177L13.03 4.03 9.28 7.78a.75.75 0 0 1-1.06-1.06l3.75-3.75-1.543-1.543A.25.25 0 0 1 10.604 1ZM3.75 2A1.75 1.75 0 0 0 2 3.75v8.5C2 13.216 2.784 14 3.75 14h8.5A1.75 1.75 0 0 0 14 12.25v-3.5a.75.75 0 0 0-1.5 0v3.5a.25.25 0 0 1-.25.25h-8.5a.25.25 0 0 1-.25-.25v-8.5a.25.25 0 0 1 .25-.25h3.5a.75.75 0 0 0 0-1.5h-3.5Z"/>
            </svg>
          </button>
        )}

        <div className="gh-project-actions" onClick={(e) => e.stopPropagation()}>
          {/* Side Terminal 按钮 */}
          {isActive && onOpenSideTerminal && (
            <button className="gh-icon-btn" title="Open side terminal (Ctrl+Alt+T)"
              onClick={() => onOpenSideTerminal()}>
              {SIDE_TERMINAL_SVG}
            </button>
          )}
          {/* Git 操作下拉菜单 */}
          {gitInfo && onOpenDialog && (
            <div className="gh-git-menu" onClick={(e) => e.stopPropagation()}>
              <button
                className="gh-icon-btn gh-git-menu-btn"
                onClick={(e) => { e.stopPropagation(); setGitMenuOpen(v => !v); }}
                title="Git actions"
              >
                {GIT_SVG}
              </button>
              {gitMenuOpen && (
                <div className="gh-git-dropdown">
                  <div className="gh-git-dropdown-item"
                    onClick={() => { setGitMenuOpen(false); onOpenDialog("new-branch", gitInfo.branches); }}>
                    New Branch
                  </div>
                  <div className="gh-git-dropdown-item"
                    onClick={() => { setGitMenuOpen(false); onOpenDialog("new-worktree", gitInfo.branches); }}>
                    New Worktree
                  </div>
                </div>
              )}
            </div>
          )}
          {hasSession && (
            <button className="gh-icon-btn" title="Close terminal"
              onClick={() => onRemoveProject()}>
              {CLOSE_TERMINAL_SVG}
            </button>
          )}
          <button className="gh-icon-btn gh-icon-btn-danger" title="Remove project"
            onClick={() => onRemoveProject()}>×</button>
        </div>

        {/* Branch badge */}
        {gitInfo && (
          <span className="gh-branch-inline">
            {BRANCH_SVG}
            {gitInfo.current_branch}
          </span>
        )}
      </div>

      {/* Expandable git body */}
      {!collapsed && gitInfo && (
        <ProjectBody
          gitInfo={gitInfo}
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
        />
      )}
    </div>
  );
});
ProjectItemCard.displayName = "ProjectItemCard";

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
  onOpenSideTerminal?: (entryId: string, projectId: string) => void;
  onSelectFile?: (distro: string, projectPath: string, filePath: string) => void;
  onRefreshGit?: (distro: string, projectId: string, projectPath: string) => void;
  onOpenIde?: (distro: string, projectPath: string, ide: string) => void;
  onOpenWorktreeTerminal?: (distro: string, worktreePath: string, branch: string) => void;
  onOpenDialog?: (dialog: { type: string; source: { type: string; distro: string; projectPath: string }; branches: string[] }) => void;
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
  onOpenSideTerminal,
  onSelectFile,
  onRefreshGit,
  onOpenIde,
  onOpenWorktreeTerminal,
  onOpenDialog,
}) => {
  void onCloseProject; // intentionally unused — close handled by terminal session
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="gh-project">
      <div className="gh-project-header">
        <img
          src={getDistroIcon(entry.distro)}
          className="sidebar-distro-icon"
          alt=""
          style={{ cursor: "pointer" }}
          onClick={(e) => { e.stopPropagation(); setCollapsed((v) => !v); }}
        />
        <div className="gh-project-meta">
          <span className="gh-project-name">{entry.distro}</span>
          <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 4 }}>WSL</span>
        </div>
        <div className="gh-project-actions" onClick={(e) => e.stopPropagation()}>
          <button className="gh-icon-btn" title="Add WSL project" onClick={() => onAddProject(entry.id)}>
            <svg width="11" height="11" viewBox="0 0 14 14" fill="none">
              <line x1="7" y1="1" x2="7" y2="13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="1" y1="7" x2="13" y2="7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
          <button className="gh-icon-btn gh-icon-btn-danger" title="Remove distro" onClick={() => onRemoveEntry(entry.id)}>
            <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
              <path d="M11 1.75V3h2.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75ZM4.496 6.675l.66 6.6a.25.25 0 0 0 .249.225h5.19a.25.25 0 0 0 .249-.225l.66-6.6a.75.75 0 0 1 1.492.149l-.66 6.6A1.748 1.748 0 0 1 10.595 15h-5.19a1.75 1.75 0 0 1-1.741-1.575l-.66-6.6a.75.75 0 1 1 1.492-.15ZM6.5 1.75V3h3V1.75a.25.25 0 0 0-.25-.25h-2.5a.25.25 0 0 0-.25.25Z" />
            </svg>
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="gh-project-body" style={{ paddingLeft: 16 }}>
          {entry.projects.length === 0 ? (
            <div className="gh-empty-section" style={{ paddingLeft: 28 }}>No projects</div>
          ) : (
            entry.projects.map((project) => {
              const isActive = activeKey?.distro === entry.distro && activeKey?.projectId === project.id;
              const hasSession = openSessions.has(project.id);
              return (
                <ProjectItemCard
                  key={project.id}
                  project={project}
                  isActive={isActive}
                  hasSession={hasSession}
                  onSelectProject={() => onSelectProject(entry.distro, project)}
                  onSelectFile={(filePath) => onSelectFile?.(entry.distro, project.path, filePath)}
                  onCheckoutBranch={(branch) => {
                    import("@tauri-apps/api/core").then(({ invoke }) =>
                      invoke("wsl_checkout_branch", { distro: entry.distro, projectPath: project.path, branchName: branch })
                        .then(() => onRefreshGit?.(entry.distro, project.id, project.path))
                    );
                  }}
                  onCommitRenameBranch={(oldName, newName) => {
                    import("@tauri-apps/api/core").then(({ invoke }) =>
                      invoke("wsl_rename_branch", { distro: entry.distro, projectPath: project.path, oldName, newName })
                        .then(() => onRefreshGit?.(entry.distro, project.id, project.path))
                        .catch(console.error)
                    );
                  }}
                  onOpenWorktreeTerminal={(worktreePath, branch) => {
                    onOpenWorktreeTerminal?.(entry.distro, worktreePath, branch);
                  }}
                  onCommitRenameWorktree={(oldPath, newName) => {
                    import("@tauri-apps/api/core").then(({ invoke }) =>
                      invoke("wsl_rename_worktree", { distro: entry.distro, projectPath: project.path, worktreePath: oldPath, newName })
                        .then(() => onRefreshGit?.(entry.distro, project.id, project.path))
                        .catch(console.error)
                    );
                  }}
                  onRemoveWorktree={(worktreePath) => {
                    import("@tauri-apps/api/core").then(({ invoke }) =>
                      invoke("wsl_remove_worktree", { distro: entry.distro, projectPath: project.path, worktreePath })
                        .then(() => onRefreshGit?.(entry.distro, project.id, project.path))
                    );
                  }}
                  onOpenSideTerminal={onOpenSideTerminal ? () => onOpenSideTerminal(entry.id, project.id) : undefined}
                  onRemoveProject={() => onRemoveProject(entry.id, project.id)}
                  onOpenIde={onOpenIde ? () => onOpenIde(entry.distro, project.path, project.selected_ide ?? "") : undefined}
                  onOpenDialog={onOpenDialog ? (type, branches) =>
                    onOpenDialog({ type, source: { type: "wsl", distro: entry.distro, projectPath: project.path }, branches })
                  : undefined}
                />
              );
            })
          )}
        </div>
      )}
    </div>
  );
});

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
  onOpenSideTerminal?: (entryId: string, projectId: string) => void;
  onSelectFile?: (entryId: string, projectPath: string, filePath: string) => void;
  onRefreshGit?: (entryId: string, projectId: string, projectPath: string) => void;
  onOpenIde?: (entryId: string, projectPath: string, ide: string) => void;
  onOpenWorktreeTerminal?: (entryId: string, worktreePath: string, branch: string) => void;
  invokeRemoteGit?: (command: string, entryId: string, extra: Record<string, unknown>) => Promise<unknown>;
  onOpenDialog?: (dialog: { type: string; source: { type: string; entryId: string; projectPath: string }; branches: string[] }) => void;
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
  onOpenSideTerminal,
  onSelectFile,
  onRefreshGit,
  onOpenIde,
  onOpenWorktreeTerminal,
  invokeRemoteGit,
  onOpenDialog,
}) => {
  void onCloseProject;
  const [collapsed, setCollapsed] = useState(false);
  const label = `${entry.host}:${entry.port}`;

  return (
    <div className="gh-project">
      <div className="gh-project-header">
        <img
          src={serverIcon}
          className="sidebar-distro-icon"
          alt=""
          style={{ cursor: "pointer" }}
          onClick={(e) => { e.stopPropagation(); setCollapsed((v) => !v); }}
        />
        <div className="gh-project-meta">
          <span className="gh-project-name">{label}</span>
          <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 4 }}>SSH</span>
        </div>
        <div className="gh-project-actions" onClick={(e) => e.stopPropagation()}>
          <button className="gh-icon-btn" title="Add remote project" onClick={() => onAddProject(entry.id)}>
            <svg width="11" height="11" viewBox="0 0 14 14" fill="none">
              <line x1="7" y1="1" x2="7" y2="13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="1" y1="7" x2="13" y2="7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
          <button className="gh-icon-btn gh-icon-btn-danger" title="Remove server" onClick={() => onRemoveEntry(entry.id)}>
            <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
              <path d="M11 1.75V3h2.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75ZM4.496 6.675l.66 6.6a.25.25 0 0 0 .249.225h5.19a.25.25 0 0 0 .249-.225l.66-6.6a.75.75 0 0 1 1.492.149l-.66 6.6A1.748 1.748 0 0 1 10.595 15h-5.19a1.75 1.75 0 0 1-1.741-1.575l-.66-6.6a.75.75 0 1 1 1.492-.15ZM6.5 1.75V3h3V1.75a.25.25 0 0 0-.25-.25h-2.5a.25.25 0 0 0-.25.25Z" />
            </svg>
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="gh-project-body" style={{ paddingLeft: 16 }}>
          {entry.projects.length === 0 ? (
            <div className="gh-empty-section" style={{ paddingLeft: 28 }}>No projects</div>
          ) : (
            entry.projects.map((project) => {
              const isActive = activeKey?.host === entry.host && activeKey?.projectId === project.id;
              const hasSession = openSessions.has(project.id);
              return (
                <ProjectItemCard
                  key={project.id}
                  project={project}
                  isActive={isActive}
                  hasSession={hasSession}
                  onSelectProject={() => onSelectProject(entry.host, project)}
                  onSelectFile={(filePath) => onSelectFile?.(entry.id, project.path, filePath)}
                  onCheckoutBranch={(branch) => {
                    if (invokeRemoteGit) {
                      invokeRemoteGit("remote_checkout_branch", entry.id, { projectPath: project.path, branchName: branch })
                        .then(() => onRefreshGit?.(entry.id, project.id, project.path));
                    }
                  }}
                  onCommitRenameBranch={(oldName, newName) => {
                    if (invokeRemoteGit) {
                      invokeRemoteGit("remote_rename_branch", entry.id, { projectPath: project.path, oldName, newName })
                        .then(() => onRefreshGit?.(entry.id, project.id, project.path))
                        .catch(console.error);
                    }
                  }}
                  onOpenWorktreeTerminal={(worktreePath, branch) => {
                    onOpenWorktreeTerminal?.(entry.id, worktreePath, branch);
                  }}
                  onCommitRenameWorktree={(oldPath, newName) => {
                    if (invokeRemoteGit) {
                      invokeRemoteGit("remote_rename_worktree", entry.id, { projectPath: project.path, worktreePath: oldPath, newName })
                        .then(() => onRefreshGit?.(entry.id, project.id, project.path))
                        .catch(console.error);
                    }
                  }}
                  onRemoveWorktree={(worktreePath) => {
                    if (invokeRemoteGit) {
                      invokeRemoteGit("remote_remove_worktree", entry.id, { projectPath: project.path, worktreePath })
                        .then(() => onRefreshGit?.(entry.id, project.id, project.path));
                    }
                  }}
                  onOpenSideTerminal={onOpenSideTerminal ? () => onOpenSideTerminal(entry.id, project.id) : undefined}
                  onRemoveProject={() => onRemoveProject(entry.id, project.id)}
                  onOpenIde={onOpenIde ? () => onOpenIde(entry.id, project.path, project.selected_ide ?? "") : undefined}
                  onOpenDialog={onOpenDialog ? (type, branches) =>
                    onOpenDialog({ type, source: { type: "remote", entryId: entry.id, projectPath: project.path }, branches })
                  : undefined}
                />
              );
            })
          )}
        </div>
      )}
    </div>
  );
});
