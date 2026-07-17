import React, { useCallback, useEffect, useMemo, useState } from "react";
import { checkAgentsInstalled } from "@/features/agent/api/agentApi";
import ProjectGuidePage from "@/features/project/components/ProjectGuidePage";
import EditorGroupLayout from "@/features/editor/components/EditorGroupLayout";
import { Button } from "@/ui/button";
import { useAppContext } from "@/shared/contexts";
import { useProjectActionsContext } from "@/features/project/context";
import { useRemoteContext } from "@/features/connection/contexts/RemoteContext";
import { useEditorContext } from '@/shared/contexts';
import type { AgentConfig, Tab } from '@/shared/types';
import { useProjectStore } from "@/features/project/store";
import { useConnectionStore } from "@/features/connection/store";
import { useWorktreeStore } from "@/features/project/worktreeStore";
import { useEditorStore } from '@/shared/store';
import { useShallow } from "zustand/shallow";
import { useAppViewStore } from "@/shared/store/appViewStore";
import { buildWorktreeTabKey } from "@/shared/utils/tabKey";
import { useFileDrop } from "@/features/file/hooks/useFileDrop";

const APP_SETTINGS_PROJECT_ID = "__app__";

// Module-level cache: `${projectId}::${agentId}` — status is environment-specific.
const agentInstalledCache = new Map<string, boolean>();

function agentInstallCacheKey(projectId: string | null, agentId: string): string {
   return `${projectId ?? "__none__"}::${agentId}`;
}

function MainContent() {
   const { showToast } = useAppContext();
   const {
      onAddProject,
      onOpenIde,
   } = useProjectActionsContext();
   const {
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

   // Determine the current project ID (all types via unified store)
   const currentProjectId = activeProject?.id ?? null;

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

   const hasActiveProject = !!activeProject;

   // Wire up file drag-to-agent: on dragend, paste the stored file path into
   // the agent terminal without auto-submitting (no \r).
   useFileDrop();

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

   // Agent installed status — re-check when agents or active project change
   // (Local / WSL / SSH each have their own PATH).
   const agentIdFingerprint = useMemo(
      () => agents.map((a) => a.id).sort().join(','),
      [agents],
   );
   const [installedMap, setInstalledMap] = useState<Map<string, boolean>>(new Map());

   useEffect(() => {
      const ids = agents.map((a) => a.id);
      if (ids.length === 0) return;

      const buildMap = () => {
         const map = new Map<string, boolean>();
         for (const id of ids) {
            map.set(
               id,
               agentInstalledCache.get(agentInstallCacheKey(currentProjectId, id)) ?? true,
            );
         }
         return map;
      };

      const missing = ids.filter(
         (id) => !agentInstalledCache.has(agentInstallCacheKey(currentProjectId, id)),
      );
      if (missing.length === 0) {
         setInstalledMap(buildMap());
         return;
      }

      checkAgentsInstalled(missing, currentProjectId)
         .then((result) => {
            for (const [id, installed] of Object.entries(result)) {
               agentInstalledCache.set(agentInstallCacheKey(currentProjectId, id), installed);
            }
            setInstalledMap(buildMap());
         })
         .catch((err) => console.error("[MainContent] Failed to check agents installed:", err));
   }, [agentIdFingerprint, currentProjectId]);

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
      const p = useProjectStore.getState().activeProject;
      if (!p) return `none:${groupId}:${tabId ?? "default"}`;
      const env = p.environment;
      let base: string;
      if (env.type === 'Wsl') {
         base = `wsl:${env.distro}:${p.id}`;
      } else if (env.type === 'Remote') {
         base = `remote:${env.host}:${p.id}`;
      } else {
         base = `local:${p.id}`;
      }
      return `${base}:${groupId}:${tabId ?? "default"}`;
   }, []);

   const onRemoteSessionReady = useCallback(
      (pid: string) => {
         setRemoteOpenSessions((prev) => new Set(prev).add(pid));
      },
      [setRemoteOpenSessions],
   );

   // Remote project needs authentication but has no credentials yet
   const needsRemoteAuth = (() => {
      if (!activeProject || activeProject.environment.type !== 'Remote') return false;
      const env = activeProject.environment;
      const entry = useConnectionStore.getState().remoteEntries.find(e => e.host === env.host);
      return !!entry && !remoteAuthStore.get(entry.id);
   })();

   const remoteProjectProp = useMemo(() => {
      const p = useProjectStore.getState().activeProject;
      if (!p || p.environment.type !== 'Remote') return null;
      const env = p.environment;
      const entry = useConnectionStore.getState().remoteEntries.find(e => e.host === env.host);
      if (!entry) return null;
      const auth = remoteAuthStore.get(entry.id);
      if (!auth) return null;
      const projectPath = activeRemoteWorktreePath ?? p.path;
      const cacheKeySuffix = activeRemoteWorktreePath
         ? `:wt:${btoa(activeRemoteWorktreePath).replace(/=/g, "")}`
         : "";
      return {
         entryId: entry.id,
         projectId: p.id,
         projectName: p.name,
         projectPath,
         host: entry.host,
         port: entry.port,
         username: entry.username,
         auth,
         cacheKeySuffix,
         onSessionReady: onRemoteSessionReady,
      };
   }, [activeProject, remoteAuthStore, activeRemoteWorktreePath, onRemoteSessionReady]);

   return (
      <div className="main-content flex-1 flex flex-col overflow-hidden min-h-0 h-full">
          {needsRemoteAuth ? (
            <div className="empty-state flex-1 flex flex-col text-text-secondary">
               <div className="empty-body flex-1 flex flex-col items-center justify-center gap-4">
                  <div className="empty-icon text-[3.43em] opacity-50">🔑</div>
                  <h2 className="text-2xl font-semibold text-text-primary">Authentication required</h2>
                  <Button
                     variant="primary"
                      onClick={() => {
                        const p = useProjectStore.getState().activeProject;
                        if (!p) return;
                        const env = p.environment;
                        if (env.type === 'Remote') {
                          const entry = useConnectionStore.getState().remoteEntries.find(e => e.host === env.host);
                          if (entry) setPendingAuthEntry(entry);
                        }
                      }}
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
