import type React from 'react';

import type AppModals from '@/app/AppModals';
import AppProviders from '@/app/AppProviders';
import type { FileActionsContextValue } from '@/features/editor/FileActionsContext';
import type { ConnectionProjectContextValue } from '@/features/project';
import type { ProjectActionsContextValue } from '@/features/project/ProjectContext';
import { AppProvider, type EditorContextValue } from '@/shared/contexts';

type AppProvidersProps = Omit<React.ComponentProps<typeof AppProviders>, 'children'>;
type AppModalsProps = React.ComponentProps<typeof AppModals>;
type AppValue = React.ComponentProps<typeof AppProvider>['value'];

/**
 * useAppShell 装配段纯函数：由原始数据组装 context value 对象。
 *
 * 与 useAppShellData 拆分的动机：装配逻辑无副作用、输入输出明确，
 * 抽为纯函数后可 100% 单测；useAppShell 退化为「hook 调用 + builder 装配」。
 *
 * 注意：AppModalsProps 依赖 useAppEntryAddRefresh / useConfirmExit 的
 * hook 输出，由调用方作为入参传入（hook 不能进纯函数）。
 */
export interface AppShellData {
  // app
  config: AppValue['config'];
  customThemes: AppValue['customThemes'];
  saveConfig: AppValue['saveConfig'];
  showToast: AppValue['showToast'];
  agents: AppValue['agents'];
  loading: AppValue['loading'];
  // project actions
  handleRemoveProject: ProjectActionsContextValue['onRemoveProject'];
  handleSelectProject: ProjectActionsContextValue['onSelectProject'];
  handleAddProject: ProjectActionsContextValue['onAddProject'];
  handleSelectFile: ProjectActionsContextValue['onSelectFile'];
  handleRefreshGit: ProjectActionsContextValue['onRefreshGit'];
  handleBackToMainTerminal: ProjectActionsContextValue['onBackToMainTerminal'];
  handleOpenIdeForSidebar: ProjectActionsContextValue['onOpenIde'];
  handleOpenWorktreeTerminal: ProjectActionsContextValue['onOpenWorktreeTerminal'];
  handleDragEnd: ProjectActionsContextValue['onDragEnd'];
  handleSaveProjectSettings: ProjectActionsContextValue['onSaveProjectSettings'];
  // file actions
  handleFileSelect: FileActionsContextValue['onFileSelect'];
  handleFileRefresh: FileActionsContextValue['onFileRefresh'];
  fileView: {
    closeTab: FileActionsContextValue['onFileCloseTab'];
    activateTab: FileActionsContextValue['onFileActivateTab'];
    saveFile: FileActionsContextValue['onFileSave'];
    updateTabContent: FileActionsContextValue['onFileContentChange'];
    loadFileTree: FileActionsContextValue['onLoadFileTree'];
    expandSubTree: FileActionsContextValue['onExpandDir'];
  };
  // wsl
  wslEntries: ConnectionProjectContextValue['wslEntries'];
  wslOpenSessions: ConnectionProjectContextValue['wslOpenSessions'];
  activeWslWorktreePath: ConnectionProjectContextValue['activeWslWorktreePath'];
  wslDiffState: ConnectionProjectContextValue['wslDiffState'];
  setWslOpenSessions: ConnectionProjectContextValue['setWslOpenSessions'];
  handleCloseWslProject: ConnectionProjectContextValue['onCloseWslProject'];
  handleRemoveWslProject: ConnectionProjectContextValue['onRemoveWslProject'];
  handleRemoveWslEntry: ConnectionProjectContextValue['onRemoveWslEntry'];
  handleAddWslProject: ConnectionProjectContextValue['onAddWslProject'];
  handleSelectWslFile: ConnectionProjectContextValue['onSelectWslFile'];
  handleRefreshWslGit: ConnectionProjectContextValue['onRefreshWslGit'];
  handleOpenWslIde: ConnectionProjectContextValue['onOpenWslIde'];
  handleOpenWslWorktreeTerminal: ConnectionProjectContextValue['onOpenWslWorktreeTerminal'];
  handleWslDiffBack: ConnectionProjectContextValue['onWslDiffBack'];
  handleWslDragEnd: ConnectionProjectContextValue['onWslDragEnd'];
  wslDialogOpen: AppModalsProps['wslDialogOpen'];
  wslAddToEntryId: AppModalsProps['wslAddToEntryId'];
  handleWslDialogClose: AppModalsProps['onWslDialogClose'];
  handleWslEntryAdd: AppModalsProps['onAddWslEntry'];
  // remote
  remoteEntries: ConnectionProjectContextValue['remoteEntries'];
  remoteOpenSessions: ConnectionProjectContextValue['remoteOpenSessions'];
  activeRemoteWorktreePath: ConnectionProjectContextValue['activeRemoteWorktreePath'];
  remoteAuthStore: ConnectionProjectContextValue['remoteAuthStore'];
  setRemoteOpenSessions: ConnectionProjectContextValue['setRemoteOpenSessions'];
  handleCloseRemoteProject: ConnectionProjectContextValue['onCloseRemoteProject'];
  handleRemoveRemoteProject: ConnectionProjectContextValue['onRemoveRemoteProject'];
  handleRemoveRemoteEntry: ConnectionProjectContextValue['onRemoveRemoteEntry'];
  handleAddRemoteProject: ConnectionProjectContextValue['onAddRemoteProject'];
  handleRefreshRemoteGit: ConnectionProjectContextValue['onRefreshRemoteGit'];
  handleOpenRemoteIde: ConnectionProjectContextValue['onOpenRemoteIde'];
  handleOpenRemoteWorktreeTerminal: ConnectionProjectContextValue['onOpenRemoteWorktreeTerminal'];
  invokeRemoteGit: ConnectionProjectContextValue['invokeRemoteGit'];
  handleRemoteDragEnd: ConnectionProjectContextValue['onRemoteDragEnd'];
  remoteDialogOpen: AppModalsProps['remoteDialogOpen'];
  remoteAddToEntryId: AppModalsProps['remoteAddToEntryId'];
  handleRemoteDialogClose: AppModalsProps['onRemoteDialogClose'];
  handleRemoteEntryAdd: AppModalsProps['onAddRemoteEntry'];
  pendingAuthEntry: AppModalsProps['pendingAuthEntry'];
  setPendingAuthEntry: ConnectionProjectContextValue['setPendingAuthEntry'];
  // editor
  tabs: EditorContextValue['tabs'];
  activeTabId: EditorContextValue['activeTabId'];
  handleActivateTab: EditorContextValue['onActivateTab'];
  handleCloseTab: EditorContextValue['onCloseTab'];
  handleAddTab: EditorContextValue['onAddTab'];
  handleTabStatusChange: EditorContextValue['onTabStatusChange'];
  handleAgentClick: EditorContextValue['onAgentClick'];
  handleToggleHiddenAgent: EditorContextValue['onToggleHiddenAgent'];
  // modals
  confirmExitOpen: AppModalsProps['confirmExitOpen'];
  onConfirmExit: AppModalsProps['onConfirmExit'];
  onCancelExit: AppModalsProps['onCancelExit'];
  onRemoteAuthCancel: AppModalsProps['onRemoteAuthCancel'];
  onRemoteAuthSuccess: AppModalsProps['onRemoteAuthSuccess'];
}

