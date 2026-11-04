import { useDroppable } from '@dnd-kit/core';
import React, { useCallback, useMemo } from 'react';

import { getActionMenuItems } from '@/features/action-menu';
import { ContextMenu } from '@/features/project';
import { useEditorContext, EditorProvider } from '@/shared/contexts';
import { useAppContext } from '@/shared/contexts/AppContext';
import type { DockSlot } from '@/shared/dock';
import type { AuthMethod, EditorGroupId, EditorPaneId } from '@/shared/types';
import { centerDropTargetOf } from '@/shared/types/editorGroup';
import type { ProjectId } from '@/shared/utils/workspaceRef';

import { PINNED_DROP_PREFIX, editorPaneRegionClass } from '../dragDrop';
import { useFileActionsContext } from '../FileActionsContext';
import { useActionMenu } from '../hooks/useActionMenu';
import { useBulkCloseConfirmation } from '../hooks/useBulkCloseConfirmation';
import { useEditorGroupLayout } from '../hooks/useEditorGroupLayout';
import { usePaneActions } from '../hooks/usePaneActions';
import { usePaneAgents } from '../hooks/usePaneAgents';
import { usePaneContextMenu } from '../hooks/usePaneContextMenu';
import { usePaneEditorContext } from '../hooks/usePaneEditorContext';
import { usePaneSplit } from '../hooks/usePaneSplit';
import { usePaneTabs } from '../hooks/usePaneTabs';

import BulkCloseConfirmDialog from './BulkCloseConfirmDialog';
import PaneContent from './PaneContent';
import PaneTabBar from './PaneTabBar';

/** 面板容器键盘事件：Enter / Space 聚焦该面板 */
function handlePaneKeyDown(e: React.KeyboardEvent<HTMLDivElement>, onFocusGroup: () => void) {
  if (e.target !== e.currentTarget) return;
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    onFocusGroup();
  }
}

export interface EditorGroupPaneProps {
  /**
   * Pane 身份：中心两组（left/right）、pinned 面板，或槽位 tab 宿主（dockLeft/dockRight）。
   * 同一套组语义（组即顺序与归属），因此 tab 渲染管线零分叉。
   */
  paneId: EditorPaneId;
  /**
   * 工具栏变体：`full` = 中心编辑器（Action Menu / Agent Bar / 分屏控件全开）；
   * `dock` = 停靠宿主（只留 tab 条 —— 停靠区不提供新建 / 分屏 / Agent Bar）。
   */
  chrome?: 'full' | 'dock';
  /** Composite tab key — used by the pane to lookup layout & store state */
  tabKey: string;
  onAddTerminalTab?: (targetGroup?: EditorGroupId | 'pinned') => void;
  onFocusGroup: () => void;
  remoteProject?: {
    entryId: string;
    projectId: ProjectId;
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
  /**
   * 本 pane 是否为当前可见 surface（浏览器 tab 的 sub-webview 依赖它开关）。
   * 中心 pane 缺省按激活组推导；dock 宿主由宿主按「槽位展开 + 本宿主为前台」传入。
   */
  isActivePane?: boolean;
  /** dock 入口（app 注入的唯一跨 store 编排点 `moveTabToSlot`；缺省则不提供菜单项）。 */
  onMoveTabToSlot?: (tabId: string, target: 'center' | DockSlot) => void;
}

function EditorGroupPane({
  paneId,
  chrome = 'full',
  tabKey,
  onAddTerminalTab,
  onFocusGroup,
  remoteProject,
  layoutId,
  isActivePane,
  onMoveTabToSlot,
}: EditorGroupPaneProps) {
  const globalEditorCtx = useEditorContext();
  const { agents, compactMode, showAgentBar, hiddenAgentIds, onAgentClick } = globalEditorCtx;
  const { config, showToast } = useAppContext();
  const { onFileSaveTab } = useFileActionsContext();
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

  // pinned 面板作为跨面板拖拽的 drop target：droppable id 按 paneId 唯一，
  // 避免 left/right 的 disabled 注册覆盖 pinned 的启用注册。
  const { setNodeRef: setPinnedPanelDropRef, isOver: isOverPinnedDrop } = useDroppable({
    id: `${PINNED_DROP_PREFIX}:${tabKey}:${paneId}`,
    disabled: paneId !== 'pinned',
  });

  // Derive tabs / activeTabId / projectId from layout based on this pane's identity
  const { tabs, activeTabId, activeTab, projectIdForCheck } = usePaneTabs(
    paneId,
    layoutState,
    remoteProject?.projectId ?? null,
  );

  // ── Action Menu ──
  const { actionMenuRect, openActionMenu, closeActionMenu } = useActionMenu();

  // ── Agents（先于 usePaneActions：安装状态过滤结果是 Action Menu 的数据源）──
  const { handleAgentClick, enabledAgents, installedEnabledAgents, renderTabLeading } =
    usePaneAgents({
      agents,
      hiddenAgentIds,
      projectIdForCheck,
      onAgentClick,
      showToast,
    });

  const {
    handleActivateTab,
    handleCloseTab,
    handleActionMenuExecute,
    handleActionMenuAgentTerminal,
    handleNewFileTab,
    actionMenuCtx,
  } = usePaneActions({
    tabKey,
    paneId,
    projectIdForCheck,
    agents: installedEnabledAgents,
    onAddTerminalTab,
    onActionMenuClose: closeActionMenu,
    onSaveTab: onFileSaveTab,
  });

  const actionMenuItems = useMemo(() => getActionMenuItems(actionMenuCtx), [actionMenuCtx]);

  const currentAgentId = activeTab?.data.kind === 'terminal' ? activeTab.data.agentId : null;

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
      paneId,
      onMoveTabToSlot,
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

  // 新建终端 tab 的落组：dock 宿主不是落组（新建跟随中心激活组），且 dock chrome 不给入口
  const addTerminalTarget = centerDropTargetOf(paneId);
  const handleAddTerminalTab = useCallback(() => {
    onAddTerminalTab?.(addTerminalTarget ?? undefined);
  }, [addTerminalTarget, onAddTerminalTab]);

  // dock chrome 的可见性由宿主给出（槽位展开 + 本宿主为前台）；中心 pane 按激活组推导
  const paneIsActive = isActivePane ?? (paneId === 'pinned' || activeGroupId === paneId);

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
        ref={paneId === 'pinned' ? setPinnedPanelDropRef : undefined}
        className={editorPaneRegionClass({
          paneId,
          activeGroupId,
          isOverDropTarget: isOverPinnedDrop,
        })}
        onClick={onFocusGroup}
        onKeyDown={(e) => handlePaneKeyDown(e, onFocusGroup)}
      >
        {/* Tab Bar */}
        {tabs.length > 0 && (
          <PaneTabBar
            chrome={chrome}
            tabs={tabs}
            activeTabId={activeTabId}
            pinnedTabIds={pinnedTabs.map((t) => t.id)}
            onActivateTab={handleActivateTab}
            onCloseTab={handleCloseTab}
            onAddTerminalTab={addTerminalTarget ? handleAddTerminalTab : undefined}
            onNewFileTab={handleNewFileTab}
            onTabContextMenu={handleTabContextMenu}
            onActionMenuOpen={chrome === 'full' ? openActionMenu : undefined}
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
            // pinned 面板只要渲染即视为激活组；left/right 需为当前激活组；dock 由宿主给出。
            isActiveGroup={paneIsActive}
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
