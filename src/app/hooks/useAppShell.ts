import React, { useCallback, useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';

import { useConnectionProjects } from '@/features/project/hooks/useConnectionProjects';
import { useProjectActions } from '@/features/project/hooks/useProjectActions';
import { useSessionBootstrap } from '@/features/session/hooks/useSessionBootstrap';
import { useSessionPersistence } from '@/features/session/hooks/useSessionPersistence';
import { useAgentActions } from '@/features/agent/hooks/useAgentActions';
import { useWorktreeActions } from '@/features/project/hooks/useWorktreeActions';
import { useRemoteAuthActions } from '@/features/connection/hooks/useRemoteAuthActions';
import { useProjectStore } from '@/features/project/store';
import { useWorktreeStore } from '@/features/project/worktreeStore';
import { useFileView } from '@/features/editor/hooks/useFileView';
import { useActiveProject } from '@/features/project/hooks/use-active-project';
import type { AuthMethod, RemoteEntrySession, WSLEntrySession } from '@/shared/types';
import { useFileTabRefresh } from '@/features/editor/hooks/useFileTabRefresh';
import { useAppLayoutProps } from '@/layout/hooks/useAppLayoutProps';
import { useProjectSelection } from '@/features/project/hooks/useProjectSelection';
import { useTabManagement } from '@/features/editor/hooks/useTabManagement';
import { useAgentClickHandler } from '@/features/agent/hooks/useAgentClickHandler';
import { useCrossTypeSelection } from '@/features/project/hooks/useCrossTypeSelection';
import { useLocalProjects } from '@/features/project/hooks/useLocalProjects';
import { useProjectList } from '@/features/project/hooks/useProjectList';
import { useWorktreeState } from '@/features/project/hooks/useWorktreeState';
import { useAppConfig } from '@/features/settings/hooks/useAppConfig';
import { useKeyboardShortcuts } from '@/shared/hooks/useKeyboardShortcuts';
import { useNotificationStore } from '@/features/notification/notificationStore';

import type AppModals from '../../app/AppModals';
import type AppProviders from '../../app/AppProviders';
import type AppLayout from '../../layout/AppLayout';

type AppProvidersProps = Omit<React.ComponentProps<typeof AppProviders>, 'children'>;
type AppLayoutProps = React.ComponentProps<typeof AppLayout>;
type AppModalsProps = React.ComponentProps<typeof AppModals>;

interface UseAppShellResult {
  initializing: boolean;
  appProvidersProps: AppProvidersProps;
  appLayoutProps: AppLayoutProps;
  appModalsProps: AppModalsProps;
}

export function useAppShell(): UseAppShellResult {
  const { config, saveConfig, customThemes } = useAppConfig();
  const showToast = useCallback(
    (message: string, type: "info" | "error" = "info") => {
      useNotificationStore.getState().addNotification({
        type: type === 'error' ? 'error' : 'info',
        title: type === 'error' ? 'Error' : 'Info',
        message,
      });
    },
    [],
  );
  const local = useLocalProjects();
  const session = useSessionPersistence();
  const wsl = useConnectionProjects({ environment: "wsl", saveSession: session.saveSession });
  const remote = useConnectionProjects({ environment: "remote", saveSession: session.saveSession, showToast });

  const {
    activeProjectId,
    activeProject,
    loading,
    agents,
    loadProjects,
    loadAgents,
    handleAddProject,
    handleRemoveProject,
    handleSelectFile,
    handleRefreshGit,
    handleOpenIde,
    handleDragEnd,
  } = local;
  const {
    entries: wslEntries,
    openSessions: wslOpenSessions,
    setOpenSessions: setWslOpenSessions,
    dialogOpen: wslDialogOpen,
    setDialogOpen: setWslDialogOpen,
    addToEntryId: wslAddToEntryId,
    handleEntryAdd: handleWSLEntryAdd,
    handleCloseProject: handleCloseWslProject,
    handleRemoveProject: handleRemoveWslProject,
    handleRemoveEntry: handleRemoveWslEntry,
    handleAddProject: handleAddWslProject,
    handleDialogClose: handleWslDialogClose,
    handleDragEnd: handleWslDragEnd,
  } = wsl;
  const {
    entries: remoteEntries,
    openSessions: remoteOpenSessions,
    setOpenSessions: setRemoteOpenSessions,
    dialogOpen: remoteDialogOpen,
    setDialogOpen: setRemoteDialogOpen,
    addToEntryId: remoteAddToEntryId,
    remoteAuthStore,
    pendingAuthEntry,
    setPendingAuthEntry,
    handleEntryAdd: handleRemoteEntryAdd,
    handleCloseProject: handleCloseRemoteProject,
    handleRemoveProject: handleRemoveRemoteProject,
    handleRemoveEntry: handleRemoveRemoteEntry,
    handleAddProject: handleAddRemoteProject,
    handleDialogClose: handleRemoteDialogClose,
    handleDragEnd: handleRemoteDragEnd,
  } = remote;

  const {
    activeWorktreePath,
    updateWtPath,
    setActiveWorktreePath,
    setActiveWorktreeBranch,
    setOpenedWorktrees,
  } = useWorktreeState(activeProjectId);
  useEffect(() => {
    if (!activeWorktreePath || !activeProject?.git_info) return;
    if (!activeProject.git_info.worktrees.some((wt) => wt.path === activeWorktreePath)) {
      setActiveWorktreePath(null);
      setActiveWorktreeBranch('');
    }
  }, [
    activeProject?.git_info?.worktrees,
    activeWorktreePath,
    setActiveWorktreePath,
    setActiveWorktreeBranch,
    activeProject?.git_info,
  ]);

  const wslActionsWrap = useProjectActions({ environment: "wsl", config, showToast, saveSession: session.saveSession });
  const remoteActionsWrap = useProjectActions({ environment: "remote", config, showToast, saveSession: session.saveSession });
  const agentActionsWrap = useAgentActions({
    terminal: {
      fontSize: config.terminalFontSize ?? 14,
      shell: config.shell ?? '',
      fontFamily: config.fontFamily ?? '',
      gpuAcceleration: config.terminalGpuAcceleration ?? false,
    },
    agentCommandOverrides: config.agentCommandOverrides,
    handleOpenIde,
    showToast,
    saveSession: session.saveSession,
  });
  const worktreeActionsWrap = useWorktreeActions({
    setActiveWorktreePath,
    setActiveWorktreeBranch,
    setOpenedWorktrees,
    saveWorktreeState: session.saveWorktreeState,
  });
  const remoteAuthActions = useRemoteAuthActions({ saveSession: session.saveSession });
  const activeContext = useActiveProject();
  const fileView = useFileView(activeContext.commands, activeContext.worktreePath);
  const { selectProject } = useProjectSelection();
  const cross = useCrossTypeSelection({
    wslActions: wslActionsWrap,
    remoteActions: remoteActionsWrap,
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
    const projectId =
      useProjectStore.getState().activeProjectId ??
      null;
    if (!projectId) return;
    const rootPath =
      useWorktreeStore.getState().activeWorktreePath ??
      useProjectStore.getState().activeProject?.path ??
      undefined;
    fileView.loadFileTree(projectId, rootPath);
  }, [fileView.loadFileTree]);
  const handleWslDiffBack = useCallback(() => {
    wslActionsWrap.setWslDiffState?.(null);
  }, [wslActionsWrap.setWslDiffState]);

  const { initializing } = useSessionBootstrap({
    loadProjects,
    restoreWorktreeState: session.restoreWorktreeState,
  });
  useFileTabRefresh(activeContext.commands);

  const initialWslRemoteRefreshDone = React.useRef(false);
  useEffect(() => {
    if (initializing || initialWslRemoteRefreshDone.current) return;
    initialWslRemoteRefreshDone.current = true;
    for (const entry of wslEntries) {
      for (const project of entry.projects) {
        if (!project.git_info)
          void wslActionsWrap.handleRefreshGit(entry.distro, project.id, project.path);
      }
    }
    for (const entry of remoteEntries) {
      if (!remoteAuthStore.has(entry.id)) continue;
      for (const project of entry.projects) {
        if (!project.git_info)
          void remoteActionsWrap.handleRefreshGit(entry.id, project.id, project.path);
      }
    }
  }, [initializing, wslEntries, remoteEntries, remoteAuthStore, wslActionsWrap, remoteActionsWrap]);
  useEffect(() => {
    const t = setTimeout(() => {
      loadAgents();
    }, 100);
    return () => clearTimeout(t);
  }, [loadAgents]);
  useEffect(() => {
    loadAgents();
  }, [config, loadAgents]);

  const isTerminalView = activeProject?.active_view === 'Terminal';
  useEffect(() => {
    useProjectStore.setState({
      isTerminalView: isTerminalView || activeWorktreePath !== null,
      selectProject: cross.handleSelectProject,
      openIde: agentActionsWrap.handleOpenIdeCallback,
      setProjectIde: agentActionsWrap.handleSetProjectIde,
    });
  }, [
    isTerminalView,
    activeWorktreePath,
    cross.handleSelectProject,
    agentActionsWrap.handleOpenIdeCallback,
    agentActionsWrap.handleSetProjectIde,
  ]);
  useKeyboardShortcuts({
    updateWtPath,
    activeTabId,
    onCloseTab: handleCloseTab,
    shortcuts: config.shortcuts,
    unifiedItems: useProjectList().items,
  });

  // Cmd+W / Ctrl+W → close active tab only, never close the window.
  useEffect(() => {
    const unlistenPromise = listen('close-tab', () => {
      const currentTabId = activeTabId;
      if (currentTabId) {
        handleCloseTab(currentTabId);
      }
    });
    return () => { unlistenPromise.then((fn) => fn()); };
  }, [activeTabId, handleCloseTab]);

  const { handleAgentClick } = useAgentClickHandler({
    tabKey,
    handleTabAgentClick,
    activeProject,
    agentActions: agentActionsWrap,
    wslActions: wslActionsWrap,
    remoteActions: remoteActionsWrap,
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
    onSelectProject: cross.handleSelectProject,
    onAddProject: handleAddProject,
    onSelectFile: handleSelectFile,
    onRefreshGit: handleRefreshGit,
    onBackToMainTerminal: worktreeActionsWrap.handleBackToMainTerminal,
    onOpenIde: agentActionsWrap.handleOpenIdeForSidebar,
    onOpenWorktreeTerminal: worktreeActionsWrap.handleOpenWorktreeTerminal,
    onSelectWorktreeFile: worktreeActionsWrap.handleSelectWorktreeFile,
    onDragEnd: handleDragEnd,
    onSaveProjectSettings: agentActionsWrap.handleSaveProjectSettings,
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
  const connectionProjectValue = {
    // WSL fields
    wslEntries,
    wslOpenSessions,
    activeWslWorktreePath: wslActionsWrap.activeWorktreePath,
    wslDiffState: wslActionsWrap.wslDiffState ?? null,
    setWslOpenSessions,
    onCloseWslProject: handleCloseWslProject,
    onRemoveWslProject: handleRemoveWslProject,
    onRemoveWslEntry: handleRemoveWslEntry,
    onAddWslProject: handleAddWslProject,
    onSelectWslFile: wslActionsWrap.handleSelectFile,
    onRefreshWslGit: wslActionsWrap.handleRefreshGit,
    onOpenWslIde: wslActionsWrap.handleOpenIde,
    onOpenWslWorktreeTerminal: cross.handleOpenWslWorktreeTerminal,
    onWslDiffBack: handleWslDiffBack,
    onWslDragEnd: handleWslDragEnd,
    // Remote fields
    remoteEntries,
    remoteOpenSessions,
    activeRemoteWorktreePath: remoteActionsWrap.activeWorktreePath,
    remoteAuthStore,
    setRemoteOpenSessions,
    onCloseRemoteProject: handleCloseRemoteProject,
    onRemoveRemoteProject: handleRemoveRemoteProject,
    onRemoveRemoteEntry: handleRemoveRemoteEntry,
    onAddRemoteProject: handleAddRemoteProject,
    onRefreshRemoteGit: remoteActionsWrap.handleRefreshGit,
    onOpenRemoteIde: remoteActionsWrap.handleOpenIde,
    onOpenRemoteWorktreeTerminal: cross.handleOpenRemoteWorktreeTerminal,
    invokeRemoteGit: remoteActionsWrap.invokeRemoteGit,
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

  const appProvidersProps: AppProvidersProps = {
    appValue: {
      config,
      customThemes,
      agents: agents ?? [],
      agentInstalledMap: {},
      loading,
      ideCommandOverrides: config.ideCommandOverrides ?? {},
      showToast,
      saveConfig,
    },
    projectActionsValue,
    fileActionsValue,
    connectionProjectValue,
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
        if (!project.git_info)
          void wslActionsWrap.handleRefreshGit(entry.distro, project.id, project.path);
      }
    },
    [handleWSLEntryAdd, wslActionsWrap],
  );
  const handleRemoteEntryAddRefresh = useCallback(
    async (entry: RemoteEntrySession, auth: AuthMethod | null, saved_auth?: string | null) => {
      await handleRemoteEntryAdd(entry, auth, saved_auth);
      const hasAuth = remoteAuthStore.has(entry.id) || !!auth;
      if (hasAuth) {
        for (const project of entry.projects) {
          if (!project.git_info)
            void remoteActionsWrap.handleRefreshGit(entry.id, project.id, project.path);
        }
      }
    },
    [handleRemoteEntryAdd, remoteAuthStore, remoteActionsWrap],
  );

  const appModalsProps: AppModalsProps = {
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

  return { initializing, appProvidersProps, appLayoutProps, appModalsProps };
}