export function buildAppShellValues(data: AppShellData) {
  const {
    config,
    customThemes,
    saveConfig,
    showToast,
    agents,
    loading,
    handleRemoveProject,
    handleSelectProject,
    handleAddProject,
    handleSelectFile,
    handleRefreshGit,
    handleBackToMainTerminal,
    handleOpenIdeForSidebar,
    handleOpenWorktreeTerminal,
    handleDragEnd,
    handleSaveProjectSettings,
    handleFileSelect,
    handleFileRefresh,
    fileView,
    wslEntries,
    wslOpenSessions,
    activeWslWorktreePath,
    wslDiffState,
    setWslOpenSessions,
    handleCloseWslProject,
    handleRemoveWslProject,
    handleRemoveWslEntry,
    handleAddWslProject,
    handleSelectWslFile,
    handleRefreshWslGit,
    handleOpenWslIde,
    handleOpenWslWorktreeTerminal,
    handleWslDiffBack,
    handleWslDragEnd,
    wslDialogOpen,
    wslAddToEntryId,
    handleWslDialogClose,
    handleWslEntryAdd,
    remoteEntries,
    remoteOpenSessions,
    activeRemoteWorktreePath,
    remoteAuthStore,
    setRemoteOpenSessions,
    handleCloseRemoteProject,
    handleRemoveRemoteProject,
    handleRemoveRemoteEntry,
    handleAddRemoteProject,
    handleRefreshRemoteGit,
    handleOpenRemoteIde,
    handleOpenRemoteWorktreeTerminal,
    invokeRemoteGit,
    handleRemoteDragEnd,
    remoteDialogOpen,
    remoteAddToEntryId,
    handleRemoteDialogClose,
    handleRemoteEntryAdd,
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
    onConfirmExit,
    onCancelExit,
    onRemoteAuthCancel,
    onRemoteAuthSuccess,
  } = data;

  const projectActionsValue: ProjectActionsContextValue = {
    onRemoveProject: handleRemoveProject,
    onSelectProject: handleSelectProject,
    onAddProject: handleAddProject,
    onSelectFile: handleSelectFile,
    onRefreshGit: handleRefreshGit,
    onBackToMainTerminal: handleBackToMainTerminal,
    onOpenIde: handleOpenIdeForSidebar,
    onOpenWorktreeTerminal: handleOpenWorktreeTerminal,
    onDragEnd: handleDragEnd,
    onSaveProjectSettings: handleSaveProjectSettings,
  };
  const fileActionsValue: FileActionsContextValue = {
    onFileSelect: handleFileSelect,
    onFileRefresh: handleFileRefresh,
    onFileCloseTab: fileView.closeTab,
    onFileActivateTab: fileView.activateTab,
    onFileSave: fileView.saveFile,
    onFileContentChange: fileView.updateTabContent,
    onLoadFileTree: fileView.loadFileTree,
    onExpandDir: fileView.expandSubTree,
  };
  const connectionProjectValue: ConnectionProjectContextValue = {
    // WSL fields
    wslEntries,
    wslOpenSessions,
    activeWslWorktreePath,
    wslDiffState: wslDiffState ?? null,
    setWslOpenSessions,
    onCloseWslProject: handleCloseWslProject,
    onRemoveWslProject: handleRemoveWslProject,
    onRemoveWslEntry: handleRemoveWslEntry,
    onAddWslProject: handleAddWslProject,
    onSelectWslFile: handleSelectWslFile,
    onRefreshWslGit: handleRefreshWslGit,
    onOpenWslIde: handleOpenWslIde,
    onOpenWslWorktreeTerminal: handleOpenWslWorktreeTerminal,
    onWslDiffBack: handleWslDiffBack,
    onWslDragEnd: handleWslDragEnd,
    // Remote fields
    remoteEntries,
    remoteOpenSessions,
    activeRemoteWorktreePath,
    remoteAuthStore,
    setRemoteOpenSessions,
    onCloseRemoteProject: handleCloseRemoteProject,
    onRemoveRemoteProject: handleRemoveRemoteProject,
    onRemoveRemoteEntry: handleRemoveRemoteEntry,
    onAddRemoteProject: handleAddRemoteProject,
    onRefreshRemoteGit: handleRefreshRemoteGit,
    onOpenRemoteIde: handleOpenRemoteIde,
    onOpenRemoteWorktreeTerminal: handleOpenRemoteWorktreeTerminal,
    invokeRemoteGit,
    onRemoteDragEnd: handleRemoteDragEnd,
    setPendingAuthEntry,
  };
  const editorValue: EditorContextValue = {
    tabs,
    activeTabId,
    onActivateTab: handleActivateTab,
    onCloseTab: handleCloseTab,
    onAddTab: handleAddTab,
    onTabStatusChange: handleTabStatusChange,
    agents,
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
      agents,
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

  const appModalsProps: AppModalsProps = {
    confirmExitOpen,
    onConfirmExit,
    onCancelExit,
    wslDialogOpen,
    wslAddToEntryId,
    wslEntries,
    onWslDialogClose: handleWslDialogClose,
    onAddWslEntry: handleWslEntryAdd,
    remoteDialogOpen,
    remoteAddToEntryId,
    remoteEntries,
    onRemoteDialogClose: handleRemoteDialogClose,
    onAddRemoteEntry: handleRemoteEntryAdd,
    remoteAuthStore,
    pendingAuthEntry,
    onRemoteAuthCancel,
    onRemoteAuthSuccess,
  };

  return {
    projectActionsValue,
    fileActionsValue,
    connectionProjectValue,
    editorValue,
    appProvidersProps,
    appModalsProps,
  };
}
