import { listen } from '@tauri-apps/api/event';
import { useCallback, useEffect, useState } from 'react';

import { useAgentActions, useAgentClickHandler } from '@/features/agent';
import { useRemoteAuthActions } from '@/features/connection';
import { useFileTabRefresh, useFileView, useTabManagement } from '@/features/editor';
import { useGitConsoleBridge } from '@/features/git';
import { useNotificationReflow } from '@/features/notification';
import {
  useConnectionProjects,
  useCrossTypeSelection,
  useLocalProjects,
  useProjectActions,
  useProjectList,
  useProjectSelection,
  useWorktreeActions,
  useWorkspaceState,
} from '@/features/project';
import { useSessionBootstrap, useSessionPersistence } from '@/features/session';
import { useAgentPreload, useAppConfig } from '@/features/settings';
import { useApplyProjectSkills } from '@/features/skill';
import { CLOSE_TAB_EVENT } from '@/shared/events';
import { useKeyboardShortcuts } from '@/shared/hooks/useKeyboardShortcuts';
import { notify } from '@/shared/store/notificationStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { safeUnlisten } from '@/shared/utils/safeUnlisten';

import type { ToolbarFooterProps } from '../components/ToolbarFooter';

import { type AppShellData } from './buildAppShellValues';
import { closeActiveTabCommand } from './closeActiveTabCommand';
import { useActiveWorkspaceSync } from './useActiveWorkspaceSync';
import { useAppEntryAddRefresh } from './useAppEntryAddRefresh';
import { useAppInitialGitRefresh } from './useAppInitialGitRefresh';
import { useAppStoreSync } from './useAppStoreSync';
import { useConfirmExit } from './useConfirmExit';
import { useHiddenAgentToggle } from './useHiddenAgentToggle';
import { useToolbarFooterProps } from './useToolbarFooterProps';

export interface UseAppShellDataResult extends AppShellData {
  initializing: boolean;
  toolbarProps: ToolbarFooterProps;
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
  // agent 配置缓存的启动期预热（终端在未命中时不启动 agent，见 agentStore）。
  useAgentPreload();
  // 与命令式 handler（app 层在 Provider 之外装配的入口）共用同一个映射 —— 不是第二份实现
  const showToast = useCallback((message: string, type: 'info' | 'error' = 'info') => {
    notify(message, type);
  }, []);
  const local = useLocalProjects();
  const session = useSessionPersistence();
  // Agent 通知的点击回流（app 级挂载一次）。
  //
  // 不订阅 `notification-delivered`：Agent 通知只走系统通知通道，不进应用内列表 ——
  // status-bar 铃铛仅展示 App 自身的操作反馈（`useNotify` / 保存失败等，直写
  // `notificationStore`，与本链路零交叠）。
  useNotificationReflow();
  const wsl = useConnectionProjects({ environment: 'wsl', saveSession: session.saveSession });
  const remote = useConnectionProjects({
    environment: 'remote',
    saveSession: session.saveSession,
    showToast,
  });
  // Skill auto-load: install bound tag-group skills on project select (no remove)
  useApplyProjectSkills();
  // Git 长操作（push/fetch/pull/commit）的实时输出 → Console（app 级订阅，面板关闭也收流）
  useGitConsoleBridge();

