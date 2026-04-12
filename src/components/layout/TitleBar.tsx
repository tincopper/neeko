import { invoke } from "@tauri-apps/api/core";
import React, { useEffect, useState, useCallback } from "react";
import AgentIcon from "./AgentIcon";
import TerminalTabBar from "./TerminalTabBar";
import WindowControls from "./WindowControls";
import type { Project, WSLProject, RemoteEntrySession, RemoteProject, AgentConfig, TerminalTab } from "../../types";
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
  // Tab state
  tabs: TerminalTab[];
  activeTabId: string | null;
  onActivateTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onAddTab: () => void;
  // Agent bar actions
  onAgentClick: (agent: AgentConfig) => void;
  // Original props
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
    const agentIds = agents.map((a) => a.id);
    invoke<Record<string, boolean>>("check_agents_installed", { agentIds })
      .then((result) => {
        setInstalledMap(new Map(Object.entries(result)));
      })
      .catch((err) => {
        console.error("[TitleBar] Failed to check agents installed:", err);
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

  const currentAgentId = (() => {
    const activeTab = tabs.find((t) => t.id === activeTabId);
    if (activeTab) return activeTab.agentId;
    if (activeProject) return activeProject.selected_agent;
    if (activeWslProject) return activeWslProject.project.selected_agent;
    if (activeRemoteProject) return activeRemoteProject.project.selected_agent;
    return null;
  })();

  const currentProjectName = (() => {
    if (activeProject) return activeProject.name;
    if (activeWslProject) return activeWslProject.project.name;
    if (activeRemoteProject) return activeRemoteProject.project.name;
    return null;
  })();

  const currentBranch = (() => {
    if (activeProject?.git_info) return activeWorktreeBranch || activeProject.git_info.current_branch;
    if (activeWslProject?.project.git_info) return activeWslWorktreeBranch || activeWslProject.project.git_info.current_branch;
    if (activeRemoteProject?.project.git_info) return activeRemoteWorktreeBranch || activeRemoteProject.project.git_info.current_branch;
    return null;
  })();

  const enabledAgents = agents.filter((a) => a.enabled);

  const projectId = (() => {
    if (activeProject) return activeProject.id;
    if (activeWslProject) return activeWslProject.project.id;
    if (activeRemoteProject) return activeRemoteProject.project.id;
    return null;
  })();

  const showAgentBarContent = showAgentBar && projectId && enabledAgents.length > 0;

  return (
    <div className="titlebar" data-tauri-drag-region>
      {/* Left Sidebar: App name + Settings + Add */}
      <div className="titlebar-sidebar" data-tauri-drag-region>
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

      {/* Right Main Content: Tabs + Agents combined */}
      <div className="titlebar-main" data-tauri-drag-region>
        {/* Tabs Row */}
        <div className="titlebar-tabs-row" data-tauri-drag-region>
          <div className="titlebar-tabs-area" data-tauri-drag-region>
            {projectId ? (
              <TerminalTabBar
                tabs={tabs}
                activeTabId={activeTabId}
                onActivateTab={onActivateTab}
                onCloseTab={onCloseTab}
                onAddTab={onAddTab}
              />
            ) : (
              <div className="titlebar-placeholder" data-tauri-drag-region />
            )}
          </div>

          {/* Project info + branch + window controls */}
          <div className="titlebar-meta" data-tauri-drag-region>
            {currentProjectName && (
              <span className="titlebar-project-name" data-tauri-drag-region>
                {currentProjectName}
              </span>
            )}
            {currentBranch && (
              <span className="titlebar-branch" data-tauri-drag-region>
                {currentBranch}
              </span>
            )}
            {!IS_MACOS && <WindowControls />}
          </div>
        </div>

        {/* Agents Row - aligned with tabs */}
        {showAgentBarContent && (
          <div className="titlebar-agents-row" data-tauri-drag-region>
            <div className="titlebar-agent-bar">
              {enabledAgents.map((agent) => {
                const installed = installedMap.size === 0 || (installedMap.get(agent.id) ?? true);
                const isSelected = currentAgentId === agent.id;
                const isDisabled = !agent.enabled || !installed;
                return (
                  <button
                    key={agent.id}
                    className={`agent-bar-btn ${isSelected ? "selected" : ""} ${!installed ? "not-installed" : ""} ${compactMode ? "compact" : ""}`}
                    onClick={() => handleAgentClick(agent)}
                    disabled={isDisabled}
                    title={agent.name}
                  >
                    <AgentIcon icon={agent.icon} />
                    {!compactMode && <span className="agent-bar-btn-name">{agent.name}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default React.memo(TitleBar);
