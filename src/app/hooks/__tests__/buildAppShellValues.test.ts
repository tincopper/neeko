import { describe, expect, it, vi } from 'vitest';

import { buildAppShellValues, type AppShellData } from '../buildAppShellValues';

function makeData(): AppShellData {
  const fn = vi.fn();
  const fileView = {
    closeTab: vi.fn(),
    activateTab: vi.fn(),
    saveFile: vi.fn(),
    saveTabById: vi.fn(),
    updateTabContent: vi.fn(),
    loadFileTree: vi.fn(),
    expandSubTree: vi.fn(),
  };
  return {
    config: {
      agentSelectorCompactMode: true,
      agentSelectorShowPresetBar: false,
      hiddenAgentIds: ['agent-x'],
      ideCommandOverrides: { vscode: 'code' },
      shortcuts: {},
      terminalFontSize: 14,
      shell: '/bin/zsh',
      fontFamily: 'mono',
      terminalGpuAcceleration: true,
      agentCommandOverrides: {},
    } as AppShellData['config'],
    customThemes: [],
    saveConfig: fn,
    showToast: fn,
    agents: [{ id: 'a1', name: 'A1', command: 'cmd' }] as AppShellData['agents'],
    loading: false,
    handleRemoveProject: fn,
    handleSelectProject: fn,
    handleAddProject: fn,
    handleSelectFile: fn,
    handleRefreshGit: fn,
    handleBackToMainTerminal: fn,
    handleOpenIdeForSidebar: fn,
    handleOpenWorktreeTerminal: fn,
    handleDragEnd: fn,
    handleSaveProjectSettings: fn,
    handleFileSelect: fn,
    handleFileRefresh: fn,
    fileView,
    wslEntries: [],
    wslOpenSessions: [],
    activeWslWorktreePath: '/wt',
    wslDiffState: { distro: 'Ubuntu', projectPath: '/p', filePath: 'f.ts' },
    setWslOpenSessions: fn,
    handleCloseWslProject: fn,
    handleRemoveWslProject: fn,
    handleRemoveWslEntry: fn,
    handleAddWslProject: fn,
    handleSelectWslFile: fn,
    handleRefreshWslGit: fn,
    handleOpenWslIde: fn,
    handleOpenWslWorktreeTerminal: fn,
    handleWslDiffBack: fn,
    handleWslDragEnd: fn,
    wslDialogOpen: true,
    wslAddToEntryId: 'wsl-1',
    handleWslDialogClose: fn,
    handleWslEntryAdd: fn,
    remoteEntries: [],
    remoteOpenSessions: [],
    activeRemoteWorktreePath: null,
    remoteAuthStore: {} as AppShellData['remoteAuthStore'],
    setRemoteOpenSessions: fn,
    handleCloseRemoteProject: fn,
    handleRemoveRemoteProject: fn,
    handleRemoveRemoteEntry: fn,
    handleAddRemoteProject: fn,
    handleRefreshRemoteGit: fn,
    handleOpenRemoteIde: fn,
    handleOpenRemoteWorktreeTerminal: fn,
    invokeRemoteGit: fn,
    handleRemoteDragEnd: fn,
    remoteDialogOpen: false,
    remoteAddToEntryId: null,
    handleRemoteDialogClose: fn,
    handleRemoteEntryAdd: fn,
    pendingAuthEntry: null,
    setPendingAuthEntry: fn,
    tabs: [],
    activeTabId: 'tab-1',
    handleActivateTab: fn,
    handleCloseTab: fn,
    handleAddTab: fn,
    handleTabStatusChange: fn,
    handleAgentClick: fn,
    handleToggleHiddenAgent: fn,
    confirmExitOpen: true,
    unsavedFileNames: ['a.ts'],
    onConfirmExit: fn,
    onCancelExit: fn,
    onRemoteAuthCancel: fn,
    onRemoteAuthSuccess: fn,
    cloneDialogOpen: false,
    handleCloneDialogClose: fn,
    handleCloneSuccess: fn,
  };
}

