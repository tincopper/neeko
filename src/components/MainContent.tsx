import React, { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { TerminalView, WorktreeTerminalView, WSLTerminalView } from "./terminal";
import DiffView from "./DiffView";
import RemoteProjectView from "./RemoteProjectView";
import TerminalTabBar from "./layout/TerminalTabBar";
import AgentIcon from "./layout/AgentIcon";
import type {
   Project,
   WSLProject,
   RemoteProject,
   RemoteEntrySession,
   AuthMethod,
   AgentConfig,
   TerminalTab,
} from "../types";
import { useAppContext } from "../context/app-context";

interface MainContentProps {
   activeProject: Project | null;
   activeWorktreePath: string | null;
   activeWorktreeBranch: string;
   handleSelectProject: (projectId: string) => void;
   handleAddProject: () => void;
   suppressResizeRef?: React.MutableRefObject<boolean>;

   tabs: TerminalTab[];
   activeTabId: string | null;
   onActivateTab: (tabId: string) => void;
   onCloseTab: (tabId: string) => void;
   onAddTab: () => void;
   onTabStatusChange?: (tabId: string, status: "Idle" | "Running" | "Failed") => void;

   agents: AgentConfig[];
   compactMode: boolean;
   showAgentBar: boolean;
   onAgentClick: (agent: AgentConfig) => void;
   showToast: (message: string, type?: "info" | "error") => void;

   activeWslProject: { distro: string; project: WSLProject } | null;
   activeWslWorktreePath: string | null;
   setWslOpenSessions: (updater: (prev: Set<string>) => Set<string>) => void;

   activeRemoteProject: { entry: RemoteEntrySession; project: RemoteProject } | null;
   activeRemoteWorktreePath: string | null;
   remoteAuthStore: Map<string, AuthMethod>;
   setRemoteOpenSessions: (updater: (prev: Set<string>) => Set<string>) => void;

   wslDiffState: { distro: string; projectPath: string; filePath: string } | null;
   remoteDiffState: {
      entryId: string;
      host: string;
      port: number;
      username: string;
      auth: AuthMethod;
      projectPath: string;
      filePath: string;
   } | null;
   worktreeDiffState: { worktreePath: string; filePath: string } | null;

   onWslDiffBack: () => void;
   onRemoteDiffBack: () => void;
   onWorktreeDiffBack: () => void;
}

function MainContent({
   activeProject,
   activeWorktreePath,
   activeWorktreeBranch,
   handleSelectProject,
   handleAddProject,
   suppressResizeRef,
   tabs,
   activeTabId,
   onActivateTab,
   onCloseTab,
   onAddTab,
   onTabStatusChange,
   agents,
   compactMode,
   showAgentBar,
   onAgentClick,
   showToast,
   activeWslProject,
   activeWslWorktreePath,
   setWslOpenSessions,
   activeRemoteProject,
   activeRemoteWorktreePath,
   remoteAuthStore,
   setRemoteOpenSessions,
   wslDiffState,
   remoteDiffState,
   worktreeDiffState,
   onWslDiffBack,
   onRemoteDiffBack,
   onWorktreeDiffBack,
}: MainContentProps) {
   const { config } = useAppContext();

   const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
   const activeTabAgentId = activeTab?.agentId ?? null;

   // Agent installed status
   const [installedMap, setInstalledMap] = useState<Map<string, boolean>>(new Map());

   useEffect(() => {
      if (agents.length === 0) return;
      const agentIds = agents.map((a) => a.id);
      invoke<Record<string, boolean>>("check_agents_installed", { agentIds })
         .then((result) => setInstalledMap(new Map(Object.entries(result))))
         .catch((err) => console.error("[MainContent] Failed to check agents installed:", err));
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

   const currentAgentId =
      activeTab?.agentId ??
      activeProject?.selected_agent ??
      activeWslProject?.project.selected_agent ??
      activeRemoteProject?.project.selected_agent ??
      null;

   const enabledAgents = useMemo(() => agents.filter((a) => a.enabled), [agents]);
   const hasActiveProject = !!(activeProject || activeWslProject || activeRemoteProject);
   const showAgentBarContent = showAgentBar && hasActiveProject && enabledAgents.length > 0;

   const handleTerminalTabStatusChange = useCallback(
      (status: "Idle" | "Running" | "Failed") => {
         if (activeTabId) {
            onTabStatusChange?.(activeTabId, status);
         }
      },
      [activeTabId, onTabStatusChange]
   );

   const onWslSessionReady = useCallback(
      (pid: string) => {
         setWslOpenSessions((prev) => new Set(prev).add(pid));
      },
      [setWslOpenSessions]
   );

   const onRemoteSessionReady = useCallback(
      (pid: string) => {
         setRemoteOpenSessions((prev) => new Set(prev).add(pid));
      },
      [setRemoteOpenSessions]
   );

   const isTerminalView = activeProject?.active_view === "Terminal";
   const diffFilePath =
      typeof activeProject?.active_view === "object"
         ? (activeProject.active_view as { Diff: { file_path: string } }).Diff?.file_path || null
         : null;

   return (
      <div className="main-content flex-1 flex flex-col overflow-hidden">
         {hasActiveProject && (
            <div className="shrink-0 bg-bg-secondary border-b border-border">
               <div className="h-8 flex items-center px-2 gap-1">
                  <div className="flex-1 min-w-0">
                     <TerminalTabBar
                        tabs={tabs}
                        activeTabId={activeTabId}
                        onActivateTab={onActivateTab}
                        onCloseTab={onCloseTab}
                        onAddTab={onAddTab}
                     />
                  </div>
               </div>

               {showAgentBarContent && (
                  <div className="h-8 px-2 pb-1 flex items-center gap-1 overflow-x-auto">
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
         )}

         {activeWslProject && !activeProject && (
            <div className="content-area flex-1 overflow-hidden flex flex-col">
               {wslDiffState ? (
                  <DiffView
                     diffSource={{ type: "wsl", distro: wslDiffState.distro, projectPath: wslDiffState.projectPath }}
                     filePath={wslDiffState.filePath}
                     initialMode={config.diffMode}
                     onBack={onWslDiffBack}
                  />
               ) : (
                  <div className="terminal-pane-container flex-1 flex flex-row overflow-hidden min-h-0 p-0 m-0">
                     <WSLTerminalView
                        distro={activeWslProject.distro}
                        projectId={activeWslProject.project.id}
                        projectName={activeWslProject.project.name}
                        projectPath={activeWslWorktreePath ?? activeWslProject.project.path}
                        fontSize={config.fontSize}
                        fontFamily={config.fontFamily}
                        cacheKeySuffix={
                           activeWslWorktreePath ? `:wt:${btoa(activeWslWorktreePath).replace(/=/g, "")}` : ""
                        }
                        selectedAgentId={activeWslProject.project.selected_agent}
                        onSessionReady={onWslSessionReady}
                     />
                  </div>
               )}
            </div>
         )}

         {activeRemoteProject && !activeProject && !activeWslProject && (
            <RemoteProjectView
               entry={activeRemoteProject.entry}
               project={activeRemoteProject.project}
               remoteAuthStore={remoteAuthStore}
               remoteDiffState={remoteDiffState}
               config={config}
               onRemoteDiffBack={onRemoteDiffBack}
               activeRemoteWorktreePath={activeRemoteWorktreePath}
               onRemoteSessionReady={onRemoteSessionReady}
            />
         )}

         {activeProject ? (
            <div className="content-area flex-1 overflow-hidden flex flex-col">
               {worktreeDiffState ? (
                  <DiffView
                     diffSource={{
                        type: "worktree",
                        projectId: activeProject.id,
                        worktreePath: worktreeDiffState.worktreePath,
                     }}
                     filePath={worktreeDiffState.filePath}
                     initialMode={config.diffMode}
                     onBack={onWorktreeDiffBack}
                  />
               ) : isTerminalView || activeWorktreePath ? (
                  <div className="terminal-pane-container flex-1 flex flex-row overflow-hidden min-h-0 p-0 m-0">
                     {!activeWorktreePath && (
                        <TerminalView
                           project={activeProject}
                           tabId={activeTabId}
                           tabAgentId={activeTabAgentId}
                           fontSize={config.fontSize}
                           shell={config.shell}
                           fontFamily={config.fontFamily}
                           suppressResizeRef={suppressResizeRef}
                           agentCommandOverride={
                              config.agentCommandOverrides?.[
                              activeTabAgentId ?? activeProject.selected_agent ?? ""
                              ]
                           }
                           onTabStatusChange={handleTerminalTabStatusChange}
                        />
                     )}

                     {activeWorktreePath && (
                        <WorktreeTerminalView
                           projectId={activeProject.id}
                           projectName={activeProject.name}
                           worktreePath={activeWorktreePath}
                           worktreeBranch={activeWorktreeBranch}
                           selectedAgent={activeProject.selected_agent}
                           fontSize={config.fontSize}
                           shell={config.shell}
                           fontFamily={config.fontFamily}
                        />
                     )}
                  </div>
               ) : diffFilePath ? (
                  <DiffView
                     projectId={activeProject.id}
                     filePath={diffFilePath}
                     initialMode={config.diffMode}
                     onBack={() => handleSelectProject(activeProject.id)}
                  />
               ) : null}
            </div>
         ) : !activeWslProject && !activeRemoteProject ? (
            <div className="empty-state flex-1 flex flex-col text-text-secondary">
               <div className="empty-body flex-1 flex flex-col items-center justify-center gap-4">
                  <div className="empty-icon text-[3.43em] opacity-50">📁</div>
                  <h2 className="text-2xl font-semibold text-text-primary">Welcome to Neeko</h2>
                  <p className="text-[var(--font-size)]">Select a project or add a new one to get started</p>
                  <button
                     className="add-project-btn mt-2 px-6 py-2.5 bg-accent-blue border-none rounded-md text-white text-[var(--font-size)] font-medium cursor-pointer transition-colors duration-200 hover:bg-[#005a9e]"
                     onClick={handleAddProject}
                  >
                     Add Project
                  </button>
               </div>
            </div>
         ) : null}
      </div>
   );
}

export default React.memo(MainContent);
