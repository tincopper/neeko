import { invoke } from "@tauri-apps/api/core";
import React, { useEffect, useState, useCallback } from "react";
import AgentIcon from "./AgentIcon";
import TerminalTabBar from "./TerminalTabBar";
import WindowControls from "./WindowControls";
import type {
   Project,
   WSLProject,
   RemoteEntrySession,
   RemoteProject,
   AgentConfig,
   TerminalTab,
} from "../../types";
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
   agents: AgentConfig[];
   compactMode: boolean;
   showAgentBar: boolean;
   tabs: TerminalTab[];
   activeTabId: string | null;
   onActivateTab: (tabId: string) => void;
   onCloseTab: (tabId: string) => void;
   onAddTab: () => void;
   onAgentClick: (agent: AgentConfig) => void;
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
   agents,
   compactMode,
   showAgentBar,
   tabs,
   activeTabId,
   onActivateTab,
   onCloseTab,
   onAddTab,
   onAgentClick,
   onOpenSettings,
   onToggleAddMenu,
   onAddProject,
   onAddWsl,
   onAddRemote,
   showToast,
}: TitleBarProps) {
   const [installedMap, setInstalledMap] = useState<Map<string, boolean>>(new Map());

   useEffect(() => {
      if (agents.length === 0) return;
      const agentIds = agents.map((agent) => agent.id);
      invoke<Record<string, boolean>>("check_agents_installed", { agentIds })
         .then((result) => {
            setInstalledMap(new Map(Object.entries(result)));
         })
         .catch((error) => {
            console.error("[TitleBar] Failed to check agents installed:", error);
         });
   }, [agents]);

   const handleAgentClick = useCallback(
      (agent: AgentConfig) => {
         const installed = installedMap.size === 0 || (installedMap.get(agent.id) ?? true);
         if (!installed) {
            showToast(`${agent.name} (${agent.command}) is not installed`, "error");
            return;
         }
         if (!agent.enabled) return;
         onAgentClick(agent);
      },
      [installedMap, onAgentClick, showToast]
   );

   const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
   const currentAgentId =
      activeTab?.agentId ??
      activeProject?.selected_agent ??
      activeWslProject?.project.selected_agent ??
      activeRemoteProject?.project.selected_agent ??
      null;

   const currentProjectName =
      activeProject?.name ??
      activeWslProject?.project.name ??
      activeRemoteProject?.project.name ??
      null;

   const currentBranch =
      activeProject?.git_info
         ? activeWorktreeBranch || activeProject.git_info.current_branch
         : activeWslProject?.project.git_info
            ? activeWslWorktreeBranch || activeWslProject.project.git_info.current_branch
            : activeRemoteProject?.project.git_info
               ? activeRemoteWorktreeBranch || activeRemoteProject.project.git_info.current_branch
               : null;

   const enabledAgents = agents.filter((agent) => agent.enabled);
   const hasActiveProject = !!(activeProject || activeWslProject || activeRemoteProject);
   const showAgentBarContent = showAgentBar && hasActiveProject && enabledAgents.length > 0;

   return (
      <div
         className="titlebar flex items-stretch shrink-0 border-b border-border bg-bg-secondary select-none"
         data-tauri-drag-region
      >
         <div className="relative w-[220px] shrink-0 border-r border-border/70 px-2 py-1 flex items-center gap-1" data-tauri-drag-region>
            <span className="titlebar-appname text-xs font-semibold tracking-wide text-text-primary px-2" data-tauri-drag-region>
               NEEKO
            </span>
            <button className="tb-icon-btn w-7 h-7 rounded-md text-text-secondary hover:bg-bg-hover hover:text-text-primary" onClick={onOpenSettings} title="Settings">
               <SettingsIcon size={14} />
            </button>
            <button className="tb-icon-btn w-7 h-7 rounded-md text-text-secondary hover:bg-bg-hover hover:text-text-primary disabled:opacity-50" onClick={onToggleAddMenu} disabled={loading} title="Add">
               {loading ? "…" : <PlusIcon size={14} />}
            </button>

            {showAddMenu && (
               <div className="add-menu-dropdown absolute left-2 top-9 z-50 w-48 rounded-md border border-border bg-bg-tertiary shadow-lg overflow-hidden">
                  <div className="add-menu-item px-3 py-2 text-sm text-text-primary hover:bg-bg-hover cursor-pointer" onClick={onAddProject}>
                     <span className="mr-2">📁</span>
                     <span>Add Local Project</span>
                  </div>
                  {IS_WINDOWS && (
                     <div className="add-menu-item px-3 py-2 text-sm text-text-primary hover:bg-bg-hover cursor-pointer flex items-center" onClick={onAddWsl}>
                        <img src={linuxIcon} className="w-3.5 h-3.5 mr-2" alt="" />
                        <span>Add WSL Distro</span>
                     </div>
                  )}
                  <div className="add-menu-item px-3 py-2 text-sm text-text-primary hover:bg-bg-hover cursor-pointer flex items-center" onClick={onAddRemote}>
                     <img src={serverIcon} className="w-3.5 h-3.5 mr-2" alt="" />
                     <span>Add Remote Server</span>
                  </div>
               </div>
            )}
         </div>

         <div className="flex-1 min-w-0 flex flex-col" data-tauri-drag-region>
            <div className="h-8 flex items-center px-2 gap-2" data-tauri-drag-region>
               <div className="flex-1 min-w-0" data-tauri-drag-region>
                  {hasActiveProject ? (
                     <TerminalTabBar
                        tabs={tabs}
                        activeTabId={activeTabId}
                        onActivateTab={onActivateTab}
                        onCloseTab={onCloseTab}
                        onAddTab={onAddTab}
                     />
                  ) : null}
               </div>

               <div className="flex items-center gap-2 shrink-0" data-tauri-drag-region>
                  {currentProjectName && <span className="text-xs font-medium text-text-primary max-w-[220px] truncate">{currentProjectName}</span>}
                  {currentBranch && <span className="text-[11px] px-2 py-0.5 rounded-full bg-bg-tertiary text-accent-green">{currentBranch}</span>}
                  {!IS_MACOS && <WindowControls />}
               </div>
            </div>

            {showAgentBarContent && (
               <div className="h-8 px-2 pb-1 flex items-center gap-1 overflow-x-auto" data-tauri-drag-region>
                  {enabledAgents.map((agent) => {
                     const installed = installedMap.size === 0 || (installedMap.get(agent.id) ?? true);
                     const selected = currentAgentId === agent.id;
                     return (
                        <button
                           key={agent.id}
                           className={`tb-icon-btn flex items-center gap-1.5 px-2 h-6 rounded-md border text-xs ${selected ? "border-accent-blue text-accent-blue bg-accent-blue/10" : "border-border text-text-secondary hover:text-text-primary hover:bg-bg-hover"} ${!installed ? "opacity-50" : ""}`}
                           onClick={() => handleAgentClick(agent)}
                           disabled={!installed}
                           title={agent.name}
                        >
                           <AgentIcon icon={agent.icon} />
                           {!compactMode && <span>{agent.name}</span>}
                        </button>
                     );
                  })}
               </div>
            )}
         </div>
      </div>
   );
}

export default React.memo(TitleBar);
