import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { IS_WINDOWS } from "./utils/platform";
import { AddProjectModal } from "./components/project";
import SettingsPanel from "./components/SettingsPanel";
import { TitleBar } from "./components/layout";
import AppLayout from "./components/layout/AppLayout";
import { AppToast } from "./components/AppToast";
import { WSLDialog, RemoteDialog, RemoteAuthDialog } from "./components/connections";
import type { ActiveWslKey } from "./components/connections";
import type { ActiveRemoteKey } from "./hooks/useRemoteProjects";
import { useToast } from "./hooks/useToast";
import { useWorktreeState } from "./hooks/useWorktreeState";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useAppConfig } from "./hooks/useAppConfig";
import { useLocalProjects } from "./hooks/useLocalProjects";
import { useWslProjects } from "./hooks/useWslProjects";
import { useRemoteProjects } from "./hooks/useRemoteProjects";
import { useWslActions } from "./hooks/useWslActions";
import { useRemoteActions } from "./hooks/useRemoteActions";
import { useCrossDomainRefs } from "./hooks/useCrossDomainRefs";
import { useSessionBootstrap } from "./hooks/useSessionBootstrap";
import { useSessionPersistence } from "./hooks/useSessionPersistence";
import { useAppRefSync } from "./hooks/useAppRefSync";
import { useAppCallbacks } from "./hooks/useAppCallbacks";
import { useDelayedInit } from "./hooks/useDelayedInit";
import { useTerminalTabs } from "./hooks/useTerminalTabs";
import { useFileView } from "./hooks/useFileView";
import { SplashScreen } from "./components/SplashScreen";
import { AppProvider } from "./context/app-context";
import { SidebarProvider } from "./context/sidebar-context";
import type { AgentConfig } from "./types";

export type { ActiveWslKey, ActiveRemoteKey };

