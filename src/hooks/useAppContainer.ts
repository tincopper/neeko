import React, { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type AppProviders from "../AppProviders";
import type AppModals from "../AppModals";
import type AppLayout from "../components/layout/AppLayout";
import type { TitleBar } from "../components/layout";
import { useToast } from "./useToast";
import { useWorktreeState } from "./useWorktreeState";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";
import { useAppConfig } from "./useAppConfig";
import { useLocalProjects } from "./useLocalProjects";
import { useWslProjects } from "./useWslProjects";
import { useRemoteProjects } from "./useRemoteProjects";
import { useWslActions } from "./useWslActions";
import { useRemoteActions } from "./useRemoteActions";
import { useSessionBootstrap } from "./useSessionBootstrap";
import { useSessionPersistence } from "./useSessionPersistence";
import { useAppRefSync } from "./useAppRefSync";
import { useAppCallbacks } from "./useAppCallbacks";
import { useDelayedInit } from "./useDelayedInit";
import { useTerminalTabs } from "./useTerminalTabs";
import { useFileView } from "./useFileView";
import type { AgentConfig, RemoteProject, WSLProject } from "../types";

type AppProvidersProps = Omit<React.ComponentProps<typeof AppProviders>, "children">;
type AppLayoutProps = React.ComponentProps<typeof AppLayout>;
type AppModalsProps = React.ComponentProps<typeof AppModals>;
type TitleBarProps = React.ComponentProps<typeof TitleBar>;

interface UseAppContainerResult {
  initializing: boolean;
  toast: ReturnType<typeof useToast>["toast"];
  titleBarProps: TitleBarProps;
  appProvidersProps: AppProvidersProps;
  appLayoutProps: AppLayoutProps;
  appModalsProps: AppModalsProps;
}

export function useAppContainer(): UseAppContainerResult {
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
    const exists = activeProject.git_info.worktrees.some(
      (wt) => wt.path === activeWorktreePath,
    );
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
    config,
    showToast,
    saveSession: session.saveSession,
  });

  const [worktreeDiffState, setWorktreeDiffState] = useState<{
    worktreePath: string;
    filePath: string;
  } | null>(null);

  useEffect(() => {
    setWorktreeDiffState(null);
  }, [activeProjectId]);

  const fileView = useFileView();

  const handleSelectProjectWithClear = useCallback(
    async (projectId: string) => {
      clearWorktreeForProject(projectId);
      setWorktreeDiffState(null);
      fileView.clearFileView();
      await handleSelectProject(projectId);
    },
    [clearWorktreeForProject, handleSelectProject, fileView],
  );

  const clearWslTransientState = useCallback(() => {
    wslActions.setWslDiffState(null);
    wslActions.setActiveWslWorktreePath(null);
    wslActions.setWslActiveWtBranch("");
    wslActions.setWslOpenedWt([]);
  }, [
    wslActions.setWslDiffState,
    wslActions.setActiveWslWorktreePath,
    wslActions.setWslActiveWtBranch,
    wslActions.setWslOpenedWt,
  ]);

  const clearRemoteTransientState = useCallback(() => {
    remoteActions.setRemoteDiffState(null);
    remoteActions.setActiveRemoteWorktreePath(null);
    remoteActions.setRemoteActiveWtBranch("");
    remoteActions.setRemoteOpenedWt([]);
  }, [
    remoteActions.setRemoteDiffState,
    remoteActions.setActiveRemoteWorktreePath,
    remoteActions.setRemoteActiveWtBranch,
    remoteActions.setRemoteOpenedWt,
  ]);

  const handleSelectWslProjectWithSync = useCallback(
    (distro: string, project: WSLProject) => {
      clearRemoteTransientState();
      wslActions.handleSelectWslProject(distro, project);
    },
    [clearRemoteTransientState, wslActions.handleSelectWslProject],
  );

  const handleOpenWslWorktreeTerminalWithSync = useCallback(
    (distro: string, worktreePath: string, branch: string) => {
      clearRemoteTransientState();
      wslActions.handleOpenWslWorktreeTerminal(distro, worktreePath, branch);
    },
    [clearRemoteTransientState, wslActions.handleOpenWslWorktreeTerminal],
  );

  const handleSelectRemoteProjectWithSync = useCallback(
    (host: string, project: RemoteProject) => {
      clearWslTransientState();
      remoteActions.handleSelectRemoteProject(host, project);
    },
    [clearWslTransientState, remoteActions.handleSelectRemoteProject],
  );

  const handleOpenRemoteWorktreeTerminalWithSync = useCallback(
    (entryId: string, worktreePath: string, branch: string) => {
      clearWslTransientState();
      remoteActions.handleOpenRemoteWorktreeTerminal(entryId, worktreePath, branch);
    },
    [clearWslTransientState, remoteActions.handleOpenRemoteWorktreeTerminal],
  );

  const {
    getTabs,
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

  const selectedAgentId =
    activeProject?.selected_agent ??
    activeWslProject?.project.selected_agent ??
    activeRemoteProject?.project.selected_agent ??
    null;

  useEffect(() => {
    if (currentProjectId) {
      const agentName = selectedAgentId
        ? (agents ?? []).find((a) => a.id === selectedAgentId)?.name ?? undefined
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
    [currentProjectId, closeTab],
  );

  const handleActivateTab = useCallback(
    (tabId: string) => {
      if (!currentProjectId) return;
      activateTab(currentProjectId, tabId);
    },
    [currentProjectId, activateTab],
  );

  const handleTabStatusChange = useCallback(
    (tabId: string, status: "Idle" | "Running" | "Failed") => {
      if (!currentProjectId) return;
      updateTabStatus(currentProjectId, tabId, status);
    },
    [currentProjectId, updateTabStatus],
  );

  const handleFileSelect = useCallback(
    (filePath: string) => {
      if (activeProjectId) {
        fileView.openFile(activeProjectId, filePath);
      }
    },
    [activeProjectId, fileView.openFile],
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
  selectWslProjectRef.current = handleSelectWslProjectWithSync;
  selectRemoteProjectRef.current = handleSelectRemoteProjectWithSync;

  const handleAgentClick = useCallback(
    (agent: AgentConfig) => {
      if (!currentProjectId) return;
      const newTab = handleTabAgentClick(currentProjectId, agent);

      if (activeProject) {
        invoke("set_project_agent", {
          projectId: activeProject.id,
          agentId: agent.id,
        }).catch((err: unknown) => {
          console.error("[TitleBar] Failed to set agent:", err);
        });
        const cacheKey = newTab
          ? `${activeProject.id}:${newTab.id}`
          : `${activeProject.id}:1`;
        callbacks.handleSelectLocalAgent(agent, cacheKey);
      } else if (activeWslProject) {
        wslActions.handleSelectWslAgent(agent);
      } else if (activeRemoteProject) {
        remoteActions.handleSelectRemoteAgent(agent);
      }
    },
    [
      currentProjectId,
      handleTabAgentClick,
      activeProject,
      activeWslProject,
      activeRemoteProject,
      callbacks,
      wslActions,
      remoteActions,
    ],
  );

  const handleToggleHiddenAgent = useCallback(
    (agentId: string) => {
      const current = config.hiddenAgentIds ?? [];
      const next = current.includes(agentId)
        ? current.filter((id) => id !== agentId)
        : [...current, agentId];
      saveConfig({ ...config, hiddenAgentIds: next });
    },
    [config, saveConfig],
  );

  const projectStateValue = {
    projects,
    activeProjectId,
    activeProject,
    activeWorktreePath,
    activeWorktreeBranch,
    worktreeDiffState,
    fileTree: fileView.fileTree,
    fileTabs: fileView.tabs,
    activeFileTabId: fileView.activeTabId,
    fileViewLoading: fileView.isLoading,
    activeFilePath: fileView.activeFilePath,
  };

  const projectActionsValue = {
    onRemoveProject: handleRemoveProject,
    onSelectProject: handleSelectProjectWithClear,
    onSelectFile: handleSelectFile,
    onRefreshGit: handleRefreshGit,
    onBackToMainTerminal: callbacks.handleBackToMainTerminal,
    onOpenIde: callbacks.handleOpenIdeForSidebar,
    onOpenWorktreeTerminal: callbacks.handleOpenWorktreeTerminal,
    onSelectWorktreeFile: callbacks.handleSelectWorktreeFile,
    onDragEnd: handleDragEnd,
    onSaveProjectSettings: callbacks.handleSaveProjectSettings,
    handleSelectProject: handleSelectProjectWithClear,
    handleAddProject,
    onWorktreeDiffBack: callbacks.handleWorktreeDiffBack,
    onFileSelect: handleFileSelect,
    onFileRefresh: handleFileRefresh,
    onFileCloseTab: fileView.closeTab,
    onFileActivateTab: fileView.activateTab,
    onFileSave: fileView.saveFile,
    onFileContentChange: fileView.updateTabContent,
    onLoadFileTree: fileView.loadFileTree,
  };

  const wslValue = {
    wslEntries,
    activeWslKey,
    wslOpenSessions,
    activeWslProject,
    activeWslWorktreePath: wslActions.activeWslWorktreePath,
    wslDiffState: wslActions.wslDiffState,
    setWslOpenSessions,
    onSelectWslProject: handleSelectWslProjectWithSync,
    onCloseWslProject: handleCloseWslProject,
    onRemoveWslProject: handleRemoveWslProject,
    onRemoveWslEntry: handleRemoveWslEntry,
    onAddWslProject: handleAddWslProject,
    onSelectWslFile: wslActions.handleSelectWslFile,
    onRefreshWslGit: wslActions.handleRefreshWslGit,
    onOpenWslIde: wslActions.handleOpenWslIde,
    onOpenWslWorktreeTerminal: handleOpenWslWorktreeTerminalWithSync,
    onWslDiffBack: callbacks.handleWslDiffBack,
  };

  const remoteValue = {
    remoteEntries,
    activeRemoteKey,
    remoteOpenSessions,
    activeRemoteProject,
    activeRemoteWorktreePath: remoteActions.activeRemoteWorktreePath,
    remoteAuthStore,
    remoteDiffState: remoteActions.remoteDiffState,
    setRemoteOpenSessions,
    onSelectRemoteProject: handleSelectRemoteProjectWithSync,
    onCloseRemoteProject: handleCloseRemoteProject,
    onRemoveRemoteProject: handleRemoveRemoteProject,
    onRemoveRemoteEntry: handleRemoveRemoteEntry,
    onAddRemoteProject: handleAddRemoteProject,
    onSelectRemoteFile: remoteActions.handleSelectRemoteFile,
    onRefreshRemoteGit: remoteActions.handleRefreshRemoteGit,
    onOpenRemoteIde: remoteActions.handleOpenRemoteIde,
    onOpenRemoteWorktreeTerminal: handleOpenRemoteWorktreeTerminalWithSync,
    invokeRemoteGit: remoteActions.invokeRemoteGit,
    onRemoteDiffBack: callbacks.handleRemoteDiffBack,
  };

  const editorValue = {
    tabs,
    activeTabId,
    onActivateTab: handleActivateTab,
    onCloseTab: handleCloseTab,
    onAddTab: handleAddTab,
    onTabStatusChange: handleTabStatusChange,
    agents: agents ?? [],
    compactMode: config.agentSelectorCompactMode ?? false,
    showAgentBar: config.agentSelectorShowPresetBar !== false,
    hiddenAgentIds: config.hiddenAgentIds ?? [],
    onToggleHiddenAgent: handleToggleHiddenAgent,
    onAgentClick: handleAgentClick,
  };

  const titleBarProps: TitleBarProps = {
    activeProject,
    activeWslProject,
    activeRemoteProject,
    activeWorktreeBranch,
    activeWslWorktreeBranch: wslActions.wslActiveWtBranch,
    activeRemoteWorktreeBranch: remoteActions.remoteActiveWtBranch,
  };

  const appProvidersProps: AppProvidersProps = {
    appValue: {
      config,
      agents: agents ?? [],
      agentInstalledMap: {},
      loading,
      ideCommandOverrides: config.ideCommandOverrides ?? {},
      showToast,
    },
    initialSidebarWidth,
    onSidebarWidthPersist: session.saveSidebarWidth,
    projectStateValue,
    projectActionsValue,
    wslValue,
    remoteValue,
    editorValue,
  };

  const appLayoutProps: AppLayoutProps = {
    onAddProject: handleAddProject,
    onAddWsl: callbacks.handleAddWslOrNoop,
    onAddRemote: callbacks.handleAddRemoteClick,
    onOpenSettings: callbacks.handleToggleSettings,
  };

  const appModalsProps: AppModalsProps = {
    addProject: {
      pendingPath,
      onConfirm: handleConfirmAddProject,
      onCancel: () => setPendingPath(null),
      loading,
    },
    settings: {
      open: settingsOpen,
      onConfigChange: saveConfig,
      onClose: () => setSettingsOpen(false),
    },
    wsl: {
      open: wslDialogOpen,
      onClose: handleWslDialogClose,
      onAddWslEntry: handleWSLEntryAdd,
      entries: wslEntries,
      addToEntryId: wslAddToEntryId,
    },
    remote: {
      open: remoteDialogOpen,
      onClose: handleRemoteDialogClose,
      onAddRemoteEntry: handleRemoteEntryAdd,
      entries: remoteEntries,
      addToEntryId: remoteAddToEntryId,
      authStore: remoteAuthStore,
    },
    remoteAuth: {
      pendingAuthEntry,
      onCancel: callbacks.handleRemoteAuthCancel,
      onSuccess: callbacks.handleRemoteAuthSuccess,
    },
  };

  return {
    initializing,
    toast,
    titleBarProps,
    appProvidersProps,
    appLayoutProps,
    appModalsProps,
  };
}
