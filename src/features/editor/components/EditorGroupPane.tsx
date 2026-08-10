import { useDroppable } from '@dnd-kit/core';
import React, { useCallback, useMemo, useRef, useState } from 'react';

import { getActionMenuItems } from '@/features/action-menu';
import { ContextMenu } from '@/features/project';
import { cn } from '@/lib/utils';
import ConfirmDialog from '@/shared/components/ConfirmDialog';
import { useEditorContext, EditorProvider } from '@/shared/contexts';
import { useAppContext } from '@/shared/contexts/AppContext';
import type { AuthMethod, EditorGroupId } from '@/shared/types';
import type { Tab } from '@/shared/types/tab';

import { PINNED_DROP_PREFIX } from '../dragDrop';
import { useEditorGroupLayout } from '../hooks/useEditorGroupLayout';
import { usePaneActions } from '../hooks/usePaneActions';
import { usePaneAgents } from '../hooks/usePaneAgents';
import { usePaneContextMenu } from '../hooks/usePaneContextMenu';
import { usePaneSplit } from '../hooks/usePaneSplit';

import PaneContent from './PaneContent';
import PaneTabBar from './PaneTabBar';
import { renderEditorTabLeading } from './TabItemLeading';

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

  // ── 未保存关闭确认对话框 ──
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [closeConfirmFileName, setCloseConfirmFileName] = useState('');
  const closeConfirmResolverRef = useRef<((confirmed: boolean) => void) | null>(null);

  const handleRequestCloseTab = useCallback((fileName: string): Promise<boolean> => {
    setCloseConfirmFileName(fileName);
    setCloseConfirmOpen(true);
    return new Promise<boolean>((resolve) => {
      closeConfirmResolverRef.current = resolve;
    });
  }, []);

  const handleCloseConfirm = useCallback(() => {
    setCloseConfirmOpen(false);
    closeConfirmResolverRef.current?.(true);
    closeConfirmResolverRef.current = null;
  }, []);

  const handleCloseCancel = useCallback(() => {
    setCloseConfirmOpen(false);
    closeConfirmResolverRef.current?.(false);
    closeConfirmResolverRef.current = null;
  }, []);

  const layoutState = useEditorGroupLayout(tabKey);
  const {
    leftTabs,
    rightTabs,
    pinnedTabs,
    leftActiveTabId,
    rightActiveTabId,
    pinnedActiveTab,
    activeGroupId,
    splitRight: onSplitRight,
    moveToRight: onMoveToRight,
    moveToLeft: onMoveToLeft,
    closeOtherTabs: onCloseOtherTabs,
    closeAllTabs: onCloseAllTabs,
    pinTab,
    unpinTab,
  } = layoutState;

  // pinned 面板作为跨面板拖拽的 drop target：命中即触发 pin。
  // droppable id 按 groupId 唯一（dnd-kit 注册表以 id 为 key、后注册覆盖先注册，
  // 若三面板共用同一 id，left/right 的 disabled 注册会覆盖 pinned 的启用注册）。
  // 仅 groupId === 'pinned' 时启用并挂载 ref，其余面板 disabled 且无节点。
  const { setNodeRef: setPinnedPanelDropRef } = useDroppable({
    id: `${PINNED_DROP_PREFIX}:${tabKey}:${groupId}`,
    disabled: groupId !== 'pinned',
  });

  // Derive tabs / activeTabId from layout state based on this pane's groupId
  const tabs = useMemo(() => {
    if (groupId === 'left') return leftTabs;
    if (groupId === 'right') return rightTabs;
    if (groupId === 'pinned') return pinnedTabs;
    return [];
  }, [groupId, leftTabs, rightTabs, pinnedTabs]);

  const activeTabId = useMemo(() => {
    if (groupId === 'left') return leftActiveTabId;
    if (groupId === 'right') return rightActiveTabId;
    if (groupId === 'pinned') return pinnedActiveTab?.id ?? null;
    return null;
  }, [groupId, leftActiveTabId, rightActiveTabId, pinnedActiveTab]);

  const activeTab = useMemo(
    () => tabs.find((t) => t.id === activeTabId) ?? null,
    [tabs, activeTabId],
  );
  const projectIdForCheck = remoteProject?.projectId ?? activeTab?.projectId ?? null;

  // ── Action Menu ──
  const [actionMenuRect, setActionMenuRect] = React.useState<DOMRect | null>(null);

  const handleActionMenuOpen = useCallback((rect: DOMRect) => {
    setActionMenuRect(rect);
  }, []);

  const handleActionMenuClose = useCallback(() => {
    setActionMenuRect(null);
  }, []);

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
    onActionMenuClose: handleActionMenuClose,
    onRequestCloseTab: handleRequestCloseTab,
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

  const currentAgentId =
    (activeTab?.data.kind === 'terminal' ? activeTab.data.agentId : null) ?? null;

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

  const localEditorCtx = useMemo(
    () => ({
      ...globalEditorCtx,
      activeTabId,
      onActivateTab: handleActivateTab,
      onCloseTab: handleCloseTab,
      onAddTab: onAddTerminalTab ?? (() => {}),
    }),
    [globalEditorCtx, activeTabId, handleActivateTab, handleCloseTab, onAddTerminalTab],
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
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onFocusGroup();
          }
        }}
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
            onActionMenuOpen={handleActionMenuOpen}
            agents={installedEnabledAgents}
            renderTabLeading={renderTabLeading}
            actionMenuRect={actionMenuRect}
            actionMenuCtx={actionMenuCtx}
            actionMenuItems={actionMenuItems}
            onActionMenuClose={handleActionMenuClose}
            onActionMenuExecute={handleActionMenuExecute}
            onActionMenuAgentTerminal={handleActionMenuAgentTerminal}
            showAgentBarContent={showAgentBarContent}
            showAgentBarRow={showAgentBarRow}
            currentAgentId={currentAgentId}
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
        <ConfirmDialog
          open={closeConfirmOpen}
          onOpenChange={handleCloseCancel}
          title="未保存的更改"
          description={`"${closeConfirmFileName}" 有未保存的更改。确定要关闭吗？`}
          confirmLabel="关闭"
          onConfirm={handleCloseConfirm}
          danger
        />
      </div>
    </EditorProvider>
  );
}

export default React.memo(EditorGroupPane);
