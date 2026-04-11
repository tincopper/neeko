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
    <div className="titlebar" data-tauri-drag-region>
      {/* Left: NEEKO + Settings + Add */}
      <div className="titlebar-left" data-tauri-drag-region>
        <span className="titlebar-appname" data-tauri-drag-region>NEEKO</span>
        <button className="tb-icon-btn" onClick={onOpenSettings} title="Settings">
          <SettingsIcon size={14} />
        </button>
        <button className="tb-icon-btn" onClick={onToggleAddMenu} disabled={loading} title="Add">
          {loading ? "\u2026" : <PlusIcon size={14} />}
        </button>
        {showAddMenu && (
          <div className="add-menu-dropdown">
            <div className="add-menu-item" onClick={onAddProject}>
              <span className="add-menu-icon">📁</span>
              <span>Add Local Project</span>
            </div>
            {IS_WINDOWS && (
              <div className="add-menu-item" onClick={onAddWsl}>
                <img src={linuxIcon} className="add-menu-icon-img" alt="" />
                <span>Add WSL Distro</span>
              </div>
            )}
            <div className="add-menu-item" onClick={onAddRemote}>
              <img src={serverIcon} className="add-menu-icon-img" alt="" />
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
              onShowToast={showToast}
              onSelectAgent={(agent) => {
                onSelectLocalAgent(agent);
                invoke("save_session").catch(() => {});
              }}
            />
          </>
        ) : activeWslProject ? (
          <>
            <span className="titlebar-project-name" data-tauri-drag-region>{activeWslProject.project.name}</span>
            {activeWslProject.project.git_info ? (
              <span className="titlebar-branch" data-tauri-drag-region>
                {activeWslWorktreeBranch || activeWslProject.project.git_info.current_branch}
              </span>
            ) : (
              <span className="titlebar-branch" data-tauri-drag-region style={{ opacity: 0.5 }}>
                WSL: {activeWslProject.distro}
              </span>
            )}
            <AgentSelector
              projectId={activeWslProject.project.id}
              currentAgentId={activeWslProject.project.selected_agent}
              skipBackendPersist
              onShowToast={showToast}
              onSelectAgent={(agent) => onSelectWslAgent(agent)}
            />
          </>
        ) : activeRemoteProject ? (
          <>
            <span className="titlebar-project-name" data-tauri-drag-region>{activeRemoteProject.project.name}</span>
            {activeRemoteProject.project.git_info ? (
              <span className="titlebar-branch" data-tauri-drag-region>
                {activeRemoteWorktreeBranch || activeRemoteProject.project.git_info.current_branch}
              </span>
            ) : (
              <span className="titlebar-branch" data-tauri-drag-region style={{ opacity: 0.5 }}>
                SSH: {activeRemoteProject.entry.host}
              </span>
            )}
            <AgentSelector
              projectId={activeRemoteProject.project.id}
              currentAgentId={activeRemoteProject.project.selected_agent}
              skipBackendPersist
              onShowToast={showToast}
              onSelectAgent={(agent) => onSelectRemoteAgent(agent)}
            />
          </>
        ) : (
          <span className="titlebar-placeholder" data-tauri-drag-region />
        )}
        {!IS_MACOS && <WindowControls />}
      </div>
    </div>
  );
}

export default React.memo(TitleBar);
