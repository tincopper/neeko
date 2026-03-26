import { invoke } from "@tauri-apps/api/core";
import AgentSelector from "./AgentSelector";
import WindowControls from "./WindowControls";
import { WSLProject, RemoteEntrySession, RemoteProject } from "../types";

interface Project {
  id: string;
  name: string;
  path: string;
  git_info: { current_branch: string; branches: string[]; worktrees: any[]; changed_files: any[]; is_clean: boolean } | null;
  selected_agent: string | null;
}

interface AgentConfig {
  id: string;
  name: string;
  command: string;
  args: string[];
  icon: string | null;
  enabled: boolean;
}

interface TitleBarProps {
  activeProject: Project | null;
  activeWslProject: { distro: string; project: WSLProject } | null;
  activeRemoteProject: { entry: RemoteEntrySession; project: RemoteProject } | null;
  activeWorktreeBranch: string;
  showAddMenu: boolean;
  loading: boolean;
  onOpenSettings: () => void;
  onToggleAddMenu: () => void;
  onAddProject: () => void;
  onAddWsl: () => void;
  onAddRemote: () => void;
  onSelectLocalAgent: (agent: AgentConfig | null) => void;
  onSelectWslAgent: (agent: AgentConfig | null) => void;
  onSelectRemoteAgent: (agent: AgentConfig | null) => void;
}


export default function TitleBar({
  activeProject,
  activeWslProject,
  activeRemoteProject,
  activeWorktreeBranch,
  showAddMenu,
  loading,
  onOpenSettings,
  onToggleAddMenu,
  onAddProject,
  onAddWsl,
  onAddRemote,
  onSelectLocalAgent,
  onSelectWslAgent,
  onSelectRemoteAgent,
}: TitleBarProps) {
  return (
    <div className="titlebar" data-tauri-drag-region>
      {/* Left: NEEKO + Settings + Add */}
      <div className="titlebar-left" data-tauri-drag-region>
        <span className="titlebar-appname" data-tauri-drag-region>NEEKO</span>
        <button className="tb-icon-btn" onClick={onOpenSettings} title="Settings">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.4" />
            <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
        <button className="tb-icon-btn" onClick={onToggleAddMenu} disabled={loading} title="Add">
          {loading ? "\u2026" : (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <line x1="7" y1="1" x2="7" y2="13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="1" y1="7" x2="13" y2="7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          )}
        </button>
        {showAddMenu && (
          <div className="add-menu-dropdown">
            <div className="add-menu-item" onClick={onAddProject}>
              <span className="add-menu-icon">{"\u{1F4C1}"}</span>
              <span>Add Local Project</span>
            </div>
            <div className="add-menu-item" onClick={onAddWsl}>
              <span className="add-menu-icon">{"\u{1F427}"}</span>
              <span>Add WSL Distro</span>
            </div>
            <div className="add-menu-item" onClick={onAddRemote}>
              <span className="add-menu-icon">{"\u{1F5A5}"}</span>
              <span>Add Remote Server</span>
            </div>
          </div>
        )}
      </div>

      <div className="titlebar-divider" data-tauri-drag-region />

      {/* Right: project name + branch + agent + window controls */}
      <div className="titlebar-right" data-tauri-drag-region>
        {activeProject ? (
          <>
            <span className="titlebar-project-name" data-tauri-drag-region>{activeProject.name}</span>
            {activeProject.git_info && (
              <span className="titlebar-branch" data-tauri-drag-region>
                {activeWorktreeBranch || activeProject.git_info.current_branch}
              </span>
            )}
            <AgentSelector
              projectId={activeProject.id}
              currentAgentId={activeProject.selected_agent}
              onSelectAgent={(agent) => {
                if (agent) onSelectLocalAgent(agent);
                invoke("save_session").catch(() => {});
              }}
            />
          </>
        ) : activeWslProject ? (
          <>
            <span className="titlebar-project-name" data-tauri-drag-region>{activeWslProject.project.name}</span>
            <span className="titlebar-branch" data-tauri-drag-region>WSL: {activeWslProject.distro}</span>
            <AgentSelector
              projectId={activeWslProject.project.id}
              currentAgentId={activeWslProject.project.selected_agent}
              skipBackendPersist
              onSelectAgent={(agent) => onSelectWslAgent(agent)}
            />
          </>
        ) : activeRemoteProject ? (
          <>
            <span className="titlebar-project-name" data-tauri-drag-region>{activeRemoteProject.project.name}</span>
            <span className="titlebar-branch" data-tauri-drag-region>SSH: {activeRemoteProject.entry.host}</span>
            <AgentSelector
              projectId={activeRemoteProject.project.id}
              currentAgentId={activeRemoteProject.project.selected_agent}
              skipBackendPersist
              onSelectAgent={(agent) => onSelectRemoteAgent(agent)}
            />
          </>
        ) : (
          <span className="titlebar-placeholder" data-tauri-drag-region />
        )}
        <WindowControls />
      </div>
    </div>
  );
}
