import React, { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ProjectGuidePage } from "../components/project";
import EditorGroupLayout from "../components/layout/EditorGroupLayout";
import { Button } from "@/ui/button";
import {
   useAppContext,
   useProjectActionsContext,
   useWslContext,
   useRemoteContext,
   useEditorContext,
} from "../contexts";
import type { AgentConfig, Tab } from "../types";
import { useProjectStore } from "../store/projectStore";
import { useWorktreeStore } from "../store/worktreeStore";
import { useEditorStore } from "../store/editorStore";
import { useShallow } from "zustand/shallow";
import { useAppViewStore } from "../store/appViewStore";
import { buildWorktreeTabKey } from "../utils/tabKey";

const APP_SETTINGS_PROJECT_ID = "__app__";

// Module-level agent install status cache — survives component remounts.
// check_agents_installed IPC 只在 agent 列表真正变化时触发（通过 ID 比对），
// 不会随项目切换重复执行。
const agentInstalledCache = new Map<string, boolean>();

function MainContent() {
   const { showToast } = useAppContext();
   const {
      onAddProject,
      onOpenIde,
   } = useProjectActionsContext();
   const {
      activeWslProject,
   } = useWslContext();
   const {
      activeRemoteProject,
      remoteAuthStore,
      activeRemoteWorktreePath,
      setRemoteOpenSessions,
      setPendingAuthEntry,
   } = useRemoteContext();
   const {
      agents,
      onAgentClick,
   } = useEditorContext();
   const activeProject = useProjectStore((state) => state.activeProject);
   const activeWorktreePath = useWorktreeStore((state) => state.activeWorktreePath);

   // Determine the current project ID (local, WSL, or Remote)
   const currentProjectId = activeProject?.id ?? activeWslProject?.project.id ?? activeRemoteProject?.project.id ?? null;

   // Composite tab key: worktree gets its own independent tab space
   const tabKey = activeWorktreePath && currentProjectId
      ? buildWorktreeTabKey(currentProjectId, activeWorktreePath)
      : (currentProjectId ?? APP_SETTINGS_PROJECT_ID);

   // Get unified tabs from store
   const projectTabs = useEditorStore(useShallow((state) => {
      if (!tabKey) return null;
      return state.tabs[tabKey] ?? null;
   }));

   const tabs = projectTabs?.tabs ?? [];

   const hasActiveProject = !!(activeProject || activeWslProject || activeRemoteProject);

   const handleAddTerminalTab = useCallback(() => {
      if (!tabKey || !currentProjectId) return;
      const existingTabs = useEditorStore.getState().tabs[tabKey];
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
      useEditorStore.getState().addTab(tabKey, tab);
      useEditorStore.getState().activateTab(tabKey, tabId);
   }, [tabKey, currentProjectId]);

   // Agent installed status — cached at module level, only checks new agents
   // whose ID hasn't been seen yet. agentIdFingerprint ensures re-check
   // only when the agent list identity changes, not on project switches.
   const agentIdFingerprint = useMemo(
      () => agents.map((a) => a.id).sort().join(','),
      [agents],
   );
   const [installedMap, setInstalledMap] = useState<Map<string, boolean>>(new Map(agentInstalledCache));

   useEffect(() => {
      const ids = agents.map((a) => a.id);
      if (ids.length === 0) return;
      const newIds = ids.filter((id) => !agentInstalledCache.has(id));
      if (newIds.length === 0) return;
      invoke<Record<string, boolean>>("check_agents_installed", { agentIds: newIds })
         .then((result) => {
            for (const [id, installed] of Object.entries(result)) {
               agentInstalledCache.set(id, installed);
            }
            setInstalledMap(new Map(agentInstalledCache));
         })
         .catch((err) => console.error("[MainContent] Failed to check agents installed:", err));
   }, [agentIdFingerprint]);

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
      useAppViewStore.getState().setAppView("settings");
   }, []);

   const buildLayoutId = useCallback((groupId: string, tabId: string | null) => {
      const base = activeProject
         ? `local:${activeProject.id}`
         : activeWslProject
            ? `wsl:${activeWslProject.distro}:${activeWslProject.project.id}`
            : activeRemoteProject
               ? `remote:${activeRemoteProject.entry.id}:${activeRemoteProject.project.id}`
               : "none";
      return `${base}:${groupId}:${tabId ?? "default"}`;
   }, [activeProject, activeWslProject, activeRemoteProject]);

   const onRemoteSessionReady = useCallback(
      (pid: string) => {
         setRemoteOpenSessions((prev) => new Set(prev).add(pid));
      },
      [setRemoteOpenSessions],
   );

   // Remote project needs authentication but has no credentials yet
   const needsRemoteAuth = !!(activeRemoteProject && !activeProject && !activeWslProject
      && !remoteAuthStore.get(activeRemoteProject.entry.id));

   const remoteProjectProp = useMemo(() => {
      if (!activeRemoteProject || activeProject || activeWslProject) return null;
      const { entry, project } = activeRemoteProject;
      const auth = remoteAuthStore.get(entry.id);
      if (!auth) return null;
      const projectPath = activeRemoteWorktreePath ?? project.path;
      const cacheKeySuffix = activeRemoteWorktreePath
         ? `:wt:${btoa(activeRemoteWorktreePath).replace(/=/g, "")}`
         : "";
      return {
         entryId: entry.id,
         projectId: project.id,
         projectName: project.name,
         projectPath,
         host: entry.host,
         port: entry.port,
         username: entry.username,
         auth,
         cacheKeySuffix,
         onSessionReady: onRemoteSessionReady,
      };
   }, [activeRemoteProject, activeProject, activeWslProject, remoteAuthStore, activeRemoteWorktreePath, onRemoteSessionReady]);

   return (
      <div className="main-content flex-1 flex flex-col overflow-hidden min-h-0 h-full rounded-lg shadow-sm bg-bg-secondary">
          {needsRemoteAuth ? (
            <div className="empty-state flex-1 flex flex-col text-text-secondary">
               <div className="empty-body flex-1 flex flex-col items-center justify-center gap-4">
                  <div className="empty-icon text-[3.43em] opacity-50">🔑</div>
                  <h2 className="text-2xl font-semibold text-text-primary">Authentication required</h2>
                  <Button
                     variant="primary"
                     onClick={() => setPendingAuthEntry(activeRemoteProject!.entry)}
                     style={{ color: 'var(--text-on-accent)' }}
                  >
                     Enter Credentials
                  </Button>
               </div>
            </div>
         ) : tabs.length > 0 ? (
            <EditorGroupLayout
               tabKey={tabKey}
               onAddTerminalTab={handleAddTerminalTab}
               remoteProject={remoteProjectProp}
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
