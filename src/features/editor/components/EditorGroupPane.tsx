import { useDroppable } from '@dnd-kit/core';
import React, { useCallback, useMemo } from 'react';

import { getActionMenuItems } from '@/features/action-menu';
import { ContextMenu } from '@/features/project';
import { cn } from '@/lib/utils';
import { useEditorContext, EditorProvider } from '@/shared/contexts';
import { useAppContext } from '@/shared/contexts/AppContext';
import type { AuthMethod, EditorGroupId } from '@/shared/types';
import type { Tab } from '@/shared/types/tab';

import { PINNED_DROP_PREFIX } from '../dragDrop';
import { useFileActionsContext } from '../FileActionsContext';
import { useActionMenu } from '../hooks/useActionMenu';
import { useBulkCloseConfirmation } from '../hooks/useBulkCloseConfirmation';
import { useCloseConfirmation } from '../hooks/useCloseConfirmation';
import { useEditorGroupLayout } from '../hooks/useEditorGroupLayout';
import { usePaneActions } from '../hooks/usePaneActions';
import { usePaneAgents } from '../hooks/usePaneAgents';
import { usePaneContextMenu } from '../hooks/usePaneContextMenu';
import { usePaneEditorContext } from '../hooks/usePaneEditorContext';
import { usePaneSplit } from '../hooks/usePaneSplit';
import { usePaneTabs } from '../hooks/usePaneTabs';

import BulkCloseConfirmDialog from './BulkCloseConfirmDialog';
import CloseConfirmDialog from './CloseConfirmDialog';
import PaneContent from './PaneContent';
import PaneTabBar from './PaneTabBar';
import { renderEditorTabLeading } from './TabItemLeading';

/** 面板容器键盘事件：Enter / Space 聚焦该面板 */
function handlePaneKeyDown(e: React.KeyboardEvent<HTMLDivElement>, onFocusGroup: () => void) {
  if (e.target !== e.currentTarget) return;
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    onFocusGroup();
  }
}

interface EditorGroupPaneProps {
  /** "left" | "right" for normal groups; "pinned" for the fixed pin panel */
  groupId: EditorGroupId | 'pinned';
  /** Composite tab key — used by the pane to lookup layout & store state */
  tabKey: string;
  onAddTerminalTab?: () => void;
  onFocusGroup: () => void;
  remoteProject?: {
    entryId: string;
    projectId: string;
    projectName: string;
    projectPath: string;
    host: string;
    port: number;
    username: string;
    auth: AuthMethod;
    cacheKeySuffix?: string;
    onSessionReady?: (pid: string) => void;
  } | null;
  layoutId: string;
}