  const {
    activeProjectId,
    activeProject,
    loading,
    agents,
    loadProjects,
    loadAgents,
    handleAddProject,
    addProjectFromPath,
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

  const { activeCheckoutPath, activateWorkspace, markWorkspaceOpened } =
    useWorkspaceState(activeProjectId);
  useEffect(() => {
    if (!activeCheckoutPath || !activeProject?.git_info) return;
    const worktrees = activeProject.git_info.worktrees;
    // worktrees 为空可能是「尚未加载完成」而非「确实没有」，此时不清理激活态。
    // 路径为后端 canonical 形态（WorkspaceRef 归一）→ 等值比较即身份比较。
    if (worktrees.length > 0 && !worktrees.some((wt) => wt.path === activeCheckoutPath)) {
      console.warn('[worktree] active workspace gone, fallback to main:', activeCheckoutPath);
      activateWorkspace(activeProject.id, null, '');
    }
  }, [
    activeProject?.git_info?.worktrees,
    activeCheckoutPath,
    activateWorkspace,
    activeProject?.git_info,
    activeProject?.id,
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
    handleOpenIde,
    showToast,
    saveSession: session.saveSession,
  });
  const worktreeActionsWrap = useWorktreeActions({
    activateWorkspace,
    markWorkspaceOpened,
    saveWorktreeState: session.saveWorktreeState,
  });
  const remoteAuthActions = useRemoteAuthActions({ saveSession: session.saveSession });
  const fileView = useFileView();
  const { selectProject } = useProjectSelection();
  const cross = useCrossTypeSelection({
    wslActions: wslActionsWrap,
    remoteActions: remoteActionsWrap,
    selectProject,
  });
  const { tabKey, tabs, handleAddTab, handleCloseTab, handleActivateTab, handleTabAgentClick } =
    useTabManagement({
      activeProject,
      saveTabById: fileView.saveTabById,
    });
  const handleFileSelect = useCallback(
    (filePath: string) => {
      return fileView.openFile(filePath);
    },
    [fileView],
  );
  const handleWslDiffBack = useCallback(() => {
    wslActionsWrap.setWslDiffState?.(null);
  }, [wslActionsWrap]);

  // 当前视图所在Workspace → 后端挂载的唯一同步点（决策 D-B 落地点）
  useActiveWorkspaceSync();
  const { initializing } = useSessionBootstrap({
    loadProjects,
    restoreWorktreeState: session.restoreWorktreeState,
  });
  useFileTabRefresh();

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
    activeCheckoutPath,
    selectProject: cross.handleSelectProject,
    handleOpenIdeCallback: agentActionsWrap.handleOpenIdeCallback,
    handleSetProjectIde: agentActionsWrap.handleSetProjectIde,
  });
  // 快捷键循环 worktree 永远作用于「当前激活项目」：调用时经 getState 现取项目 id
  //（mutator 显式收 projectId，渲染期闭包在切换竞态下是旧值）
  const updateWtPath = useCallback(
    (path: string | null, branch: string) => {
      const pid = useProjectStore.getState().activeProjectId;
      if (pid) activateWorkspace(pid, path, branch);
    },
    [activateWorkspace],
  );
  useKeyboardShortcuts({
    updateWtPath,
    onCloseTab: handleCloseTab,
    shortcuts: config.shortcuts,
    unifiedItems: useProjectList().items,
  });

  // Cmd+W / Ctrl+W → close active tab only, never close the window.
  // 只订阅一次（不随 activeTabId/tabKey 变化重订阅），避免重订阅竞态：
  // 事件到达时由 closeActiveTabCommand 现取项目/worktree/tab 最新状态。
  // dirty 文件 tab 的「保存」分支注入 fileView.saveTabById（引用稳定，仅依赖 ref）。
  useEffect(() => {
    const unlistenPromise = listen(CLOSE_TAB_EVENT, () => {
      void closeActiveTabCommand(fileView.saveTabById);
    });
    return () => {
      unlistenPromise.then((fn) => safeUnlisten(fn)());
    };
  }, [fileView.saveTabById]);

  const { handleAgentClick } = useAgentClickHandler({
    tabKey,
    handleTabAgentClick,
    activeProject,
    agentActions: agentActionsWrap,
    wslActions: wslActionsWrap,
    remoteActions: remoteActionsWrap,
  });
  // 「隐藏 agent」的 config.json 读写整体进全局串行门（见该 hook 的文档）。
  const handleToggleHiddenAgent = useHiddenAgentToggle(saveConfig);

  const { handleWslEntryAddRefresh, handleRemoteEntryAddRefresh } = useAppEntryAddRefresh({
    handleWSLEntryAdd,
    wslActionsWrap,
    handleRemoteEntryAdd,
    remoteAuthStore,
    remoteActionsWrap,
  });

  const { confirmExitOpen, unsavedFileNames, closeExitDialog, confirmExit } = useConfirmExit();

  // Clone-from-Git dialog state + success → add-project chain.
  // 声明在 toolbarProps 之前：onCloneProject 闭包引用 setCloneDialogOpen，避免 TDZ 可读性陷阱。
  const [cloneDialogOpen, setCloneDialogOpen] = useState(false);
  const handleCloneDialogClose = useCallback(() => setCloneDialogOpen(false), []);
  const handleCloneSuccess = useCallback(
    (path: string) => {
      setCloneDialogOpen(false);
      addProjectFromPath(path).catch((e: unknown) =>
        showToast(e instanceof Error ? e.message : String(e), 'error'),
      );
    },
    [addProjectFromPath, showToast],
  );

  const toolbarProps = useToolbarFooterProps({
    onAddProject: handleAddProject,
    onCloneProject: () => setCloneDialogOpen(true),
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
    cloneDialogOpen,
    handleCloneDialogClose,
    handleCloneSuccess,
    handleBackToMainTerminal: worktreeActionsWrap.handleBackToMainTerminal,
    handleOpenIdeForSidebar: agentActionsWrap.handleOpenIdeForSidebar,
    handleOpenWorktreeTerminal: worktreeActionsWrap.handleOpenWorktreeTerminal,
    handleDragEnd,
    handleSaveProjectSettings: agentActionsWrap.handleSaveProjectSettings,
    handleFileSelect,
    fileView,
    wslEntries,
    wslOpenSessions,
    activeWslCheckoutPath: wslActionsWrap.activeCheckoutPath,
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
    activeRemoteCheckoutPath: remoteActionsWrap.activeCheckoutPath,
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
    handleActivateTab,
    handleCloseTab,
    handleAddTab,
    handleAgentClick,
    handleToggleHiddenAgent,
    confirmExitOpen,
    unsavedFileNames,
    onConfirmExit: confirmExit,
    onCancelExit: closeExitDialog,
    onRemoteAuthCancel: remoteAuthActions.handleRemoteAuthCancel,
    onRemoteAuthSuccess: remoteAuthActions.handleRemoteAuthSuccess,
    toolbarProps,
  };
}
