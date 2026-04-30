import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { SplitLayout, TerminalView, WSLTerminalView } from "./terminal";
import DiffView from "./DiffView";
import RemoteProjectView from "./RemoteProjectView";
import { FileViewer } from "./files";
import { ProjectGuidePage } from "./project";
import TerminalTabBar from "./layout/TerminalTabBar";
import AgentIcon from "./layout/AgentIcon";
import {
   useAppContext,
   useProjectActionsContext,
   useWslContext,
   useRemoteContext,
   useEditorContext,
} from "../contexts";
import type { AgentConfig } from "../types";
import { useAppStore } from "../store/appStore";

function MainContent() {
   const { config, showToast } = useAppContext();
   const {
      onSelectProject,
      onAddProject,
      onWorktreeDiffBack,
      onOpenIde,
   } = useProjectActionsContext();
   const {
      activeWslProject,
      activeWslWorktreePath,
      wslDiffState,
      onWslDiffBack,
   } = useWslContext();
   const { activeRemoteProject } = useRemoteContext();
   const {
      tabs,
      activeTabId,
      onActivateTab,
      onCloseTab,
      onAddTab,
      agents,
      compactMode,
      showAgentBar,
      hiddenAgentIds,
      onToggleHiddenAgent,
      onAgentClick,
   } = useEditorContext();
   const activeProject = useAppStore((state) => state.activeProject);
   const activeWorktreePath = useAppStore((state) => state.activeWorktreePath);
   const activeWorktreeBranch = useAppStore((state) => state.activeWorktreeBranch);
   const worktreeDiffState = useAppStore((state) => state.worktreeDiffState);
   const fileTabs = useAppStore((state) => state.fileTabs);

   // Manage Presets dropdown
   const [managerOpen, setManagerOpen] = useState(false);
   const managerRef = useRef<HTMLDivElement>(null);

   useEffect(() => {
      if (!managerOpen) return;
      const handler = (e: MouseEvent) => {
         if (managerRef.current && !managerRef.current.contains(e.target as Node)) {
            setManagerOpen(false);
         }
      };
      document.addEventListener("mousedown", handler);
      return () => document.removeEventListener("mousedown", handler);
   }, [managerOpen]);

   const allEnabledAgents = useMemo(() => agents.filter((a) => a.enabled).sort((a, b) => a.name.localeCompare(b.name)), [agents]);

   const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;

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

   const enabledAgents = useMemo(() => agents.filter((a) => a.enabled && !hiddenAgentIds.includes(a.id)), [agents, hiddenAgentIds]);
   const hasActiveProject = !!(activeProject || activeWslProject || activeRemoteProject);
   const showAgentBarContent = showAgentBar && hasActiveProject && (enabledAgents.length > 0 || allEnabledAgents.length > 0);

   const isTerminalView = activeProject?.active_view === "Terminal";
   const showGuidePage = isTerminalView && tabs.length === 0 && !activeWorktreePath;

   const selectedAgent = useMemo(() => {
      const agentId = activeProject?.selected_agent;
      if (!agentId) return null;
      return agents.find((a) => a.id === agentId) ?? null;
   }, [activeProject?.selected_agent, agents]);

   const handleGuideOpenTerminal = useCallback(() => {
      onAddTab();
   }, [onAddTab]);

   const handleGuideOpenAgent = useCallback(() => {
      if (!selectedAgent) return;
      handleAgentClick(selectedAgent);
   }, [selectedAgent, handleAgentClick]);

   const handleGuideOpenIde = useCallback(() => {
      if (!activeProject || !onOpenIde) return;
      onOpenIde(activeProject.id);
   }, [activeProject, onOpenIde]);
   const localLayoutId = activeProject
      ? `local:${activeProject.id}:${activeTabId ?? "default"}`
      : "local:none";
   const wslLayoutId = activeWslProject
      ? `wsl:${activeWslProject.distro}:${activeWslProject.project.id}:${activeTabId ?? "default"}:${activeWslWorktreePath ?? "main"}`
      : "wsl:none";
   const diffFilePath =
      typeof activeProject?.active_view === "object"
         ? (activeProject.active_view as { Diff: { file_path: string } }).Diff?.file_path || null
         : null;

   // Determine if we should show FileViewer
   const showFileViewer = fileTabs.length > 0;

   return (
      <div className="main-content flex-1 flex flex-col overflow-hidden min-h-0 bg-bg-primary">
         {/* 终端头部：引导页和 FileViewer 模式下不显示 */}
         {hasActiveProject && !showFileViewer && !showGuidePage && (
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
                  <div className="h-8 px-2 pb-1 flex items-center gap-1">
                     {/* Gear button */}
                     <div className="relative shrink-0" ref={managerRef}>
                        <button
                           className="tb-icon-btn flex items-center justify-center w-6 h-6 rounded-md transition-colors text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                           style={{ fontSize: "var(--terminal-font-size)" }}
                           onClick={() => setManagerOpen((v) => !v)}
                           title="Manage Presets"
                        >
                           <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37 1 .608 2.296.07 2.573-1.066z" />
                              <circle cx="12" cy="12" r="3" />
                           </svg>
                        </button>
                        {/* Manage Presets dropdown */}
                        {managerOpen && (
                           <div
                              className="absolute left-0 top-full mt-1 z-50 min-w-[180px] max-h-[280px] overflow-y-auto rounded-md border border-border bg-bg-secondary shadow-lg py-1"
                           >
                              {allEnabledAgents.map((agent) => {
                                 const pinned = !hiddenAgentIds.includes(agent.id);
                                 return (
                                    <div
                                       key={agent.id}
                                       className="flex items-center gap-2 px-3 py-1.5 hover:bg-white/5 cursor-pointer text-text-primary"
                                       style={{ fontSize: "var(--terminal-font-size)" }}
                                       onClick={() => onToggleHiddenAgent(agent.id)}
                                    >
                                       <AgentIcon icon={agent.icon} />
                                       <span className="flex-1 truncate">{agent.name}</span>
                                       {pinned ? (
                                          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="text-text-secondary shrink-0">
                                             <path d="M9.828.722a.5.5 0 01.354.146l4.95 4.95a.5.5 0 010 .707c-.48.48-1.307.848-2.21.988V14.5a.5.5 0 01-.5.5h-2a.5.5 0 01-.5-.5v-2.5H6v2.5a.5.5 0 01-.5.5h-2a.5.5 0 01-.5-.5V6.81c-.903-.14-1.73-.508-2.21-.988a.5.5 0 010-.707l4.95-4.95a.5.5 0 01.354-.146z" />
                                          </svg>
                                       ) : (
                                          <span className="flex items-center justify-center w-4 h-4 rounded-full bg-white/10 text-text-secondary text-[10px] leading-none shrink-0">+</span>
                                       )}
                                    </div>
                                 );
                              })}
                           </div>
                        )}
                     </div>
                     {/* Agent buttons */}
                     <div className="flex items-center gap-1 overflow-x-auto flex-1 min-w-0 h-6">
                        {enabledAgents.map((agent) => {
                           const installed = installedMap.size === 0 || (installedMap.get(agent.id) ?? true);
                           const selected = currentAgentId === agent.id;
                           return (
                              <button
                                 key={agent.id}
                                 className={`tb-icon-btn flex items-center gap-1.5 px-2 h-6 rounded-md transition-colors ${selected ? "text-text-primary bg-bg-hover" : "text-text-secondary hover:bg-bg-hover hover:text-text-primary"} ${!installed ? "opacity-50" : ""}`}
                                 style={{ fontSize: "var(--terminal-font-size)" }}
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
                  </div>
               )}
            </div>
         )}

         {activeWslProject && !activeProject && (
            <div className="content-area flex-1 overflow-hidden flex flex-col min-h-0">
               {wslDiffState ? (
                  <DiffView
                     diffSource={{ type: "wsl", distro: wslDiffState.distro, projectPath: wslDiffState.projectPath }}
                     filePath={wslDiffState.filePath}
                     initialMode={config.diffMode}
                     onBack={onWslDiffBack}
                  />
               ) : (
                  <div className="terminal-pane-container flex-1 flex flex-row overflow-hidden min-h-0 p-0 m-0">
                     <SplitLayout
                        layoutId={wslLayoutId}
                        renderPane={(paneId) => (
                           <WSLTerminalView paneId={paneId} />
                        )}
                     />
                  </div>
               )}
            </div>
         )}

         {activeRemoteProject && !activeProject && !activeWslProject && (
            <RemoteProjectView />
         )}

         {activeProject ? (
            <div className="content-area flex-1 overflow-hidden flex flex-col min-h-0">
               {showFileViewer ? (
                  <FileViewer />
               ) : worktreeDiffState ? (
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
               ) : showGuidePage ? (
                  <ProjectGuidePage
                     selectedAgent={selectedAgent}
                     selectedIde={activeProject.selected_ide}
                     onOpenTerminal={handleGuideOpenTerminal}
                     onOpenAgent={handleGuideOpenAgent}
                     onOpenIde={handleGuideOpenIde}
                  />
               ) : isTerminalView || activeWorktreePath ? (
                  <div className="terminal-pane-container flex-1 flex flex-row overflow-hidden min-h-0 p-0 m-0">
                     <SplitLayout
                        layoutId={localLayoutId}
                        renderPane={(paneId) => (
                           <TerminalView
                              paneId={paneId}
                              worktreePath={activeWorktreePath ?? undefined}
                              worktreeBranch={activeWorktreeBranch ?? undefined}
                           />
                        )}
                     />
                  </div>
               ) : diffFilePath ? (
                  <DiffView
                     projectId={activeProject.id}
                     filePath={diffFilePath}
                     initialMode={config.diffMode}
                     onBack={() => onSelectProject(activeProject.id)}
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
                     className="add-project-btn mt-2 px-6 py-2.5 bg-accent-blue border-none rounded-md text-text-primary text-[var(--font-size)] font-medium cursor-pointer transition-colors duration-200 hover:opacity-90"
                     onClick={onAddProject}
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
