import { invoke } from "@tauri-apps/api/core";
import React from "react";
import AgentSelector from "./AgentSelector";
import WindowControls from "./WindowControls";
import type { Project, WSLProject, RemoteEntrySession, RemoteProject, AgentConfig } from "../../types";
import { IS_WINDOWS, IS_MACOS } from "../../utils/platform";
import linuxIcon from "../../assets/linux.svg";
import serverIcon from "../../assets/server.svg";
import { SettingsIcon, PlusIcon } from "../icons";

interface TitleBarProps {
  activeProject: Project | null;
  activeWslProject: { distro: string; project: WSLProject } | null;
  activeRemoteProject: { entry: RemoteEntrySession; project: RemoteProject } | null;
  activeWorktreeBranch: string;
  activeWslWorktreeBranch: string;
  activeRemoteWorktreeBranch: string;
  showAddMenu: boolean;
  loading: boolean;
  installedMap: Record<string, boolean>;
  onOpenSettings: () => void;
  onToggleAddMenu: () => void;
  onAddProject: () => void;
  onAddWsl: () => void;
  onAddRemote: () => void;
  onSelectLocalAgent: (agent: AgentConfig | null) => void;
  onSelectWslAgent: (agent: AgentConfig | null) => void;
  onSelectRemoteAgent: (agent: AgentConfig | null) => void;
  showToast: (message: string, type?: "info" | "error") => void;
}


