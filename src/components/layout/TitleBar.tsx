import { invoke } from "@tauri-apps/api/core";
import React from "react";
import AgentSelector from "./AgentSelector";
import WindowControls from "./WindowControls";
import type { Project, WSLProject, RemoteEntrySession, RemoteProject, AgentConfig } from "../../types";
import { IS_WINDOWS, IS_MACOS } from "../../utils/platform";
import linuxIcon from "../../assets/linux.svg";
import serverIcon from "../../assets/server.svg";
import { PlusIcon } from "../icons";
import neekoIcon from "../../assets/neeko-icon.png";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "../ui";

interface TitleBarProps {
  activeProject: Project | null;
  activeWslProject: { distro: string; project: WSLProject } | null;
  activeRemoteProject: { entry: RemoteEntrySession; project: RemoteProject } | null;
  activeWorktreeBranch: string;
  activeWslWorktreeBranch: string;
  activeRemoteWorktreeBranch: string;
  loading: boolean;
  installedMap: Record<string, boolean>;
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
  loading,
  installedMap,
  onAddProject,
  onAddWsl,
  onAddRemote,
  onSelectLocalAgent,
  onSelectWslAgent,
  onSelectRemoteAgent,
  showToast,
}: TitleBarProps) {
  return (
    <div className="titlebar flex items-stretch h-12 shrink-0 select-none" style={{ background: "linear-gradient(to right, var(--bg-secondary), var(--titlebar-gradient-start) 48px, var(--bg-secondary) 38%)" }} data-tauri-drag-region>
      {/* Left: Neeko icon */}
      <div className="flex items-center shrink-0 pl-3 pr-1" data-tauri-drag-region>
        <img src={neekoIcon} className="w-6 h-6 shrink-0" data-tauri-drag-region alt="Neeko" />
      </div>

      {/* Center: drag region + Add button on right */}
      <div className="flex items-center shrink-0" style={{ width: "calc(var(--panel-width) - 48px)" }} data-tauri-drag-region>
        <div className="flex-1 min-w-0" data-tauri-drag-region />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="tb-icon-btn w-10 h-12 border-none outline-none bg-transparent text-text-secondary cursor-pointer flex items-center justify-center transition-colors duration-150 shrink-0 hover:not-disabled:bg-bg-hover hover:not-disabled:text-text-primary disabled:opacity-50 disabled:cursor-not-allowed" disabled={loading} title="Add">
              {loading ? "\u2026" : <PlusIcon size={18} />}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="bottom" align="start">
            <DropdownMenuItem onClick={onAddProject}>
              <span className="text-sm">📁</span>
              <span>Add Local Project</span>
            </DropdownMenuItem>
            {IS_WINDOWS && (
              <DropdownMenuItem onClick={onAddWsl}>
                <img src={linuxIcon} className="w-3.5 h-3.5 fill-current stroke-current text-text-secondary shrink-0" alt="" />
                <span>Add WSL Distro</span>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={onAddRemote}>
              <img src={serverIcon} className="w-3.5 h-3.5 fill-current stroke-current text-text-secondary shrink-0" alt="" />
              <span>Add Remote Server</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Right: project info */}
      <div className="flex items-center shrink-0 gap-2 pl-4">
        {activeProject ? (
          <>
            <span className="text-[0.93em] font-semibold text-text-primary max-w-[180px] truncate" data-tauri-drag-region>{activeProject.name}</span>
            {activeProject.git_info && (
              <span className="text-[0.79em] text-accent-green bg-bg-tertiary py-0.5 px-2 rounded-full whitespace-nowrap shrink-0" data-tauri-drag-region>
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
            <span className="text-[0.93em] font-semibold text-text-primary max-w-[180px] truncate" data-tauri-drag-region>{activeWslProject.project.name}</span>
            {activeWslProject.project.git_info ? (
              <span className="text-[0.79em] text-accent-green bg-bg-tertiary py-0.5 px-2 rounded-full whitespace-nowrap shrink-0" data-tauri-drag-region>
                {activeWslWorktreeBranch || activeWslProject.project.git_info.current_branch}
              </span>
            ) : (
              <span className="text-[0.79em] text-accent-green bg-bg-tertiary py-0.5 px-2 rounded-full whitespace-nowrap shrink-0 opacity-50" data-tauri-drag-region>
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
            <span className="text-[0.93em] font-semibold text-text-primary max-w-[180px] truncate" data-tauri-drag-region>{activeRemoteProject.project.name}</span>
            {activeRemoteProject.project.git_info ? (
              <span className="text-[0.79em] text-accent-green bg-bg-tertiary py-0.5 px-2 rounded-full whitespace-nowrap shrink-0" data-tauri-drag-region>
                {activeRemoteWorktreeBranch || activeRemoteProject.project.git_info.current_branch}
              </span>
            ) : (
              <span className="text-[0.79em] text-accent-green bg-bg-tertiary py-0.5 px-2 rounded-full whitespace-nowrap shrink-0 opacity-50" data-tauri-drag-region>
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
        ) : null}
      </div>

      {/* Center: remaining drag region */}
      <div className="flex-1 min-w-0" data-tauri-drag-region />

      {/* Far right: window controls */}
      {!IS_MACOS && <WindowControls />}
    </div>
  );
}

export default React.memo(TitleBar);