function EditorGroupPane({
  groupId,
  tabKey,
  onAddTerminalTab,
  onFocusGroup,
  remoteProject,
  layoutId,
}: EditorGroupPaneProps) {
  const globalEditorCtx = useEditorContext();
  const { agents, compactMode, showAgentBar, hiddenAgentIds, onAgentClick } = globalEditorCtx;
  const { config, showToast } = useAppContext();
  const { onFileSaveTab } = useFileActionsContext();
  const {
    closeConfirmOpen,
    closeConfirmFileName,
    requestCloseConfirmation,
    onSave,
    onDiscard,
    onCancel,
  } = useCloseConfirmation();
  const handleRequestCloseTab = useCallback(
    (_tabId: string, fileName: string) => requestCloseConfirmation(fileName),
    [requestCloseConfirmation],
  );
  const {
    bulkCloseOpen,
    bulkCloseDirtyCount,
    bulkCloseDirtyPreview,
    requestBulkCloseConfirmation,
    confirmBulkClose,
    cancelBulkClose,
  } = useBulkCloseConfirmation();
  const layoutState = useEditorGroupLayout(tabKey, requestBulkCloseConfirmation);
  const {
    pinnedTabs,
    activeGroupId,
    splitRight: onSplitRight,
    moveToRight: onMoveToRight,
    moveToLeft: onMoveToLeft,
    closeOtherTabs: onCloseOtherTabs,
    closeAllTabs: onCloseAllTabs,
    pinTab,
    unpinTab,
  } = layoutState;

  // pinned 面板作为跨面板拖拽的 drop target：droppable id 按 groupId 唯一，
  // 避免 left/right 的 disabled 注册覆盖 pinned 的启用注册。
  const { setNodeRef: setPinnedPanelDropRef } = useDroppable({
    id: `${PINNED_DROP_PREFIX}:${tabKey}:${groupId}`,
    disabled: groupId !== 'pinned',
  });

  // Derive tabs / activeTabId / projectId from layout based on this pane's groupId
  const { tabs, activeTabId, activeTab, projectIdForCheck } = usePaneTabs(
    groupId,
    layoutState,
    remoteProject?.projectId ?? null,
  );

  // ── Action Menu ──
  const { actionMenuRect, openActionMenu, closeActionMenu } = useActionMenu();

  const {
    handleActivateTab,
    handleCloseTab,
    handleReorderTab,
    handleActionMenuExecute,
    handleActionMenuAgentTerminal,
    handleNewFileTab,
    actionMenuCtx,
  } = usePaneActions({
    tabKey,
    groupId,
    tabs,
    projectIdForCheck,
    agents,
    onAddTerminalTab,
    onActionMenuClose: closeActionMenu,
    onRequestCloseTab: handleRequestCloseTab,
    onSaveTab: onFileSaveTab,
  });

  const actionMenuItems = useMemo(() => getActionMenuItems(actionMenuCtx), [actionMenuCtx]);

  // ── Agents ──
  const { handleAgentClick, enabledAgents, installedEnabledAgents } = usePaneAgents({
    agents,
    hiddenAgentIds,
    projectIdForCheck,
    onAgentClick,
    showToast,
  });

  const currentAgentId = activeTab?.data.kind === 'terminal' ? activeTab.data.agentId : null;

  const renderTabLeading = useCallback(
    (tab: Tab) => renderEditorTabLeading(tab, installedEnabledAgents),
    [installedEnabledAgents],
  );

  const showAgentBarContent =
    showAgentBar && activeTab?.data.kind === 'terminal' && installedEnabledAgents.length > 0;
  const showAgentBarRow = activeTab?.data.kind === 'terminal';

  // ── Split state ──
  const {
    splitInfo,
    splitHorizontalRef,
    splitVerticalRef,
    closePaneRef,
    handleSplitStateChange,
    handleSetSplitHorizontal,
    handleSetSplitVertical,
    handleSetClosePane,
  } = usePaneSplit();

  // ── Tab context menu ──
  const { contextMenu, closeContextMenu, contextMenuItems, handleTabContextMenu } =
    usePaneContextMenu({
      groupId,
      onCloseTab: handleCloseTab,
      onCloseOtherTabs,
      onCloseAllTabs,
      onSplitRight,
      onMoveToRight,
      onMoveToLeft,
      onUnpinTab: unpinTab,
      onPinTab: pinTab,
      pinnedTabs,
      onFocusGroup,
    });

  const localEditorCtx = usePaneEditorContext(
    globalEditorCtx,
    activeTabId,
    handleActivateTab,
    handleCloseTab,
    onAddTerminalTab,
  );

  return (
    <EditorProvider value={localEditorCtx}>
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <div
        role="region"
        tabIndex={-1}
        ref={groupId === 'pinned' ? setPinnedPanelDropRef : undefined}
        className={cn(
          'flex-1 flex flex-col overflow-hidden min-h-0',
          activeGroupId === groupId ? 'ring-1 ring-[var(--border-color)]/30' : '',
        )}
        onClick={onFocusGroup}
        onKeyDown={(e) => handlePaneKeyDown(e, onFocusGroup)}
      >
        {/* Tab Bar */}
        {tabs.length > 0 && (
          <PaneTabBar
            groupId={groupId}
            tabs={tabs}
            activeTabId={activeTabId}
            pinnedTabIds={pinnedTabs.map((t) => t.id)}
            onActivateTab={handleActivateTab}
            onCloseTab={handleCloseTab}
            onAddTerminalTab={onAddTerminalTab}
            onNewFileTab={handleNewFileTab}
            onReorderTab={handleReorderTab}
            onTabContextMenu={handleTabContextMenu}
            onActionMenuOpen={openActionMenu}
            onActionMenuClose={closeActionMenu}
            actionMenuRect={actionMenuRect}
            actionMenuCtx={actionMenuCtx}
            actionMenuItems={actionMenuItems}
            onActionMenuExecute={handleActionMenuExecute}
            onActionMenuAgentTerminal={handleActionMenuAgentTerminal}
            showAgentBarContent={showAgentBarContent}
            showAgentBarRow={showAgentBarRow}
            currentAgentId={currentAgentId}
            agents={installedEnabledAgents}
            renderTabLeading={renderTabLeading}
            compactMode={compactMode}
            onAgentClick={handleAgentClick}
            splitInfo={splitInfo}
            onSplitHorizontal={() => splitHorizontalRef.current?.()}
            onSplitVertical={() => splitVerticalRef.current?.()}
            onClosePane={() => closePaneRef.current?.()}
          />
        )}

        {/* Content Area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <PaneContent
            tabKey={tabKey}
            activeTab={activeTab}
            agents={enabledAgents}
            diffMode={config.diffMode}
            layoutId={layoutId}
            // pinned 面板只要渲染即视为激活组；left/right 需为当前激活组。
            isActiveGroup={groupId === 'pinned' || activeGroupId === groupId}
            remoteProject={remoteProject}
            onCloseTab={handleCloseTab}
            showToast={showToast}
            onSplitStateChange={handleSplitStateChange}
            onSetSplitHorizontal={handleSetSplitHorizontal}
            onSetSplitVertical={handleSetSplitVertical}
            onSetClosePane={handleSetClosePane}
          />
        </div>

        {/* Context Menu */}
        {contextMenu && (
          <ContextMenu
            position={{ x: contextMenu.x, y: contextMenu.y }}
            items={contextMenuItems}
            onClose={closeContextMenu}
          />
        )}

        {/* 未保存关闭确认对话框 */}
        <CloseConfirmDialog
          open={closeConfirmOpen}
          fileName={closeConfirmFileName}
          onSave={onSave}
          onDiscard={onDiscard}
          onCancel={onCancel}
        />

        {/* 批量关闭未保存确认对话框 */}
        <BulkCloseConfirmDialog
          open={bulkCloseOpen}
          dirtyCount={bulkCloseDirtyCount}
          dirtyPreview={bulkCloseDirtyPreview}
          onConfirm={confirmBulkClose}
          onCancel={cancelBulkClose}
        />
      </div>
    </EditorProvider>
  );
}

export default React.memo(EditorGroupPane);