function TitleBar({
  activeProject,
  activeWslProject,
  activeRemoteProject,
  activeWorktreeBranch,
  activeWslWorktreeBranch,
  activeRemoteWorktreeBranch,
  showAddMenu,
  loading,
  installedMap,
  onOpenSettings,
  onToggleAddMenu,
  onAddProject,
  onAddWsl,
  onAddRemote,
  onSelectLocalAgent,
  onSelectWslAgent,
  onSelectRemoteAgent,
  showToast,
}: TitleBarProps) {
  return (
    <div className="titlebar flex items-stretch h-10 shrink-0 bg-bg-secondary border-b border-border select-none" data-tauri-drag-region>
      {/* Left: NEEKO + Settings + Add */}
      <div className="titlebar-left flex items-center shrink-0 pl-4 gap-0.5 relative w-[var(--sidebar-width)] min-w-[var(--sidebar-width)]" data-tauri-drag-region>
        <span className="titlebar-appname text-[0.79em] font-bold uppercase tracking-wide text-text-secondary flex-1" data-tauri-drag-region>NEEKO</span>
        <button className="tb-icon-btn w-8 h-10 border-none bg-transparent text-text-secondary cursor-pointer flex items-center justify-center transition-colors duration-150 shrink-0 hover:not-disabled:bg-bg-hover hover:not-disabled:text-text-primary disabled:opacity-50 disabled:cursor-not-allowed" onClick={onOpenSettings} title="Settings">
          <SettingsIcon size={14} />
        </button>
        <button className="tb-icon-btn w-8 h-10 border-none bg-transparent text-text-secondary cursor-pointer flex items-center justify-center transition-colors duration-150 shrink-0 hover:not-disabled:bg-bg-hover hover:not-disabled:text-text-primary disabled:opacity-50 disabled:cursor-not-allowed" onClick={onToggleAddMenu} disabled={loading} title="Add">
          {loading ? "\u2026" : <PlusIcon size={14} />}
        </button>
        {showAddMenu && (
          <div className="add-menu-dropdown absolute top-8 right-0 bg-bg-tertiary border border-border rounded-md shadow-lg z-[100] min-w-[180px] overflow-hidden">
            <div className="add-menu-item flex items-center gap-2.5 p-2.5 px-3.5 cursor-pointer text-text-primary text-[13px] transition-colors duration-150 hover:bg-bg-hover" onClick={onAddProject}>
              <span className="add-menu-icon text-sm">📁</span>
              <span>Add Local Project</span>
            </div>
            {IS_WINDOWS && (
              <div className="add-menu-item flex items-center gap-2.5 p-2.5 px-3.5 cursor-pointer text-text-primary text-[13px] transition-colors duration-150 hover:bg-bg-hover" onClick={onAddWsl}>
                <img src={linuxIcon} className="add-menu-icon-img w-3.5 h-3.5 fill-current stroke-current text-text-secondary shrink-0" alt="" />
                <span>Add WSL Distro</span>
              </div>
            )}
            <div className="add-menu-item flex items-center gap-2.5 p-2.5 px-3.5 cursor-pointer text-text-primary text-[13px] transition-colors duration-150 hover:bg-bg-hover" onClick={onAddRemote}>
              <img src={serverIcon} className="add-menu-icon-img w-3.5 h-3.5 fill-current stroke-current text-text-secondary shrink-0" alt="" />
              <span>Add Remote Server</span>
            </div>
          </div>
        )}
      </div>

      <div className="titlebar-divider w-px bg-border shrink-0 self-stretch" data-tauri-drag-region />

      {/* Right: project name + branch + agent + window controls */}
      <div className="titlebar-right flex items-center flex-1 min-w-0 pl-4 gap-2" data-tauri-drag-region>
        {activeProject ? (
          <>
            <span className="titlebar-project-name text-[0.93em] font-semibold text-text-primary truncate" data-tauri-drag-region>{activeProject.name}</span>
            {activeProject.git_info && (
              <span className="titlebar-branch text-[0.79em] text-accent-green bg-bg-tertiary py-0.5 px-2 rounded-full whitespace-nowrap shrink-0" data-tauri-drag-region>
                {activeWorktreeBranch || activeProject.git_info.current_branch}
              </span>
            )}
            <AgentSelector
              projectId={activeProject.id}
              currentAgentId={activeProject.selected_agent}
              installedMap={installedMap}
              onShowToast={showToast}
              onSelectAgent={(agent) => {
                onSelectLocalAgent(agent);
                invoke("save_session").catch(() => {});
              }}
            />
          </>
        ) : activeWslProject ? (
          <>
            <span className="titlebar-project-name text-[0.93em] font-semibold text-text-primary truncate" data-tauri-drag-region>{activeWslProject.project.name}</span>
            {activeWslProject.project.git_info ? (
              <span className="titlebar-branch text-[0.79em] text-accent-green bg-bg-tertiary py-0.5 px-2 rounded-full whitespace-nowrap shrink-0" data-tauri-drag-region>
                {activeWslWorktreeBranch || activeWslProject.project.git_info.current_branch}
              </span>
            ) : (
              <span className="titlebar-branch text-[0.79em] text-accent-green bg-bg-tertiary py-0.5 px-2 rounded-full whitespace-nowrap shrink-0 opacity-50" data-tauri-drag-region>
                WSL: {activeWslProject.distro}
              </span>
            )}
            <AgentSelector
              projectId={activeWslProject.project.id}
              currentAgentId={activeWslProject.project.selected_agent}
              skipBackendPersist
              installedMap={installedMap}
              onShowToast={showToast}
              onSelectAgent={(agent) => onSelectWslAgent(agent)}
            />
          </>
        ) : activeRemoteProject ? (
          <>
            <span className="titlebar-project-name text-[0.93em] font-semibold text-text-primary truncate" data-tauri-drag-region>{activeRemoteProject.project.name}</span>
            {activeRemoteProject.project.git_info ? (
              <span className="titlebar-branch text-[0.79em] text-accent-green bg-bg-tertiary py-0.5 px-2 rounded-full whitespace-nowrap shrink-0" data-tauri-drag-region>
                {activeRemoteWorktreeBranch || activeRemoteProject.project.git_info.current_branch}
              </span>
            ) : (
              <span className="titlebar-branch text-[0.79em] text-accent-green bg-bg-tertiary py-0.5 px-2 rounded-full whitespace-nowrap shrink-0 opacity-50" data-tauri-drag-region>
                SSH: {activeRemoteProject.entry.host}
              </span>
            )}
            <AgentSelector
              projectId={activeRemoteProject.project.id}
              currentAgentId={activeRemoteProject.project.selected_agent}
              skipBackendPersist
              installedMap={installedMap}
              onShowToast={showToast}
              onSelectAgent={(agent) => onSelectRemoteAgent(agent)}
            />
          </>
        ) : (
          <span className="titlebar-placeholder flex-1" data-tauri-drag-region />
        )}
        {!IS_MACOS && <WindowControls />}
      </div>
    </div>
  );
}

export default React.memo(TitleBar);