describe('buildAppShellValues', () => {
  it('should_forward_project_actions_callbacks', () => {
    const data = makeData();
    const { projectActionsValue } = buildAppShellValues(data);

    expect(projectActionsValue.onRemoveProject).toBe(data.handleRemoveProject);
    expect(projectActionsValue.onSelectProject).toBe(data.handleSelectProject);
    expect(projectActionsValue.onAddProject).toBe(data.handleAddProject);
    expect(projectActionsValue.onSelectFile).toBe(data.handleSelectFile);
    expect(projectActionsValue.onRefreshGit).toBe(data.handleRefreshGit);
    expect(projectActionsValue.onBackToMainTerminal).toBe(data.handleBackToMainTerminal);
    expect(projectActionsValue.onOpenIde).toBe(data.handleOpenIdeForSidebar);
    expect(projectActionsValue.onOpenWorktreeTerminal).toBe(data.handleOpenWorktreeTerminal);
    expect(projectActionsValue.onDragEnd).toBe(data.handleDragEnd);
    expect(projectActionsValue.onSaveProjectSettings).toBe(data.handleSaveProjectSettings);
  });

  it('should_forward_file_actions_callbacks', () => {
    const data = makeData();
    const { fileActionsValue } = buildAppShellValues(data);

    expect(fileActionsValue.onFileSelect).toBe(data.handleFileSelect);
    expect(fileActionsValue.onFileRefresh).toBe(data.handleFileRefresh);
    expect(fileActionsValue.onFileCloseTab).toBe(data.fileView.closeTab);
    expect(fileActionsValue.onFileActivateTab).toBe(data.fileView.activateTab);
    expect(fileActionsValue.onFileSave).toBe(data.fileView.saveFile);
    expect(fileActionsValue.onFileSaveTab).toBe(data.fileView.saveTabById);
    expect(fileActionsValue.onFileContentChange).toBe(data.fileView.updateTabContent);
    expect(fileActionsValue.onLoadFileTree).toBe(data.fileView.loadFileTree);
    expect(fileActionsValue.onExpandDir).toBe(data.fileView.expandSubTree);
  });

  it('should_forward_wsl_and_remote_connection_fields', () => {
    const data = makeData();
    const { connectionProjectValue } = buildAppShellValues(data);

    // WSL
    expect(connectionProjectValue.wslEntries).toBe(data.wslEntries);
    expect(connectionProjectValue.wslOpenSessions).toBe(data.wslOpenSessions);
    expect(connectionProjectValue.activeWslWorktreePath).toBe('/wt');
    expect(connectionProjectValue.wslDiffState).toEqual(data.wslDiffState);
    expect(connectionProjectValue.onCloseWslProject).toBe(data.handleCloseWslProject);
    expect(connectionProjectValue.onSelectWslFile).toBe(data.handleSelectWslFile);
    expect(connectionProjectValue.onRefreshWslGit).toBe(data.handleRefreshWslGit);
    expect(connectionProjectValue.onOpenWslIde).toBe(data.handleOpenWslIde);
    expect(connectionProjectValue.onOpenWslWorktreeTerminal).toBe(
      data.handleOpenWslWorktreeTerminal,
    );
    expect(connectionProjectValue.onWslDiffBack).toBe(data.handleWslDiffBack);
    // Remote
    expect(connectionProjectValue.remoteEntries).toBe(data.remoteEntries);
    expect(connectionProjectValue.remoteOpenSessions).toBe(data.remoteOpenSessions);
    expect(connectionProjectValue.activeRemoteWorktreePath).toBeNull();
    expect(connectionProjectValue.remoteAuthStore).toBe(data.remoteAuthStore);
    expect(connectionProjectValue.onCloseRemoteProject).toBe(data.handleCloseRemoteProject);
    expect(connectionProjectValue.onRefreshRemoteGit).toBe(data.handleRefreshRemoteGit);
    expect(connectionProjectValue.onOpenRemoteIde).toBe(data.handleOpenRemoteIde);
    expect(connectionProjectValue.invokeRemoteGit).toBe(data.invokeRemoteGit);
    expect(connectionProjectValue.onRemoteDragEnd).toBe(data.handleRemoteDragEnd);
    expect(connectionProjectValue.setPendingAuthEntry).toBe(data.setPendingAuthEntry);
  });

  it('should_nullify_wsl_diff_state_when_absent', () => {
    const data = makeData();
    data.wslDiffState = null as never;
    const { connectionProjectValue } = buildAppShellValues(data);
    expect(connectionProjectValue.wslDiffState).toBeNull();
  });

  it('should_apply_editor_config_defaults', () => {
    const data = makeData();
    const { editorValue } = buildAppShellValues(data);

    expect(editorValue.tabs).toBe(data.tabs);
    expect(editorValue.activeTabId).toBe('tab-1');
    expect(editorValue.agents).toBe(data.agents);
    // config-driven
    expect(editorValue.compactMode).toBe(true);
    expect(editorValue.showAgentBar).toBe(false);
    expect(editorValue.hiddenAgentIds).toEqual(['agent-x']);
    expect(editorValue.onAgentClick).toBe(data.handleAgentClick);
    expect(editorValue.onToggleHiddenAgent).toBe(data.handleToggleHiddenAgent);
  });

  it('should_apply_editor_defaults_when_config_missing', () => {
    const data = makeData();
    data.config = {
      shortcuts: {},
    } as AppShellData['config'];
    const { editorValue } = buildAppShellValues(data);

    expect(editorValue.compactMode).toBe(false);
    expect(editorValue.showAgentBar).toBe(true);
    expect(editorValue.hiddenAgentIds).toEqual([]);
  });

  it('should_assemble_app_providers_props', () => {
    const data = makeData();
    const {
      appProvidersProps,
      projectActionsValue,
      fileActionsValue,
      connectionProjectValue,
      editorValue,
    } = buildAppShellValues(data);

    expect(appProvidersProps.appValue.config).toBe(data.config);
    expect(appProvidersProps.appValue.customThemes).toBe(data.customThemes);
    expect(appProvidersProps.appValue.agents).toBe(data.agents);
    expect(appProvidersProps.appValue.loading).toBe(false);
    expect(appProvidersProps.appValue.showToast).toBe(data.showToast);
    expect(appProvidersProps.appValue.saveConfig).toBe(data.saveConfig);
    expect(appProvidersProps.appValue.ideCommandOverrides).toEqual({ vscode: 'code' });
    expect(appProvidersProps.projectActionsValue).toBe(projectActionsValue);
    expect(appProvidersProps.fileActionsValue).toBe(fileActionsValue);
    expect(appProvidersProps.connectionProjectValue).toBe(connectionProjectValue);
    expect(appProvidersProps.editorValue).toBe(editorValue);
  });

  it('should_assemble_modals_props', () => {
    const data = makeData();
    const { appModalsProps } = buildAppShellValues(data);

    expect(appModalsProps.confirmExitOpen).toBe(true);
    expect(appModalsProps.unsavedFileNames).toEqual(['a.ts']);
    expect(appModalsProps.onConfirmExit).toBe(data.onConfirmExit);
    expect(appModalsProps.onCancelExit).toBe(data.onCancelExit);
    expect(appModalsProps.wslDialogOpen).toBe(true);
    expect(appModalsProps.wslAddToEntryId).toBe('wsl-1');
    expect(appModalsProps.wslEntries).toBe(data.wslEntries);
    expect(appModalsProps.onWslDialogClose).toBe(data.handleWslDialogClose);
    expect(appModalsProps.onAddWslEntry).toBe(data.handleWslEntryAdd);
    expect(appModalsProps.remoteDialogOpen).toBe(false);
    expect(appModalsProps.remoteAddToEntryId).toBeNull();
    expect(appModalsProps.remoteEntries).toBe(data.remoteEntries);
    expect(appModalsProps.onRemoteDialogClose).toBe(data.handleRemoteDialogClose);
    expect(appModalsProps.onAddRemoteEntry).toBe(data.handleRemoteEntryAdd);
    expect(appModalsProps.remoteAuthStore).toBe(data.remoteAuthStore);
    expect(appModalsProps.pendingAuthEntry).toBeNull();
    expect(appModalsProps.onRemoteAuthCancel).toBe(data.onRemoteAuthCancel);
    expect(appModalsProps.onRemoteAuthSuccess).toBe(data.onRemoteAuthSuccess);
  });
});
