import { listen } from '@tauri-apps/api/event';
import { useCallback, useEffect } from 'react';

import { useAgentActions, useAgentClickHandler } from '@/features/agent';
import { useRemoteAuthActions } from '@/features/connection';
import { useFileTabRefresh, useFileView, useTabManagement } from '@/features/editor';
import {
  useActiveProject,
  useConnectionProjects,
  useCrossTypeSelection,
  useLocalProjects,
  useProjectActions,
  useProjectList,
  useProjectSelection,
  useWorktreeActions,
  useWorktreeState,
} from '@/features/project';
import { useSessionBootstrap, useSessionPersistence } from '@/features/session';
import { useAppConfig } from '@/features/settings';
import { useApplyProjectSkills } from '@/features/skill';
import { useAppLayoutProps } from '@/layout/hooks/useAppLayoutProps';
import { CLOSE_TAB_EVENT } from '@/shared/events';
import { useKeyboardShortcuts } from '@/shared/hooks/useKeyboardShortcuts';
import { useNotificationStore } from '@/shared/store/notificationStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorktreeStore } from '@/shared/store/worktreeStore';
import { safeUnlisten } from '@/shared/utils/safeUnlisten';

import type AppLayout from '../../layout/AppLayout';

import { type AppShellData } from './buildAppShellValues';
import { closeActiveTabCommand } from './closeActiveTabCommand';
import { useAppEntryAddRefresh } from './useAppEntryAddRefresh';
import { useAppInitialGitRefresh } from './useAppInitialGitRefresh';
import { useAppStoreSync } from './useAppStoreSync';
import { useConfirmExit } from './useConfirmExit';

type AppLayoutProps = React.ComponentProps<typeof AppLayout>;

export interface UseAppShellDataResult extends AppShellData {
  initializing: boolean;
  appLayoutProps: AppLayoutProps;
}

/**
 * useAppShell 数据编排层：调用全部数据 hooks + 副作用 hooks，产出
 * buildAppShellValues 所需原始数据（AppShellData）。
 *
 * 拆分动机：编排（hook 调用顺序/副作用注册）与装配（context value 组装）
 * 分离，装配段可独立单测；本文件 hook 调用顺序与原 useAppShell 完全等价
 * （无条件调用、注册时机不变）。
 */