function App() {
   const { config, settingsOpen, setSettingsOpen, saveConfig } = useAppConfig();
   const { toast, showToast } = useToast();
   const local = useLocalProjects();

   const session = useSessionPersistence();
   const wsl = useWslProjects(session.saveSession);
   const remote = useRemoteProjects(session.saveSession);

   const {
      projects,
      setProjects,
      activeProjectId,
      setActiveProjectId,
      activeProject,
      setActiveProject,
      loading,
      pendingPath,
      setPendingPath,
      agents,
      activeProjectIdRef,
      selectProjectRef,
      activeProjectRef,
      isTerminalViewRef,
      loadProjects,
      loadAgents,
      handleAddProject,
      handleConfirmAddProject,
      handleRemoveProject,
      handleSelectProject,
      handleSelectFile,
      handleRefreshGit,
      handleOpenIde,
      handleDragEnd,
   } = local;

   const {
      wslEntries,
      setWslEntries,
      activeWslKey,
      setActiveWslKey,
      activeWslProject,
      setActiveWslProject,
      wslOpenSessions,
      setWslOpenSessions,
      wslDialogOpen,
      setWslDialogOpen,
      wslAddToEntryId,
      wslEntriesRef,
      activeWslKeyRef,
      selectWslProjectRef,
      handleWSLEntryAdd,
      handleCloseWslProject,
      handleRemoveWslProject,
      handleRemoveWslEntry,
      handleAddWslProject,
      handleWslDialogClose,
   } = wsl;

   const {
      remoteEntries,
      setRemoteEntries,
      activeRemoteKey,
      setActiveRemoteKey,
      activeRemoteProject,
      setActiveRemoteProject,
      remoteOpenSessions,
      setRemoteOpenSessions,
      remoteDialogOpen,
      setRemoteDialogOpen,
      remoteAddToEntryId,
      remoteAuthStore,
      setRemoteAuthStore,
      pendingAuthEntry,
      setPendingAuthEntry,
      remoteEntriesRef,
      activeRemoteKeyRef,
      selectRemoteProjectRef,
      handleRemoteEntryAdd,
      handleCloseRemoteProject,
      handleRemoveRemoteProject,
      handleRemoveRemoteEntry,
      handleAddRemoteProject,
      handleRemoteDialogClose,
      restoreAuthFromEntries,
   } = remote;

   const {
      activeWorktreePath,
      activeWorktreeBranch,
      openedWorktrees,
      activeWorktreePathRef,
      openedWorktreesRef,
      updateWtPath,
      setActiveWorktreePath,
      setActiveWorktreeBranch,
      setOpenedWorktrees,
      clearWorktreeForProject,
   } = useWorktreeState(activeProjectIdRef);

   useEffect(() => {
      if (!activeWorktreePath || !activeProject?.git_info) return;
      const exists = activeProject.git_info.worktrees.some((wt) => wt.path === activeWorktreePath);
      if (!exists) {
         setActiveWorktreePath(null);
         setActiveWorktreeBranch("");
      }
   }, [
      activeProject?.git_info?.worktrees,
      activeWorktreePath,
      setActiveWorktreePath,
      setActiveWorktreeBranch,
      activeProject?.git_info,
   ]);

   const xdomain = useCrossDomainRefs();

   const remoteActions = useRemoteActions({
      setActiveProjectId,
      setActiveProject,
      setActiveWslKey,
      setActiveWslProject,
      setRemoteEntries,
      setActiveRemoteKey,
      setActiveRemoteProject,
      activeRemoteProject,
      remoteEntries,
      remoteEntriesRef,
      remoteAuthStore,
      wslEntriesRefForSave: session.wslEntriesRefForSave,
      remoteEntriesRefForSave: session.remoteEntriesRefForSave,
      setWslDiffStateRef: xdomain.setWslDiffStateRef,
      wslActiveWtBranchSetterRef: xdomain.wslActiveWtBranchSetterRef,
      wslOpenedWtSetterRef: xdomain.wslOpenedWtSetterRef,
      wslWorktreePathSetterRef: xdomain.wslWorktreePathSetterRef,
      config,
      showToast,
      saveSession: session.saveSession,
   });

   const wslActions = useWslActions({
      setActiveProjectId,
      setActiveProject,
      setActiveRemoteKey,
      setActiveRemoteProject,
      setWslEntries,
      setActiveWslKey,
      setActiveWslProject,
      activeWslProject,
      wslEntries,
      wslEntriesRefForSave: session.wslEntriesRefForSave,
      remoteEntriesRefForSave: session.remoteEntriesRefForSave,
      setRemoteDiffStateRef: xdomain.setRemoteDiffStateRef,
      remoteActiveWtBranchSetterRef: xdomain.remoteActiveWtBranchSetterRef,
      remoteOpenedWtSetterRef: xdomain.remoteOpenedWtSetterRef,
      remoteWorktreePathSetterRef: xdomain.remoteWorktreePathSetterRef,
      config,
      showToast,
      saveSession: session.saveSession,
   });

   xdomain.setRemoteDiffStateRef.current = remoteActions.setRemoteDiffState;
   xdomain.remoteActiveWtBranchSetterRef.current = remoteActions.setRemoteActiveWtBranch;
   xdomain.remoteOpenedWtSetterRef.current = remoteActions.setRemoteOpenedWt;
   xdomain.remoteWorktreePathSetterRef.current = remoteActions.setActiveRemoteWorktreePath;
   xdomain.setWslDiffStateRef.current = wslActions.setWslDiffState;
   xdomain.wslActiveWtBranchSetterRef.current = wslActions.setWslActiveWtBranch;
   xdomain.wslOpenedWtSetterRef.current = wslActions.setWslOpenedWt;
   xdomain.wslWorktreePathSetterRef.current = wslActions.setActiveWslWorktreePath;

   const [worktreeDiffState, setWorktreeDiffState] = useState<{
      worktreePath: string;
      filePath: string;
   } | null>(null);

   useEffect(() => {
      setWorktreeDiffState(null);
   }, [activeProjectId]);

   const fileView = useFileView();

   const [gitViewState, setGitViewState] = useState<"hidden" | "open" | "minimized">("hidden");
   const handleToggleGitView = useCallback(() => {
      setGitViewState((prev) => (prev === "hidden" ? "open" : "hidden"));
   }, []);
   const handleMinimizeGitView = useCallback(() => {
      setGitViewState("minimized");
   }, []);
   const handleRestoreGitView = useCallback(() => {
      setGitViewState("open");
   }, []);

   const handleSelectProjectWithClear = useCallback(
      async (projectId: string) => {
         clearWorktreeForProject(projectId);
         setWorktreeDiffState(null);
         fileView.clearFileView();
         await handleSelectProject(projectId);
      },
      [clearWorktreeForProject, handleSelectProject, fileView]
   );

   const {
      getTabs,
      getActiveTab,
      getActiveTabId,
      ensureDefaultTab,
      addTab,
      closeTab,
      activateTab,
      updateTabStatus,
      handleAgentClick: handleTabAgentClick,
   } = useTerminalTabs();

   const currentProjectId =
      activeProject?.id ?? activeWslProject?.project.id ?? activeRemoteProject?.project.id ?? null;

   const selectedAgentId = activeProject?.selected_agent
      ?? activeWslProject?.project.selected_agent
      ?? activeRemoteProject?.project.selected_agent
      ?? null;

   useEffect(() => {
      if (currentProjectId) {
         const agentName = selectedAgentId
            ? (agents ?? []).find(a => a.id === selectedAgentId)?.name ?? undefined
            : undefined;
         ensureDefaultTab(currentProjectId, selectedAgentId, agentName);
      }
   }, [currentProjectId, selectedAgentId, agents, ensureDefaultTab]);

   const tabs = currentProjectId ? getTabs(currentProjectId) : [];
   const activeTabId = currentProjectId ? getActiveTabId(currentProjectId) : null;

   const handleAddTab = useCallback(() => {
      if (!currentProjectId) return;
      addTab(currentProjectId);
   }, [currentProjectId, addTab]);

   const handleCloseTab = useCallback(
      (tabId: string) => {
         if (!currentProjectId) return;
         closeTab(currentProjectId, tabId);
      },
      [currentProjectId, closeTab]
   );

   const handleActivateTab = useCallback(
      (tabId: string) => {
         if (!currentProjectId) return;
         activateTab(currentProjectId, tabId);
      },
      [currentProjectId, activateTab]
   );

   const handleTabStatusChange = useCallback(
      (tabId: string, status: "Idle" | "Running" | "Failed") => {
         if (!currentProjectId) return;
         updateTabStatus(currentProjectId, tabId, status);
      },
      [currentProjectId, updateTabStatus]
   );

   const handleFileSelect = useCallback(
      (filePath: string) => {
         if (activeProjectId) {
            fileView.openFile(activeProjectId, filePath);
         }
      },
      [activeProjectId, fileView.openFile]
   );

   const handleFileRefresh = useCallback(() => {
      if (activeProjectId) {
         fileView.loadFileTree(activeProjectId);
      }
   }, [activeProjectId, fileView.loadFileTree]);

   const { initialSidebarWidth, initializing } = useSessionBootstrap({
      loadProjects,
      setWslEntries,
      setRemoteEntries,
      worktreeStateRef: session.worktreeStateRef,
      restoreAuthFromEntries,
   });

   useDelayedInit({ loadAgents });

   const isTerminalView = activeProject?.active_view === "Terminal";
   useAppRefSync({
      wslEntries,
      activeWslKey,
      remoteEntries,
      activeRemoteKey,
      activeWorktreePath,
      openedWorktrees,
      activeProject,
      wslOpenedWt: wslActions.wslOpenedWt,
      activeWslWorktreePath: wslActions.activeWslWorktreePath,
      remoteOpenedWt: remoteActions.remoteOpenedWt,
      activeRemoteWorktreePath: remoteActions.activeRemoteWorktreePath,
      wslEntriesRef,
      activeWslKeyRef,
      remoteEntriesRef,
      activeRemoteKeyRef,
      activeWorktreePathRef,
      openedWorktreesRef,
      activeProjectRef,
      wslEntriesRefForSave: session.wslEntriesRefForSave,
      remoteEntriesRefForSave: session.remoteEntriesRefForSave,
      wslOpenedWtRef: wslActions.wslOpenedWtRef,
      activeWslWorktreePathRef: wslActions.activeWslWorktreePathRef,
      remoteOpenedWtRef: remoteActions.remoteOpenedWtRef,
      activeRemoteWorktreePathRef: remoteActions.activeRemoteWorktreePathRef,
      isTerminalViewRef,
      isTerminalView,
   });

   const callbacks = useAppCallbacks({
      agentCommandOverrides: config.agentCommandOverrides,
      terminalFontSize: config.terminalFontSize ?? 14,
      terminalShell: config.shell ?? "",
      terminalFontFamily: config.fontFamily ?? "",
      activeProject,
      projects,
      setProjects,
      setActiveProject,
      setActiveProjectId,
      handleOpenIde,
      showToast,
      activeWorktreePath,
      setActiveWorktreePath,
      setActiveWorktreeBranch,
      setOpenedWorktrees,
      activeProjectIdRef,
      saveWorktreeState: session.saveWorktreeState,
      setWorktreeDiffState,
      saveSession: session.saveSession,
      wslEntriesRefForSave: session.wslEntriesRefForSave,
      remoteEntriesRefForSave: session.remoteEntriesRefForSave,
      setWslDiffState: wslActions.setWslDiffState,
      setRemoteDiffState: remoteActions.setRemoteDiffState,
      pendingAuthEntry,
      setRemoteAuthStore,
      setPendingAuthEntry,
      setRemoteEntries,
      remoteEntriesRef,
      setActiveRemoteKey,
      setActiveRemoteProject,
      setSettingsOpen,
      handleAddProject,
      setWslDialogOpen,
      setRemoteDialogOpen,
   });

   useKeyboardShortcuts({
      projects,
      activeProjectId,
      wslEntriesRef,
      activeWslKeyRef,
      selectWslProjectRef,
      remoteEntriesRef,
      activeRemoteKeyRef,
      selectRemoteProjectRef,
      selectProjectRef,
      activeWorktreePathRef,
      openedWorktreesRef,
      updateWtPath,
      wslOpenedWtRef: wslActions.wslOpenedWtRef,
      activeWslWorktreePathRef: wslActions.activeWslWorktreePathRef,
      setWslWorktreePath: wslActions.setActiveWslWorktreePath,
      setWslWtBranch: wslActions.setWslActiveWtBranch,
      remoteOpenedWtRef: remoteActions.remoteOpenedWtRef,
      activeRemoteWorktreePathRef: remoteActions.activeRemoteWorktreePathRef,
      setRemoteWorktreePath: remoteActions.setActiveRemoteWorktreePath,
      setRemoteWtBranch: remoteActions.setRemoteActiveWtBranch,
      isTerminalViewRef,
      activeProjectRef,
      handleOpenIde: callbacks.handleOpenIdeCallback,
   });

   selectProjectRef.current = handleSelectProjectWithClear;

const handleAgentClick = useCallback(
       (agent: AgentConfig) => {
          if (!currentProjectId) return;
          const newTab = handleTabAgentClick(currentProjectId, agent);

          if (activeProject) {
             invoke("set_project_agent", { projectId: activeProject.id, agentId: agent.id }).catch((err: unknown) => {
                console.error("[TitleBar] Failed to set agent:", err);
             });
             const cacheKey = newTab ? `${activeProject.id}:${newTab.id}` : `${activeProject.id}:1`;
             callbacks.handleSelectLocalAgent(agent, cacheKey);
          } else if (activeWslProject) {
            wslActions.handleSelectWslAgent(agent);
         } else if (activeRemoteProject) {
            remoteActions.handleSelectRemoteAgent(agent);
         }
      },
      [
         currentProjectId,
         getActiveTab,
         handleTabAgentClick,
         activeProject,
         activeWslProject,
         activeRemoteProject,
         callbacks,
         wslActions,
         remoteActions,
      ]
   );

   const handleToggleHiddenAgent = useCallback(
      (agentId: string) => {
         const current = config.hiddenAgentIds ?? [];
         const next = current.includes(agentId)
            ? current.filter((id) => id !== agentId)
            : [...current, agentId];
         saveConfig({ ...config, hiddenAgentIds: next });
      },
      [config, saveConfig]
   );

   if (initializing) {
      return <SplashScreen />;
   }

   return (
      <div className="w-screen h-screen flex flex-col">
         <TitleBar
            activeProject={activeProject}
            activeWslProject={activeWslProject}
            activeRemoteProject={activeRemoteProject}
            activeWorktreeBranch={activeWorktreeBranch}
            activeWslWorktreeBranch={wslActions.wslActiveWtBranch}
            activeRemoteWorktreeBranch={remoteActions.remoteActiveWtBranch}
         />

         <AppProvider
            value={{
               config,
               agents: agents ?? [],
               agentInstalledMap: {},
               loading,
               ideCommandOverrides: config.ideCommandOverrides ?? {},
               showToast,
            }}
         >
            <SidebarProvider initialPanelWidth={initialSidebarWidth} onPanelWidthPersist={session.saveSidebarWidth}>
               <AppLayout
                  projects={projects}
                  activeProjectId={activeProjectId}
                  wslEntries={wslEntries}
                  remoteEntries={remoteEntries}
                  activeWslKey={activeWslKey}
                  activeRemoteKey={activeRemoteKey}
                  wslOpenSessions={wslOpenSessions}
                  remoteOpenSessions={remoteOpenSessions}
                  onAddProject={handleAddProject}
                  onAddWsl={callbacks.handleAddWslOrNoop}
                  onAddRemote={callbacks.handleAddRemoteClick}
                  onRemoveProject={handleRemoveProject}
                  onOpenSettings={callbacks.handleToggleSettings}
                  onSelectProject={handleSelectProjectWithClear}
                  onSelectFile={handleSelectFile}
                  onRefreshGit={handleRefreshGit}
                  onBackToMainTerminal={callbacks.handleBackToMainTerminal}
                  onOpenIde={callbacks.handleOpenIdeForSidebar}
                  onOpenWorktreeTerminal={callbacks.handleOpenWorktreeTerminal}
                  onSelectWorktreeFile={callbacks.handleSelectWorktreeFile}
                  onSelectWslProject={wslActions.handleSelectWslProject}
                  onCloseWslProject={handleCloseWslProject}
                  onRemoveWslProject={handleRemoveWslProject}
                  onRemoveWslEntry={handleRemoveWslEntry}
                  onAddWslProject={handleAddWslProject}
                  onSelectRemoteProject={remoteActions.handleSelectRemoteProject}
                  onCloseRemoteProject={handleCloseRemoteProject}
                  onRemoveRemoteProject={handleRemoveRemoteProject}
                  onRemoveRemoteEntry={handleRemoveRemoteEntry}
                  onAddRemoteProject={handleAddRemoteProject}
                  onSelectWslFile={wslActions.handleSelectWslFile}
                  onSelectRemoteFile={remoteActions.handleSelectRemoteFile}
                  onRefreshWslGit={wslActions.handleRefreshWslGit}
                  onRefreshRemoteGit={remoteActions.handleRefreshRemoteGit}
                  onOpenWslIde={wslActions.handleOpenWslIde}
                  onOpenRemoteIde={remoteActions.handleOpenRemoteIde}
                  onOpenWslWorktreeTerminal={wslActions.handleOpenWslWorktreeTerminal}
                  onOpenRemoteWorktreeTerminal={remoteActions.handleOpenRemoteWorktreeTerminal}
                  invokeRemoteGit={remoteActions.invokeRemoteGit}
                  onDragEnd={handleDragEnd}
                  onSaveProjectSettings={callbacks.handleSaveProjectSettings}
                  activeProject={activeProject}
                  activeWorktreePath={activeWorktreePath}
                  activeWorktreeBranch={activeWorktreeBranch}
                  handleSelectProject={handleSelectProjectWithClear}
                  handleAddProject={handleAddProject}
                   tabs={tabs}
                   activeTabId={activeTabId}
                   onActivateTab={handleActivateTab}
                   onCloseTab={handleCloseTab}
                   onAddTab={handleAddTab}
                   onTabStatusChange={handleTabStatusChange}
                   agents={agents}
                   compactMode={config.agentSelectorCompactMode ?? false}
                   showAgentBar={config.agentSelectorShowPresetBar !== false}
                   hiddenAgentIds={config.hiddenAgentIds ?? []}
                   onToggleHiddenAgent={handleToggleHiddenAgent}
                   onAgentClick={handleAgentClick}
                   showToast={showToast}
                  activeWslProject={activeWslProject}
                  activeWslWorktreePath={wslActions.activeWslWorktreePath}
                  setWslOpenSessions={setWslOpenSessions}
                  activeRemoteProject={activeRemoteProject}
                  activeRemoteWorktreePath={remoteActions.activeRemoteWorktreePath}
                  remoteAuthStore={remoteAuthStore}
                  setRemoteOpenSessions={setRemoteOpenSessions}
                   wslDiffState={wslActions.wslDiffState}
                   remoteDiffState={remoteActions.remoteDiffState}
                   worktreeDiffState={worktreeDiffState}
                   onWslDiffBack={callbacks.handleWslDiffBack}
                   onRemoteDiffBack={callbacks.handleRemoteDiffBack}
                   onWorktreeDiffBack={callbacks.handleWorktreeDiffBack}
                   // File view props
                   fileTree={fileView.fileTree}
                   fileTabs={fileView.tabs}
                   activeFileTabId={fileView.activeTabId}
                   fileViewLoading={fileView.isLoading}
                   activeFilePath={fileView.activeFilePath}
                   onFileSelect={handleFileSelect}
                   onFileRefresh={handleFileRefresh}
                   onFileCloseTab={fileView.closeTab}
                   onFileActivateTab={fileView.activateTab}
                   onFileSave={fileView.saveFile}
                   onFileContentChange={fileView.updateTabContent}
                   onLoadFileTree={fileView.loadFileTree}
                   gitViewState={gitViewState}
                   onToggleGitView={handleToggleGitView}
                   onMinimizeGitView={handleMinimizeGitView}
                   onRestoreGitView={handleRestoreGitView}
                />

               {pendingPath && (
                  <AddProjectModal
                     pendingPath={pendingPath}
                     onConfirm={handleConfirmAddProject}
                     onCancel={() => setPendingPath(null)}
                     loading={loading}
                  />
               )}

               {settingsOpen && <SettingsPanel onConfigChange={saveConfig} onClose={() => setSettingsOpen(false)} />}

               {IS_WINDOWS && (
                  <WSLDialog
                     isOpen={wslDialogOpen}
                     onClose={handleWslDialogClose}
                     onAdd={handleWSLEntryAdd}
                     existingEntries={wslEntries}
                     selectedEntryId={wslAddToEntryId ?? undefined}
                  />
               )}

               <RemoteDialog
                  isOpen={remoteDialogOpen}
                  onClose={handleRemoteDialogClose}
                  onAdd={handleRemoteEntryAdd}
                  existingEntries={remoteEntries}
                  addProjectMode={remoteAddToEntryId !== null}
                  selectedEntryId={remoteAddToEntryId ?? undefined}
                  existingEntryAuth={remoteAuthStore}
               />

               {pendingAuthEntry && (
                  <RemoteAuthDialog
                     isOpen={true}
                     host={pendingAuthEntry.host}
                     port={pendingAuthEntry.port}
                     username={pendingAuthEntry.username}
                     onCancel={callbacks.handleRemoteAuthCancel}
                     onSuccess={callbacks.handleRemoteAuthSuccess}
                  />
               )}
            </SidebarProvider>
         </AppProvider>

         <AppToast toast={toast} />
      </div>
   );
}

export default App;
