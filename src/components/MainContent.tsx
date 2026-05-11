import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { SplitLayout, TerminalView, WSLTerminalView } from "./terminal";
import type { SplitStateInfo } from "./terminal/SplitLayout";
import DiffView from "./DiffView";
import RemoteProjectView from "./RemoteProjectView";
import { FileViewer, HtmlPreview } from "./files";
import { ProjectGuidePage } from "./project";
import { GitLogPanel } from "./gitlog";
import UnifiedTabBar from "./layout/UnifiedTabBar";
import AgentIcon from "./layout/AgentIcon";
import SettingsPanel from "./SettingsPanel";
import {
   useAppContext,
   useProjectActionsContext,
   useWslContext,
   useRemoteContext,
   useEditorContext,
} from "../contexts";
import type { AgentConfig, Tab } from "../types";
import { useAppStore } from "../store/appStore";
import { cn } from "../utils/cn";
import { buildWorktreeTabKey } from "../utils/tabKey";

const APP_SETTINGS_PROJECT_ID = "__app__";
const SETTINGS_TAB_ID = "settings_tab";

function MainContent() {
   const { config, showToast, saveConfig } = useAppContext();
   const {
      onAddProject,
      onOpenIde,
   } = useProjectActionsContext();
   const {
      activeWslProject,
   } = useWslContext();
   const { activeRemoteProject } = useRemoteContext();
   const {
      agents,
      compactMode,
      showAgentBar,
      hiddenAgentIds,
      onToggleHiddenAgent,
      onAgentClick,
   } = useEditorContext();
   const activeProject = useAppStore((state) => state.activeProject);
   const activeWorktreePath = useAppStore((state) => state.activeWorktreePath);

   // Determine the current project ID (local, WSL, or Remote)
   const currentProjectId = activeProject?.id ?? activeWslProject?.project.id ?? activeRemoteProject?.project.id ?? null;

   // Composite tab key: worktree gets its own independent tab space
   const tabKey = activeWorktreePath && currentProjectId
      ? buildWorktreeTabKey(currentProjectId, activeWorktreePath)
      : (currentProjectId ?? APP_SETTINGS_PROJECT_ID);

   // Get unified tabs from store
   const projectTabs = useAppStore((state) => {
      if (!tabKey) return null;
      return state.tabs[tabKey] ?? null;
   });

   const tabs = projectTabs?.tabs ?? [];
   const storeActiveTabId = projectTabs?.activeTabId ?? null;
   const activeTab = tabs.find((t) => t.id === storeActiveTabId) ?? null;

   const hasActiveProject = !!(activeProject || activeWslProject || activeRemoteProject);

   // Split layout state (exposed from SplitLayout)
   const [splitInfo, setSplitInfo] = useState<SplitStateInfo>({ paneCount: 1, canSplit: true, activePaneId: "p1" });
   const splitHorizontalRef = useRef<(() => void) | null>(null);
   const splitVerticalRef = useRef<(() => void) | null>(null);
   const closePaneRef = useRef<(() => void) | null>(null);

   const handleSplitStateChange = useCallback((info: SplitStateInfo) => {
      setSplitInfo(info);
   }, []);

   const handleSetSplitHorizontal = useCallback((cb: () => void) => {
      splitHorizontalRef.current = cb;
   }, []);

   const handleSetSplitVertical = useCallback((cb: () => void) => {
      splitVerticalRef.current = cb;
   }, []);

   const handleSetClosePane = useCallback((cb: () => void) => {
      closePaneRef.current = cb;
   }, []);

   // Tab operations
   const handleActivateTab = useCallback((tabId: string) => {
      if (!tabKey) return;
      useAppStore.getState().activateTab(tabKey, tabId);
   }, [tabKey]);

   const handleCloseTab = useCallback((tabId: string) => {
      if (!tabKey) return;
      useAppStore.getState().closeTab(tabKey, tabId);
   }, [tabKey]);

   const handleAddTerminalTab = useCallback(() => {
      if (!tabKey || !currentProjectId) return;
      const existingTabs = useAppStore.getState().tabs[tabKey];
      const terminalCount = (existingTabs?.tabs ?? []).filter((t) => t.data.kind === "terminal").length;
      if (terminalCount >= 10) return;

      const tabId = `tab_${crypto.randomUUID()}`;
      const tab: Tab = {
         id: tabId,
         projectId: currentProjectId,
         title: `Terminal ${terminalCount + 1}`,
         order: existingTabs?.tabs.length ?? 0,
         data: {
            kind: "terminal",
            agentId: null,
            status: "Idle",
         },
      };
      useAppStore.getState().addTab(tabKey, tab);
      useAppStore.getState().activateTab(tabKey, tabId);
   }, [tabKey, currentProjectId]);

   const handleCloseSettingsTab = useCallback(() => {
      handleCloseTab(SETTINGS_TAB_ID);
   }, [handleCloseTab]);

   const handleSettingsConfigChange = useCallback(
      (next: typeof config) => {
         saveConfig(next);
      },
      [saveConfig],
   );

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
      (activeTab?.data.kind === "terminal" ? activeTab.data.agentId : null) ??
      activeProject?.selected_agent ??
      activeWslProject?.project.selected_agent ??
      activeRemoteProject?.project.selected_agent ??
      null;

   const enabledAgents = useMemo(() => agents.filter((a) => a.enabled && !hiddenAgentIds.includes(a.id)), [agents, hiddenAgentIds]);

   const selectedAgent = useMemo(() => {
      const agentId = activeProject?.selected_agent;
      if (!agentId) return null;
      return agents.find((a) => a.id === agentId) ?? null;
   }, [activeProject?.selected_agent, agents]);

   const handleGuideOpenTerminal = useCallback(() => {
      handleAddTerminalTab();
   }, [handleAddTerminalTab]);

   const handleGuideOpenAgent = useCallback(() => {
      if (!selectedAgent) return;
      handleAgentClick(selectedAgent);
   }, [selectedAgent, handleAgentClick]);

   const handleGuideOpenIde = useCallback(() => {
      if (!activeProject || !onOpenIde) return;
      onOpenIde(activeProject.id);
   }, [activeProject, onOpenIde]);

   const handleGuideOpenSettings = useCallback(() => {
      if (!currentProjectId) return;
      const existingTabs = useAppStore.getState().tabs[currentProjectId];
      const tab: Tab = {
         id: SETTINGS_TAB_ID,
         projectId: currentProjectId,
         title: "Settings",
         order: existingTabs?.tabs.length ?? 0,
         data: { kind: "settings" },
      };
      useAppStore.getState().addTab(currentProjectId, tab);
      useAppStore.getState().activateTab(currentProjectId, SETTINGS_TAB_ID);
   }, [currentProjectId]);

   const localLayoutId = activeProject
      ? `local:${activeProject.id}:${storeActiveTabId ?? "default"}`
      : "local:none";
   const wslLayoutId = activeWslProject
      ? `wsl:${activeWslProject.distro}:${activeWslProject.project.id}:${storeActiveTabId ?? "default"}`
      : "wsl:none";

   const showAgentBarContent = showAgentBar && hasActiveProject && activeTab?.data.kind === "terminal" && (enabledAgents.length > 0 || allEnabledAgents.length > 0);
   const showAgentBarRow = hasActiveProject && activeTab?.data.kind === "terminal";

   return (
      <div className="main-content flex-1 flex flex-col overflow-hidden min-h-0">
         {/* 统一 TabBar + Agent Bar */}
         {tabs.length > 0 && (
             <div className="shrink-0 bg-bg-secondary">
                <div className="h-8 flex items-center px-2 gap-1">
                   <div className="flex-1 min-w-0">
                      <UnifiedTabBar
                         tabs={tabs}
                         activeTabId={storeActiveTabId}
                         onActivateTab={handleActivateTab}
                         onCloseTab={handleCloseTab}
                         onAddTerminalTab={handleAddTerminalTab}
                         agents={agents}
                      />
                  </div>
               </div>

               {showAgentBarRow && (
                  <div className="h-8 px-2 pb-1 flex items-center gap-1">
                     {/* Gear button + Agent buttons */}
                     {showAgentBarContent && (
                        <>
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
                        </>
                     )}
                     {/* Spacer */}
                     {!showAgentBarContent && <div className="flex-1" />}
                     {/* Split buttons */}
                     <div className="flex items-center gap-0.5 shrink-0 ml-auto">
                        <button
                           className="tb-icon-btn flex items-center justify-center w-6 h-6 rounded-md transition-colors text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                           title={splitInfo.canSplit ? "Split Horizontal" : "Maximum panes reached"}
                           disabled={!splitInfo.canSplit}
                           onClick={() => splitHorizontalRef.current?.()}
                        >
                           <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                              <rect x="1" y="2" width="10" height="8" stroke="currentColor" strokeWidth="1" />
                              <path d="M6 2V10" stroke="currentColor" strokeWidth="1" />
                           </svg>
                        </button>
                        <button
                           className="tb-icon-btn flex items-center justify-center w-6 h-6 rounded-md transition-colors text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                           title={splitInfo.canSplit ? "Split Vertical" : "Maximum panes reached"}
                           disabled={!splitInfo.canSplit}
                           onClick={() => splitVerticalRef.current?.()}
                        >
                           <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                              <rect x="1" y="2" width="10" height="8" stroke="currentColor" strokeWidth="1" />
                              <path d="M1 6H11" stroke="currentColor" strokeWidth="1" />
                           </svg>
                        </button>
                        {splitInfo.paneCount > 1 && (
                           <button
                              className="tb-icon-btn flex items-center justify-center w-6 h-6 rounded-md transition-colors text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                              title="Close Pane"
                              onClick={() => closePaneRef.current?.()}
                           >
                              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                                 <path d="M3 3L9 9M9 3L3 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                              </svg>
                           </button>
                        )}
                     </div>
                  </div>
               )}
            </div>
         )}

         {/* 内容区域 */}
         {activeTab?.data.kind === "settings" ? (
            <SettingsPanel
               fullPage
               onConfigChange={handleSettingsConfigChange}
               onClose={handleCloseSettingsTab}
            />
         ) : activeRemoteProject && !activeProject && !activeWslProject ? (
            <RemoteProjectView />
         ) : (
             <div className="flex-1 flex flex-col overflow-hidden">
               {/* Terminal */}
               {activeTab?.data.kind === "terminal" && (
                  <div className="terminal-pane-container flex-1 flex flex-row overflow-hidden min-h-0 p-0 m-0">
                     <SplitLayout
                        layoutId={activeWslProject ? wslLayoutId : localLayoutId}
                        renderPane={(paneId) => (
                           activeWslProject ? (
                              <WSLTerminalView paneId={paneId} />
                           ) : (
                              <TerminalView paneId={paneId} />
                           )
                        )}
                        onSplitStateChange={handleSplitStateChange}
                        onSplitHorizontal={handleSetSplitHorizontal}
                        onSplitVertical={handleSetSplitVertical}
                        onClosePane={handleSetClosePane}
                     />
                  </div>
               )}

               {/* Diff */}
               {activeTab?.data.kind === "diff" && (
                  <DiffView
                     diffSource={activeTab.data.diffSource}
                     filePath={activeTab.data.filePath}
                     initialMode={config.diffMode}
                     onBack={() => handleCloseTab(activeTab.id)}
                  />
               )}

                {/* File Editor */}
                {activeTab?.data.kind === "file" && (
                   <FileViewer />
                )}

                {/* HTML Preview */}
                {activeTab?.data.kind === "html-preview" && (
                   <HtmlPreview
                      projectId={activeTab.projectId}
                      filePath={activeTab.data.filePath}
                      fileName={activeTab.data.fileName}
                   />
                )}

                {/* Git Log — keep mounted to preserve state across tab switches */}
                <div
                  className={cn(
                    "flex-1 min-h-0",
                    activeTab?.data.kind === "gitLog" ? "flex flex-col" : "hidden",
                  )}
                >
                  <GitLogPanel />
                </div>

                {/* Guide Page (local project with no tabs) */}
               {!activeTab && hasActiveProject && activeProject && (
                  <ProjectGuidePage
                     selectedAgent={selectedAgent}
                     selectedIde={activeProject.selected_ide}
                      onOpenTerminal={handleGuideOpenTerminal}
                      onOpenAgent={handleGuideOpenAgent}
                      onOpenIde={handleGuideOpenIde}
                      onOpenSettings={handleGuideOpenSettings}
                  />
               )}

               {/* Welcome Page (no project, no tabs) */}
               {!activeTab && !hasActiveProject && tabs.length === 0 && (
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
               )}
            </div>
         )}
      </div>
   );
}

export default React.memo(MainContent);
