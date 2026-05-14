import React, { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import RemoteProjectView from "./RemoteProjectView";
import { ProjectGuidePage } from "./project";
import EditorGroupLayout from "./layout/EditorGroupLayout";
import {
   useAppContext,
   useProjectActionsContext,
   useWslContext,
   useRemoteContext,
   useEditorContext,
} from "../contexts";
import type { AgentConfig, Tab } from "../types";
import { useAppStore } from "../store/appStore";
import { buildWorktreeTabKey } from "../utils/tabKey";

const APP_SETTINGS_PROJECT_ID = "__app__";
const SETTINGS_TAB_ID = "settings_tab";

function MainContent() {
   const { config, showToast } = useAppContext();
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

   const hasActiveProject = !!(activeProject || activeWslProject || activeRemoteProject);

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

   const handleCloseOtherTabs = useCallback((keepTabId: string) => {
      if (!tabKey) return;
      const store = useAppStore.getState();
      const projectTabs = store.tabs[tabKey];
      if (!projectTabs) return;
      for (const tab of projectTabs.tabs) {
         if (tab.id !== keepTabId) {
            store.closeTab(tabKey, tab.id);
         }
      }
   }, [tabKey]);

   const handleClearAllTabs = useCallback(() => {
      if (!tabKey) return;
      useAppStore.getState().clearProjectTabs(tabKey);
   }, [tabKey]);

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

   const buildLayoutId = useCallback((groupId: string, tabId: string | null) => {
      const base = activeProject
         ? `local:${activeProject.id}`
         : activeWslProject
            ? `wsl:${activeWslProject.distro}:${activeWslProject.project.id}`
            : "none";
      return `${base}:${groupId}:${tabId ?? "default"}`;
   }, [activeProject, activeWslProject]);

   const showRemoteProject = activeRemoteProject && !activeProject && !activeWslProject
      && storeActiveTabId !== null
      && !tabs.some((t) => t.id === storeActiveTabId && (t.data.kind === "file" || t.data.kind === "gitLog" || t.data.kind === "diff"));

   return (
      <div className="main-content flex-1 flex flex-col overflow-hidden min-h-0 rounded-lg shadow-sm bg-bg-secondary">
         {/* Remote project view (special case) */}
         {showRemoteProject ? (
            <RemoteProjectView />
         ) : tabs.length > 0 ? (
            <EditorGroupLayout
               tabKey={tabKey}
               allTabs={tabs}
               activeTabId={storeActiveTabId}
               onAddTerminalTab={handleAddTerminalTab}
               agents={agents}
               compactMode={compactMode}
               showAgentBar={showAgentBar}
               hiddenAgentIds={hiddenAgentIds}
               onToggleHiddenAgent={onToggleHiddenAgent}
               onAgentClick={handleAgentClick}
               onCloseOtherTabs={handleCloseOtherTabs}
               onCloseAllTabs={handleClearAllTabs}
               config={config}
               showToast={showToast}
               wslProject={activeWslProject}
               buildLayoutId={buildLayoutId}
            />
         ) : hasActiveProject && activeProject ? (
            <ProjectGuidePage
               selectedAgent={selectedAgent}
               selectedIde={activeProject.selected_ide}
               onOpenTerminal={handleGuideOpenTerminal}
               onOpenAgent={handleGuideOpenAgent}
               onOpenIde={handleGuideOpenIde}
               onOpenSettings={handleGuideOpenSettings}
            />
         ) : !hasActiveProject ? (
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
