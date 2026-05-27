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
import { useProjectStore } from "../store/projectStore";
import { useConnectionStore } from "../store/connectionStore";
import { useWorktreeStore } from "../store/worktreeStore";
import { useEditorStore } from "../store/editorStore";
import { useAppViewStore } from "../store/appViewStore";
import { useFileView } from "./useFileView";
import { useActiveProject } from "./useActiveProject";
import type { AgentConfig, AuthMethod, RemoteEntrySession, RemoteProject, WSLEntrySession, WSLProject } from "../types";
import { buildWorktreeTabKey } from "../utils/tabKey";
import { useFileTabRefresh } from "./useFileTabRefresh";
import { useAppLayoutProps } from "./useAppLayoutProps";
import { useTitleBarProps } from "./useTitleBarProps";
import { useProjectSelection } from "./useProjectSelection";
import { useAppModalsProps } from "./useAppModalsProps";

const APP_SETTINGS_PROJECT_ID = "__app__";

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
  const { config, saveConfig } = useAppConfig();
  const { toast, showToast } = useToast();
  const local = useLocalProjects();

  const session = useSessionPersistence();
  const wsl = useWslProjects(session.saveSession);
  const remote = useRemoteProjects(session.saveSession, showToast);

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
    handleWslDragEnd,
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
    setPendingAuthEntry,
    handleRemoteEntryAdd,
    handleCloseRemoteProject,
    handleRemoveRemoteProject,
    handleRemoveRemoteEntry,
    handleAddRemoteProject,
    handleRemoteDialogClose,
    handleRemoteDragEnd,
    restoreAuthFromEntries,
  } = remote;

  const {
    activeWorktreePath,
    activeWorktreeBranch,
    updateWtPath,
    setActiveWorktreePath,
    setActiveWorktreeBranch,
    setOpenedWorktrees,
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

  const agentActions = useAgentActions({
    terminal: {
      fontSize: config.terminalFontSize ?? 14,
      shell: config.shell ?? "",
      fontFamily: config.fontFamily ?? "",
      gpuAcceleration: config.terminalGpuAcceleration ?? false,
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
    saveWorktreeState: session.saveWorktreeState,
  });

  const remoteAuthActions = useRemoteAuthActions({
    saveSession: session.saveSession,
  });

  const activeContext = useActiveProject();
  const fileView = useFileView(activeContext.commands, activeContext.worktreePath);
  const { selectProject } = useProjectSelection();

  // Close settings view if open (when switching projects)
  const closeSettingsView = useCallback(() => {
    if (useAppViewStore.getState().appView === "settings") {
      useAppViewStore.getState().setAppView("normal");
    }
  }, []);

  // clearWslTransientState and clearRemoteTransientState removed.
  // WSL/Remote transient worktree state (path / branch / openedWt) now lives
  // in worktreeStore directly — clearing happens via resetWslTransientState /
  // resetRemoteTransientState or inline in handleSelectProjectWithClear.

  const handleSelectProjectWithClear = useCallback(
    async (projectId: string) => {
      closeSettingsView();
      wslActions.setWslDiffState(null);
      await selectProject(projectId);
    },
    [closeSettingsView, wslActions.setWslDiffState, selectProject],
  );

  const handleSelectWslProjectWithSync = useCallback(
    (distro: string, project: WSLProject) => {
      closeSettingsView();
      remoteActions.resetRemoteTransientState();
      wslActions.handleSelectWslProject(distro, project);
    },
    [closeSettingsView, remoteActions.resetRemoteTransientState, wslActions.handleSelectWslProject],
  );

  const handleOpenWslWorktreeTerminalWithSync = useCallback(
    (distro: string, worktreePath: string, branch: string) => {
      remoteActions.resetRemoteTransientState();
      wslActions.handleOpenWslWorktreeTerminal(distro, worktreePath, branch);
    },
    [remoteActions.resetRemoteTransientState, wslActions.handleOpenWslWorktreeTerminal],
  );

  const handleSelectRemoteProjectWithSync = useCallback(
    (host: string, project: RemoteProject) => {
      closeSettingsView();
      wslActions.resetWslTransientState();
      remoteActions.handleSelectRemoteProject(host, project);
    },
    [closeSettingsView, wslActions.resetWslTransientState, remoteActions.handleSelectRemoteProject],
  );

  const handleOpenRemoteWorktreeTerminalWithSync = useCallback(
    (entryId: string, worktreePath: string, branch: string) => {
      wslActions.resetWslTransientState();
      remoteActions.handleOpenRemoteWorktreeTerminal(entryId, worktreePath, branch);
    },
    [wslActions.resetWslTransientState, remoteActions.handleOpenRemoteWorktreeTerminal],
  );

  const {
    getTabs,
    ensureDefaultTab,
    addTab,
    activateTab,
    updateTabStatus,
    handleAgentClick: handleTabAgentClick,
  } = useTerminalTabs();

  const currentProjectId =
    activeProject?.id ?? activeWslProject?.project.id ?? activeRemoteProject?.project.id ?? null;

  // Tab key: composite when worktree is active, plain projectId otherwise
  // Each worktree gets its own independent tab space (like a separate project)
  // Fallback to __app__ when no project is selected (e.g. before project load)
  const tabKey = activeWorktreePath && currentProjectId
    ? buildWorktreeTabKey(currentProjectId, activeWorktreePath)
    : (currentProjectId ?? APP_SETTINGS_PROJECT_ID);

  // activeTabId 恢复已内联到 setActiveProjectId（useLocalProjects）和
  // setActiveWorktreePath（useWorktreeState）中，与项目/worktree 切换在同一
  // 个 appStore.setState 内完成，不再需要 useEffect 额外渲染。

  useEffect(() => {
    if (!tabKey) return;

    // __app__ space: no default terminal needed
    if (tabKey === APP_SETTINGS_PROJECT_ID) return;

    // Local 项目（非 worktree）：不自动创建 tab，让 ProjectGuidePage 引导用户
    if (activeProject && !activeWorktreePath) return;

    // 检查项目是否有任何类型的 tab（不仅是 terminal）
    const projectTabs = useEditorStore.getState().tabs[tabKey];
    const hasAnyTabs = projectTabs && projectTabs.tabs.length > 0;

    if (!hasAnyTabs) {
      // 只有在项目没有任何 tab 时才创建默认终端（WSL/Remote 场景）
      const agentId = activeProject?.selected_agent ?? null;
      const agentName = agentId ? (agents?.find((a) => a.id === agentId)?.name ?? undefined) : undefined;
      ensureDefaultTab(tabKey, agentId, agentName);
    }
    // 如果项目已有 tab（任何类型），不做任何操作，保留用户之前的 tab 状态
  }, [tabKey, ensureDefaultTab, activeProject?.selected_agent, agents, activeProject, activeWorktreePath]);

  const tabs = tabKey ? getTabs(tabKey) : [];
  const activeTabId = useEditorStore((state) => state.activeTabId);

  const handleAddTab = useCallback(() => {
    if (!tabKey) return;
    addTab(tabKey);
  }, [tabKey, addTab]);

  const handleCloseTab = useCallback(
    (tabId: string) => {
      const state = useEditorStore.getState();
      // Find which project this tab belongs to and close it
      for (const [projectId, pt] of Object.entries(state.tabs)) {
        if (pt.tabs.some((t) => t.id === tabId)) {
          state.closeTab(projectId, tabId);
          return;
        }
      }
    },
    [],
  );

  const handleActivateTab = useCallback(
    (tabId: string) => {
      if (!tabKey) return;
      activateTab(tabKey, tabId);
    },
    [tabKey, activateTab],
  );

  const handleToggleTerminal = useCallback(() => {
    // fileViewOpen removed — toggleTerminal is currently a no-op
  }, []);

  const handleTabStatusChange = useCallback(
    (tabId: string, status: "Idle" | "Running" | "Failed") => {
      if (!tabKey) return;
      updateTabStatus(tabKey, tabId, status);
    },
    [tabKey, updateTabStatus],
  );

  const handleFileSelect = useCallback(
    (filePath: string) => {
      fileView.openFile(filePath);
    },
    [fileView.openFile],
  );

  const handleFileRefresh = useCallback(() => {
    const projectId = useProjectStore.getState().activeProjectId
      ?? useConnectionStore.getState().activeWslProject?.project.id
      ?? useConnectionStore.getState().activeRemoteProject?.project.id
      ?? null;
    if (!projectId) return;
    const rootPath = useWorktreeStore.getState().activeWorktreePath
      ?? useWorktreeStore.getState().activeWslWorktreePath
      ?? useWorktreeStore.getState().activeRemoteWorktreePath
      ?? useProjectStore.getState().activeProject?.path
      ?? useConnectionStore.getState().activeWslProject?.project.path
      ?? useConnectionStore.getState().activeRemoteProject?.project.path
      ?? undefined;
    fileView.loadFileTree(projectId, rootPath);
  }, [fileView.loadFileTree]);

  const handleWslDiffBack = useCallback(() => {
    wslActions.setWslDiffState(null);
  }, [wslActions.setWslDiffState]);

  const { initializing } = useSessionBootstrap({
    loadProjects,
    setWslEntries,
    setRemoteEntries,
    restoreWorktreeState: session.restoreWorktreeState,
    restoreAuthFromEntries,
  });

  // 监听文件系统变更事件，刷新已打开的 file tab 内容
  useFileTabRefresh();

  // Refresh git info for WSL/Remote projects on startup (similar to local projects in useSessionBootstrap)
  const initialWslRemoteRefreshDone = React.useRef(false);
  useEffect(() => {
    if (initializing || initialWslRemoteRefreshDone.current) return;
    initialWslRemoteRefreshDone.current = true;

    // Refresh WSL git info for projects without it
    for (const entry of wslEntries) {
      for (const project of entry.projects) {
        if (!project.git_info) {
          void wslActions.handleRefreshWslGit(entry.distro, project.id, project.path);
        }
      }
    }

    // Refresh Remote git info for projects without it (requires auth)
    for (const entry of remoteEntries) {
      if (!remoteAuthStore.has(entry.id)) continue;
      for (const project of entry.projects) {
        if (!project.git_info) {
          void remoteActions.handleRefreshRemoteGit(entry.id, project.id, project.path);
        }
      }
    }
  }, [initializing, wslEntries, remoteEntries, remoteAuthStore, wslActions, remoteActions]);

  useDelayedInit({ loadAgents });

  const isTerminalView = activeProject?.active_view === "Terminal";

  useEffect(() => {
    useProjectStore.setState({
      isTerminalView: isTerminalView || activeWorktreePath !== null,
      selectProject: handleSelectProjectWithClear,
      openIde: agentActions.handleOpenIdeCallback,
      setProjectIde: agentActions.handleSetProjectIde,
    });
  }, [isTerminalView, activeWorktreePath, handleSelectProjectWithClear, agentActions.handleOpenIdeCallback, agentActions.handleSetProjectIde]);

  useEffect(() => {
    useConnectionStore.setState({
      selectWslProject: handleSelectWslProjectWithSync,
      selectRemoteProject: handleSelectRemoteProjectWithSync,
    });
  }, [handleSelectWslProjectWithSync, handleSelectRemoteProjectWithSync]);

  useKeyboardShortcuts({
    updateWtPath,
    setWslWorktreePath: wslActions.setActiveWslWorktreePath,
    setWslWtBranch: wslActions.setWslActiveWtBranch,
    setRemoteWorktreePath: remoteActions.setActiveRemoteWorktreePath,
    setRemoteWtBranch: remoteActions.setRemoteActiveWtBranch,
    activeTabId,
    onCloseTab: handleCloseTab,
    shortcuts: config.shortcuts,
    onToggleTerminal: handleToggleTerminal,
  });

  const handleAgentClick = useCallback(
    (agent: AgentConfig) => {
      if (!tabKey) return;
      const newTab = handleTabAgentClick(tabKey, agent);

      if (activeProject) {
        invoke("set_project_agent", {
          projectId: activeProject.id,
          agentId: agent.id,
        }).catch((err: unknown) => {
          console.error("[TitleBar] Failed to set agent:", err);
        });
        if (!newTab) {
          const cacheKey = `${activeProject.id}:1`;
          agentActions.handleSelectLocalAgent(agent, cacheKey);
        }
      } else if (activeWslProject) {
        if (newTab) {
          wslActions.updateWslProjectAgent(agent);
        } else {
          wslActions.handleSelectWslAgent(agent);
        }
      } else if (activeRemoteProject) {
        if (newTab) {
          remoteActions.updateRemoteProjectAgent(agent);
        } else {
          remoteActions.handleSelectRemoteAgent(agent);
        }
      }
    },
    [
      tabKey,
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
  };

  const fileActionsValue = {
    onFileSelect: handleFileSelect,
    onFileRefresh: handleFileRefresh,
    onFileCloseTab: fileView.closeTab,
    onFileActivateTab: fileView.activateTab,
    onFileSave: fileView.saveFile,
    onFileContentChange: fileView.updateTabContent,
    onLoadFileTree: fileView.loadFileTree,
    onExpandDir: fileView.expandSubTree,
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
    onWslDragEnd: handleWslDragEnd,
  };

  const remoteValue = {
    remoteEntries,
    activeRemoteKey,
    remoteOpenSessions,
    activeRemoteProject,
    activeRemoteWorktreePath: remoteActions.activeRemoteWorktreePath,
    remoteAuthStore,
    setRemoteOpenSessions,
    onSelectRemoteProject: handleSelectRemoteProjectWithSync,
    onCloseRemoteProject: handleCloseRemoteProject,
    onRemoveRemoteProject: handleRemoveRemoteProject,
    onRemoveRemoteEntry: handleRemoveRemoteEntry,
    onAddRemoteProject: handleAddRemoteProject,
    onRefreshRemoteGit: remoteActions.handleRefreshRemoteGit,
    onOpenRemoteIde: remoteActions.handleOpenRemoteIde,
    onOpenRemoteWorktreeTerminal: handleOpenRemoteWorktreeTerminalWithSync,
    invokeRemoteGit: remoteActions.invokeRemoteGit,
    onRemoteDragEnd: handleRemoteDragEnd,
    setPendingAuthEntry,
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

  const titleBarProps = useTitleBarProps({
    activeProject,
    activeWslProject,
    activeRemoteProject,
    activeWorktreeBranch,
    handleRefreshGit,
    handleRefreshWslGit: wslActions.handleRefreshWslGit,
    handleRefreshRemoteGit: remoteActions.handleRefreshRemoteGit,
    wslActiveWtBranch: wslActions.wslActiveWtBranch,
    remoteActiveWtBranch: remoteActions.remoteActiveWtBranch,
    checkoutBranch: activeContext.commands?.checkoutBranch ?? null,
    showToast,
  });

  const appProvidersProps: AppProvidersProps = {
    appValue: {
      config,
      agents: agents ?? [],
      agentInstalledMap: {},
      loading,
      ideCommandOverrides: config.ideCommandOverrides ?? {},
      showToast,
      saveConfig,
    },
    projectActionsValue,
    fileActionsValue,
    wslValue,
    remoteValue,
    editorValue,
  };

  const appLayoutProps = useAppLayoutProps({
    onAddProject: handleAddProject,
    onOpenWslDialog: () => setWslDialogOpen(true),
    onOpenRemoteDialog: () => setRemoteDialogOpen(true),
  });

  const handleWslEntryAddRefresh = useCallback(
    async (entry: WSLEntrySession) => {
      await handleWSLEntryAdd(entry);
      for (const project of entry.projects) {
        if (!project.git_info) {
          void wslActions.handleRefreshWslGit(entry.distro, project.id, project.path);
        }
      }
    },
    [handleWSLEntryAdd, wslActions],
  );

  const handleRemoteEntryAddRefresh = useCallback(
    async (entry: RemoteEntrySession, auth: AuthMethod | null, saved_auth?: string | null) => {
      await handleRemoteEntryAdd(entry, auth, saved_auth);
      const hasAuth = remoteAuthStore.has(entry.id) || !!auth;
      if (hasAuth) {
        for (const project of entry.projects) {
          if (!project.git_info) {
            void remoteActions.handleRefreshRemoteGit(entry.id, project.id, project.path);
          }
        }
      }
    },
    [handleRemoteEntryAdd, remoteAuthStore, remoteActions],
  );

  const appModalsProps = useAppModalsProps({
    pendingPath,
    handleConfirmAddProject,
    setPendingPath,
    loading,
    wslDialogOpen,
    wslAddToEntryId,
    wslEntries,
    handleWslDialogClose,
    handleWslEntryAdd: handleWslEntryAddRefresh,
    remoteDialogOpen,
    remoteAddToEntryId,
    remoteEntries,
    handleRemoteDialogClose,
    handleRemoteEntryAdd: handleRemoteEntryAddRefresh,
    remoteAuthStore,
    pendingAuthEntry,
    handleRemoteAuthCancel: remoteAuthActions.handleRemoteAuthCancel,
    handleRemoteAuthSuccess: remoteAuthActions.handleRemoteAuthSuccess,
  });

  return {
    initializing,
    toast,
    titleBarProps,
    appProvidersProps,
    appLayoutProps,
    appModalsProps,
  };
}