export function useAppShellData(): UseAppShellDataResult {
  const { config, saveConfig, customThemes } = useAppConfig();
  const showToast = useCallback((message: string, type: 'info' | 'error' = 'info') => {
    useNotificationStore.getState().addNotification({
      type: type === 'error' ? 'error' : 'info',
      title: type === 'error' ? 'Error' : 'Info',
      message,
    });
  }, []);
  const local = useLocalProjects();
  const session = useSessionPersistence();
  const wsl = useConnectionProjects({ environment: 'wsl', saveSession: session.saveSession });
  const remote = useConnectionProjects({
    environment: 'remote',
    saveSession: session.saveSession,
    showToast,
  });
  // Skill auto-load: install bound tag-group skills on project select (no remove)
  useApplyProjectSkills();

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
    const worktrees = activeProject.git_info.worktrees;
    // worktrees 为空可能是「尚未加载完成」而非「确实没有」，此时不清理激活态，
    // 避免启动恢复 activeWorktreePath 与 worktree 列表加载之间的竞态。
    if (worktrees.length > 0 && !worktrees.some((wt) => wt.path === activeWorktreePath)) {
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

  const wslActionsWrap = useProjectActions({
    environment: 'wsl',
    config,
    showToast,
    saveSession: session.saveSession,
  });
  const remoteActionsWrap = useProjectActions({
    environment: 'remote',
    config,
    showToast,
    saveSession: session.saveSession,
  });
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
  });
  const handleFileSelect = useCallback(
    (filePath: string) => {
      return fileView.openFile(filePath);
    },
    [fileView],
  );
  const handleFileRefresh = useCallback(() => {
    const projectId = useProjectStore.getState().activeProjectId ?? null;
    if (!projectId) return;
    const rootPath =
      useWorktreeStore.getState().activeWorktreePath ??
      useProjectStore.getState().activeProject?.path ??
      undefined;
    // force = true: manual refresh must bypass the "already loaded" idempotency
    // check, otherwise a loaded tree would never re-fetch (the root cause of
    // "refresh button does nothing after file changes").
    fileView.loadFileTree(projectId, rootPath, true);
  }, [fileView]);
  const handleWslDiffBack = useCallback(() => {
    wslActionsWrap.setWslDiffState?.(null);
  }, [wslActionsWrap]);

  const { initializing } = useSessionBootstrap({
    loadProjects,
    restoreWorktreeState: session.restoreWorktreeState,
  });
  useFileTabRefresh(activeContext.commands);

  // 启动完成后为缺失 git_info 的 WSL/远程项目补一轮 git 刷新（仅一次）
  useAppInitialGitRefresh({
    initializing,
    wslEntries,
    remoteEntries,
    remoteAuthStore,
    wslActionsWrap,
    remoteActionsWrap,
  });
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
  useAppStoreSync({
    isTerminalView,
    activeWorktreePath,
    selectProject: cross.handleSelectProject,
    handleOpenIdeCallback: agentActionsWrap.handleOpenIdeCallback,
    handleSetProjectIde: agentActionsWrap.handleSetProjectIde,
  });
  useKeyboardShortcuts({
    updateWtPath,
    activeTabId,
    onCloseTab: handleCloseTab,
    shortcuts: config.shortcuts,
    unifiedItems: useProjectList().items,
  });

  // Cmd+W / Ctrl+W → close active tab only, never close the window.
  // 只订阅一次（不随 activeTabId/tabKey 变化重订阅），避免重订阅竞态：
  // 事件到达时由 closeActiveTabCommand 现取项目/worktree/tab 最新状态。
  useEffect(() => {
    const unlistenPromise = listen(CLOSE_TAB_EVENT, () => {
      closeActiveTabCommand();
    });
    return () => {
      unlistenPromise.then((fn) => safeUnlisten(fn)());
    };
  }, []);

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

  const { handleWslEntryAddRefresh, handleRemoteEntryAddRefresh } = useAppEntryAddRefresh({
    handleWSLEntryAdd,
    wslActionsWrap,
    handleRemoteEntryAdd,
    remoteAuthStore,
    remoteActionsWrap,
  });

  const { confirmExitOpen, unsavedFileNames, closeExitDialog, confirmExit } = useConfirmExit();

  const appLayoutProps = useAppLayoutProps({
    onAddProject: handleAddProject,
    onOpenWslDialog: () => setWslDialogOpen(true),
    onOpenRemoteDialog: () => setRemoteDialogOpen(true),
  });

  return {
    initializing,
    config,
    customThemes,
    saveConfig,
    showToast,
    agents,
    loading,
    handleRemoveProject,
    handleSelectProject: cross.handleSelectProject,
    handleAddProject,
    handleSelectFile,
    handleRefreshGit,
    handleBackToMainTerminal: worktreeActionsWrap.handleBackToMainTerminal,
    handleOpenIdeForSidebar: agentActionsWrap.handleOpenIdeForSidebar,
    handleOpenWorktreeTerminal: worktreeActionsWrap.handleOpenWorktreeTerminal,
    handleDragEnd,
    handleSaveProjectSettings: agentActionsWrap.handleSaveProjectSettings,
    handleFileSelect,
    handleFileRefresh,
    fileView,
    wslEntries,
    wslOpenSessions,
    activeWslWorktreePath: wslActionsWrap.activeWorktreePath,
    wslDiffState: wslActionsWrap.wslDiffState ?? null,
    setWslOpenSessions,
    handleCloseWslProject,
    handleRemoveWslProject,
    handleRemoveWslEntry,
    handleAddWslProject,
    handleSelectWslFile: wslActionsWrap.handleSelectFile,
    handleRefreshWslGit: wslActionsWrap.handleRefreshGit,
    handleOpenWslIde: wslActionsWrap.handleOpenIde,
    handleOpenWslWorktreeTerminal: cross.handleOpenWslWorktreeTerminal,
    handleWslDiffBack,
    handleWslDragEnd,
    wslDialogOpen,
    wslAddToEntryId,
    handleWslDialogClose,
    handleWslEntryAdd: handleWslEntryAddRefresh,
    remoteEntries,
    remoteOpenSessions,
    activeRemoteWorktreePath: remoteActionsWrap.activeWorktreePath,
    remoteAuthStore,
    setRemoteOpenSessions,
    handleCloseRemoteProject,
    handleRemoveRemoteProject,
    handleRemoveRemoteEntry,
    handleAddRemoteProject,
    handleRefreshRemoteGit: remoteActionsWrap.handleRefreshGit,
    handleOpenRemoteIde: remoteActionsWrap.handleOpenIde,
    handleOpenRemoteWorktreeTerminal: cross.handleOpenRemoteWorktreeTerminal,
    invokeRemoteGit: remoteActionsWrap.invokeRemoteGit,
    handleRemoteDragEnd,
    remoteDialogOpen,
    remoteAddToEntryId,
    handleRemoteDialogClose,
    handleRemoteEntryAdd: handleRemoteEntryAddRefresh,
    pendingAuthEntry,
    setPendingAuthEntry,
    tabs,
    activeTabId,
    handleActivateTab,
    handleCloseTab,
    handleAddTab,
    handleTabStatusChange,
    handleAgentClick,
    handleToggleHiddenAgent,
    confirmExitOpen,
    unsavedFileNames,
    onConfirmExit: confirmExit,
    onCancelExit: closeExitDialog,
    onRemoteAuthCancel: remoteAuthActions.handleRemoteAuthCancel,
    onRemoteAuthSuccess: remoteAuthActions.handleRemoteAuthSuccess,
    appLayoutProps,
  };
}
