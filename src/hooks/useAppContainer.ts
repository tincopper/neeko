import React, { useCallback, useEffect } from "react";
import type AppProviders from "../app/AppProviders";
import type AppModals from "../app/AppModals";
import type AppLayout from "../layout/AppLayout";
import type { TitleBar } from "../layout";
import { useToast } from "@/shared/hooks/useToast";
import { useWorktreeState } from "@/features/project/hooks/useWorktreeState";
import { useKeyboardShortcuts } from "@/shared/hooks/useKeyboardShortcuts";
import { useAppConfig } from "@/features/settings/hooks/useAppConfig";
import { useLocalProjects } from "@/features/project/hooks/useLocalProjects";
import { useWslProjects } from "@/features/connection/hooks/useWslProjects";
import { useRemoteProjects } from "@/features/connection/hooks/useRemoteProjects";
import { useWslActions } from "@/features/connection/hooks/useWslActions";
import { useRemoteActions } from "@/features/connection/hooks/useRemoteActions";
import { useSessionBootstrap } from "@/features/session/hooks/useSessionBootstrap";
import { useSessionPersistence } from "@/features/session/hooks/useSessionPersistence";
import { useAgentActions } from "@/features/agent/hooks/useAgentActions";
import { useWorktreeActions } from "@/features/project/hooks/useWorktreeActions";
import { useRemoteAuthActions } from "@/features/connection/hooks/useRemoteAuthActions";
import { useProjectStore } from "@/features/project/store";
import { useConnectionStore } from "@/features/connection/store";
import { useWorktreeStore } from "@/features/project/worktreeStore";
import { useFileView } from "@/features/editor/hooks/useFileView";
import { useActiveProject } from "@/hooks/useActiveProject";
import type { AuthMethod, RemoteEntrySession, WSLEntrySession } from "@/types";
import { useFileTabRefresh } from "@/features/editor/hooks/useFileTabRefresh";
import { useAppLayoutProps } from "@/layout/hooks/useAppLayoutProps";
import { useTitleBarProps } from "@/layout/hooks/useTitleBarProps";
import { useProjectSelection } from "@/features/project/hooks/useProjectSelection";
import { useTabManagement } from "@/features/editor/hooks/useTabManagement";
import { useAgentClickHandler } from "@/features/agent/hooks/useAgentClickHandler";
import { useUnifiedProjectList } from "@/features/project/hooks/useUnifiedProjectList";
import { useCrossTypeSelection } from "@/features/project/hooks/useCrossTypeSelection";

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

  const {
    handleSelectProject,
    handleSelectWslProject,
    handleSelectRemoteProject,
    handleOpenWslWorktreeTerminal,
    handleOpenRemoteWorktreeTerminal,
  } = useCrossTypeSelection({
    wslActions,
    remoteActions,
    selectProject,
  });

  const {
    tabKey,
    tabs,
    activeTabId,
    handleAddTab,
    handleCloseTab,
    handleActivateTab,
    handleTabStatusChange,
    handleTabAgentClick,
  } = useTabManagement({
    activeProject,
    activeWslProject,
    activeRemoteProject,
    activeWorktreePath,
    agents,
  });

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
  useFileTabRefresh(activeContext.commands);

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

  // Delayed load agents after initial render
  useEffect(() => {
    const t = setTimeout(() => { loadAgents(); }, 100);
    return () => clearTimeout(t);
  }, [loadAgents]);
  
  // Refresh agents when config changes (e.g., after adding custom agent in Settings)
  useEffect(() => {
    loadAgents();
  }, [config, loadAgents]);

  const isTerminalView = activeProject?.active_view === "Terminal";

  useEffect(() => {
    useProjectStore.setState({
      isTerminalView: isTerminalView || activeWorktreePath !== null,
      selectProject: handleSelectProject,
      openIde: agentActions.handleOpenIdeCallback,
      setProjectIde: agentActions.handleSetProjectIde,
    });
  }, [isTerminalView, activeWorktreePath, handleSelectProject, agentActions.handleOpenIdeCallback, agentActions.handleSetProjectIde]);

  useEffect(() => {
    useConnectionStore.setState({
      selectWslProject: handleSelectWslProject,
      selectRemoteProject: handleSelectRemoteProject,
    });
  }, [handleSelectWslProject, handleSelectRemoteProject]);

  useKeyboardShortcuts({
    updateWtPath,
    setWslWorktreePath: wslActions.setActiveWslWorktreePath,
    setWslWtBranch: wslActions.setWslActiveWtBranch,
    setRemoteWorktreePath: remoteActions.setActiveRemoteWorktreePath,
    setRemoteWtBranch: remoteActions.setRemoteActiveWtBranch,
    activeTabId,
    onCloseTab: handleCloseTab,
    shortcuts: config.shortcuts,
    unifiedItems: useUnifiedProjectList().items,
  });

  const { handleAgentClick } = useAgentClickHandler({
    tabKey,
    handleTabAgentClick,
    activeProject,
    activeWslProject,
    activeRemoteProject,
    agentActions,
    wslActions,
    remoteActions,
  });

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
    onSelectProject: handleSelectProject,
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
    onSelectWslProject: handleSelectWslProject,
    onCloseWslProject: handleCloseWslProject,
    onRemoveWslProject: handleRemoveWslProject,
    onRemoveWslEntry: handleRemoveWslEntry,
    onAddWslProject: handleAddWslProject,
    onSelectWslFile: wslActions.handleSelectWslFile,
    onRefreshWslGit: wslActions.handleRefreshWslGit,
    onOpenWslIde: wslActions.handleOpenWslIde,
    onOpenWslWorktreeTerminal: handleOpenWslWorktreeTerminal,
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
    onSelectRemoteProject: handleSelectRemoteProject,
    onCloseRemoteProject: handleCloseRemoteProject,
    onRemoveRemoteProject: handleRemoveRemoteProject,
    onRemoveRemoteEntry: handleRemoveRemoteEntry,
    onAddRemoteProject: handleAddRemoteProject,
    onRefreshRemoteGit: remoteActions.handleRefreshRemoteGit,
    onOpenRemoteIde: remoteActions.handleOpenRemoteIde,
    onOpenRemoteWorktreeTerminal: handleOpenRemoteWorktreeTerminal,
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

  const appModalsProps: AppModalsProps = {
    pendingPath,
    onConfirmAddProject: handleConfirmAddProject,
    onCancelAddProject: () => setPendingPath(null),
    loading,
    wslDialogOpen,
    wslAddToEntryId,
    wslEntries,
    onWslDialogClose: handleWslDialogClose,
    onAddWslEntry: handleWslEntryAddRefresh,
    remoteDialogOpen,
    remoteAddToEntryId,
    remoteEntries,
    onRemoteDialogClose: handleRemoteDialogClose,
    onAddRemoteEntry: handleRemoteEntryAddRefresh,
    remoteAuthStore,
    pendingAuthEntry,
    onRemoteAuthCancel: remoteAuthActions.handleRemoteAuthCancel,
    onRemoteAuthSuccess: remoteAuthActions.handleRemoteAuthSuccess,
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
