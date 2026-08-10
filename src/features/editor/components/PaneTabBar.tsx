import React from 'react';

import { ActionMenuDropdown, getActionMenuItems } from '@/features/action-menu';
import type { ActionContext } from '@/features/action-menu/types/actionMenu';
import type { SplitStateInfo } from '@/features/terminal';
import type { AgentConfig, EditorGroupId } from '@/shared/types';
import type { Tab } from '@/shared/types/tab';

import AgentBar from './AgentBar';
import TabBar from './TabBar';

interface PaneTabBarProps {
  groupId: EditorGroupId | 'pinned';
  tabs: Tab[];
  activeTabId: string | null;
  pinnedTabIds: string[];
  onActivateTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onAddTerminalTab?: () => void;
  onNewFileTab: () => void;
  onReorderTab: (tabId: string, overId: string) => void;
  onTabContextMenu: (tabId: string, e: React.MouseEvent) => void;
  onActionMenuOpen: (rect: DOMRect) => void;
  agents: AgentConfig[];
  renderTabLeading: (tab: Tab) => React.ReactNode;
  // Action menu
  actionMenuRect: DOMRect | null;
  actionMenuCtx: ActionContext;
  actionMenuItems: ReturnType<typeof getActionMenuItems>;
  onActionMenuClose: () => void;
  onActionMenuExecute: (item: ReturnType<typeof getActionMenuItems>[number]) => void;
  onActionMenuAgentTerminal: (agentId: string, agentName: string) => void;
  // Agent bar
  showAgentBarContent: boolean;
  showAgentBarRow: boolean;
  currentAgentId: string | null;
  compactMode: boolean;
  onAgentClick: (agent: AgentConfig) => void;
  // Split controls
  splitInfo: SplitStateInfo;
  onSplitHorizontal: () => void;
  onSplitVertical: () => void;
  onClosePane: () => void;
}

/**
 * 编辑器面板头部：TabBar、ActionMenu 下拉、Agent 快捷栏与分栏控制按钮。
 */
function PaneTabBar({
  groupId,
  tabs,
  activeTabId,
  pinnedTabIds,
  onActivateTab,
  onCloseTab,
  onAddTerminalTab,
  onNewFileTab,
  onReorderTab,
  onTabContextMenu,
  onActionMenuOpen,
  agents,
  renderTabLeading,
  actionMenuRect,
  actionMenuCtx,
  actionMenuItems,
  onActionMenuClose,
  onActionMenuExecute,
  onActionMenuAgentTerminal,
  showAgentBarContent,
  showAgentBarRow,
  currentAgentId,
  compactMode,
  onAgentClick,
  splitInfo,
  onSplitHorizontal,
  onSplitVertical,
  onClosePane,
}: PaneTabBarProps) {
  return (
    <div className="shrink-0 bg-bg-secondary">
      <div className="h-8 flex items-center px-2 gap-1">
        <div className="flex-1 min-w-0">
          <TabBar
            tabs={tabs}
            activeTabId={activeTabId}
            pinnedTabIds={pinnedTabIds}
            onActivateTab={onActivateTab}
            onCloseTab={onCloseTab}
            onAddTerminalTab={onAddTerminalTab}
            onActionMenuOpen={onActionMenuOpen}
            onContextMenu={onTabContextMenu}
            onNewFileTab={onNewFileTab}
            reorderable={groupId !== 'pinned'}
            onReorderTab={onReorderTab}
            externalDnd={groupId !== 'pinned'}
            agents={agents}
            renderTabLeading={renderTabLeading}
          />
        </div>
        {actionMenuRect && (
          <ActionMenuDropdown
            items={actionMenuItems}
            ctx={actionMenuCtx}
            anchorRect={actionMenuRect}
            onClose={onActionMenuClose}
            onExecute={onActionMenuExecute}
            onAddAgentTerminal={onActionMenuAgentTerminal}
          />
        )}
      </div>

      {showAgentBarRow && (
        <div className="px-2 py-1 flex flex-wrap items-center gap-1">
          {showAgentBarContent && (
            <AgentBar
              agents={agents}
              selectedAgentId={currentAgentId}
              compactMode={compactMode}
              onAgentClick={onAgentClick}
            />
          )}
          {!showAgentBarContent && <div className="flex-1" />}
          <div className="flex items-center gap-0.5 shrink-0 ml-auto">
            <button
              className="tb-icon-btn flex items-center justify-center w-6 h-6 rounded-md transition-colors text-text-secondary hover:bg-bg-hover hover:text-text-primary"
              title={splitInfo.canSplit ? 'Split Horizontal' : 'Maximum panes reached'}
              disabled={!splitInfo.canSplit}
              onClick={onSplitHorizontal}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <rect x="1" y="2" width="10" height="8" stroke="currentColor" strokeWidth="1" />
                <path d="M6 2V10" stroke="currentColor" strokeWidth="1" />
              </svg>
            </button>
            <button
              className="tb-icon-btn flex items-center justify-center w-6 h-6 rounded-md transition-colors text-text-secondary hover:bg-bg-hover hover:text-text-primary"
              title={splitInfo.canSplit ? 'Split Vertical' : 'Maximum panes reached'}
              disabled={!splitInfo.canSplit}
              onClick={onSplitVertical}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <rect x="1" y="2" width="10" height="8" stroke="currentColor" strokeWidth="1" />
                <path d="M1 6H11" stroke="currentColor" strokeWidth="1" />
              </svg>
            </button>
            {splitInfo.paneCount > 1 && (
              <button
                className="tb-icon-btn flex items-center justify-center w-6 h-6 rounded-md transition-colors text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                title="Close Pane"
                onClick={onClosePane}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <path
                    d="M3 3L9 9M9 3L3 9"
                    stroke="currentColor"
                    strokeWidth="1.2"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default React.memo(PaneTabBar);
