import React, { useCallback, useEffect } from "react";
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
import { useAgentActions } from "./useAgentActions";
import { useWorktreeActions } from "./useWorktreeActions";
import { useRemoteAuthActions } from "./useRemoteAuthActions";
import { useDelayedInit } from "./useDelayedInit";
import { useTerminalTabs } from "./useTerminalTabs";
import { useFileView } from "./useFileView";
import { useSyncToStore } from "./useSyncToStore";
import type { AgentConfig, RemoteProject, WSLProject } from "../types";
import { IS_WINDOWS } from "../utils/platform";
import { useAppStore } from "../store/appStore";

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

const noop = () => { };

export function useAppContainer(): UseAppContainerResult {
  const { config, settingsOpen, setSettingsOpen, saveConfig } = useAppConfig();
  const { toast, showToast } = useToast();
  const local = useLocalProjects();

  const session = useSessionPersistence();
  const wsl = useWslProjects(session.saveSession);
  const remote = useRemoteProjects(session.saveSession);

  const {
    activeProjectId,
    activeProject,
    loading,
    pendingPath,
    setPendingPath,
    agents,
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
    activeWslProject,
    wslOpenSessions,
    setWslOpenSessions,
    wslDialogOpen,
    setWslDialogOpen,
    wslAddToEntryId,
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
    activeRemoteProject,
    remoteOpenSessions,
    setRemoteOpenSessions,
    remoteDialogOpen,
    setRemoteDialogOpen,
    remoteAddToEntryId,
    remoteAuthStore,
    pendingAuthEntry,
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
    updateWtPath,
    setActiveWorktreePath,
    setActiveWorktreeBranch,
    setOpenedWorktrees,
    clearWorktreeForProject,
  } = useWorktreeState(activeProjectId);

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
    config,
    showToast,
    saveSession: session.saveSession,
  });

  const wslActions = useWslActions({
    config,
    showToast,
    saveSession: session.saveSession,
  });

  const setWorktreeDiffState = useCallback(
    (next: { worktreePath: string; filePath: string } | null) => {
      useAppStore.setState({ worktreeDiffState: next });
    },
    [],
  );

  useEffect(() => {
    setWorktreeDiffState(null);
  }, [activeProjectId, setWorktreeDiffState]);

  const agentActions = useAgentActions({
    terminal: {
      fontSize: config.terminalFontSize ?? 14,
      shell: config.shell ?? "",
      fontFamily: config.fontFamily ?? "",
    },
    agentCommandOverrides: config.agentCommandOverrides,
    handleOpenIde,
    showToast,
    saveSession: session.saveSession,
  });

  const worktreeActions = useWorktreeActions({
    setActiveWorktreePath,
    setActiveWorktreeBranch,
    setOpenedWorktrees,
    setWorktreeDiffState,
    saveWorktreeState: session.saveWorktreeState,
  });

  const remoteAuthActions = useRemoteAuthActions({
    saveSession: session.saveSession,
  });

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

  useEffect(() => {
    if (currentProjectId) {
      const existing = getTabs(currentProjectId);
      if (existing.length > 0) {
        ensureDefaultTab(currentProjectId);
      }
    }
  }, [currentProjectId, getTabs, ensureDefaultTab]);

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

  const handleWslDiffBack = useCallback(() => {
    wslActions.setWslDiffState(null);
  }, [wslActions.setWslDiffState]);

  const handleRemoteDiffBack = useCallback(() => {
    remoteActions.setRemoteDiffState(null);
  }, [remoteActions.setRemoteDiffState]);

  const handleToggleSettings = useCallback(() => {
    setSettingsOpen((value) => !value);
  }, [setSettingsOpen]);

  const handleAddWslClick = useCallback(() => {
    setWslDialogOpen(true);
  }, [setWslDialogOpen]);

  const handleAddRemoteClick = useCallback(() => {
    setRemoteDialogOpen(true);
  }, [setRemoteDialogOpen]);

  const handleAddWslOrNoop = IS_WINDOWS ? handleAddWslClick : noop;

  const { initialSidebarWidth, initializing } = useSessionBootstrap({
    loadProjects,
    setWslEntries,
    setRemoteEntries,
    restoreWorktreeState: session.restoreWorktreeState,
    restoreAuthFromEntries,
  });

  useDelayedInit({ loadAgents });

  const isTerminalView = activeProject?.active_view === "Terminal";

  useSyncToStore({
    isTerminalView: isTerminalView || activeWorktreePath !== null,
    wslEntries,
    activeWslKey,
    activeWslProject,
    remoteEntries,
    activeRemoteKey,
    activeRemoteProject,
    remoteAuthStore,
    pendingAuthEntry,
    activeWorktreePath,
    activeWorktreeBranch,
    openedWorktrees,
    wslOpenedWt: wslActions.wslOpenedWt,
    activeWslWorktreePath: wslActions.activeWslWorktreePath,
    remoteOpenedWt: remoteActions.remoteOpenedWt,
    activeRemoteWorktreePath: remoteActions.activeRemoteWorktreePath,
    worktreeState: session.worktreeState,
    selectProject: handleSelectProjectWithClear,
    selectWslProject: handleSelectWslProjectWithSync,
    selectRemoteProject: handleSelectRemoteProjectWithSync,
    openIde: agentActions.handleOpenIdeCallback,
  });

  useKeyboardShortcuts({
    updateWtPath,
    setWslWorktreePath: wslActions.setActiveWslWorktreePath,
    setWslWtBranch: wslActions.setWslActiveWtBranch,
    setRemoteWorktreePath: remoteActions.setActiveRemoteWorktreePath,
    setRemoteWtBranch: remoteActions.setRemoteActiveWtBranch,
    activeTabId,
    onCloseTab: handleCloseTab,
  });

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
        agentActions.handleSelectLocalAgent(agent, cacheKey);
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
      agentActions,
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

  const projectActionsValue = {
    onRemoveProject: handleRemoveProject,
    onSelectProject: handleSelectProjectWithClear,
    onAddProject: handleAddProject,
    onSelectFile: handleSelectFile,
    onRefreshGit: handleRefreshGit,
    onBackToMainTerminal: worktreeActions.handleBackToMainTerminal,
    onOpenIde: agentActions.handleOpenIdeForSidebar,
    onOpenWorktreeTerminal: worktreeActions.handleOpenWorktreeTerminal,
    onSelectWorktreeFile: worktreeActions.handleSelectWorktreeFile,
    onDragEnd: handleDragEnd,
    onSaveProjectSettings: agentActions.handleSaveProjectSettings,
    onWorktreeDiffBack: worktreeActions.handleWorktreeDiffBack,
  };

  const fileActionsValue = {
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
    onWslDiffBack: handleWslDiffBack,
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
    onRemoteDiffBack: handleRemoteDiffBack,
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
    projectActionsValue,
    fileActionsValue,
    wslValue,
    remoteValue,
    editorValue,
  };

  const appLayoutProps: AppLayoutProps = {
    onAddProject: handleAddProject,
    onAddWsl: handleAddWslOrNoop,
    onAddRemote: handleAddRemoteClick,
    onOpenSettings: handleToggleSettings,
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
      onCancel: remoteAuthActions.handleRemoteAuthCancel,
      onSuccess: remoteAuthActions.handleRemoteAuthSuccess,
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
