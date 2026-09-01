import { SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import React, { useCallback, useMemo, useState } from 'react';

import { AgentIcon } from '@/features/agent';
import { cn } from '@/lib/utils';
import { ChevronDown, Plus } from '@/shared/components/icons';
import type { AgentConfig } from '@/shared/types';
import type { Tab } from '@/shared/types/tab';

import { useTabOverflow } from '../hooks/useTabOverflow';

import TabItem from './TabItem';
import TabOverflowMenu from './TabOverflowMenu';

/** 稳定的空数组默认值：避免默认参数每帧新建数组导致 memo / effect 失效 */
const EMPTY_TAB_IDS: string[] = [];

interface TabBarProps {
  tabs: Tab[];
  activeTabId: string | null;
  /** 已 pin 的 tab id 列表（pinned 面板内多个）。用于渲染 Pin 指示。 */
  pinnedTabIds?: string[];
  onActivateTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onAddTerminalTab?: () => void;
  onActionMenuOpen?: (buttonRect: DOMRect) => void;
  onContextMenu?: (tabId: string, e: React.MouseEvent) => void;
  /** 关闭其他 tab */
  onCloseOtherTabs?: (tabId: string) => void;
  /** 关闭所有 tab */
  onCloseAllTabs?: () => void;
  /** 双击 tab 栏空白区域快速新建文件 */
  onNewFileTab?: () => void;
  /** 启用拖拽排序（运行在 EditorGroupLayout 的共享 DndContext 内） */
  reorderable?: boolean;
  // Agent Bar 相关（仅终端 tab 时显示）
  agents?: AgentConfig[];
  showAgentBar?: boolean;
  onAgentClick?: (agent: AgentConfig) => void;
  compactMode?: boolean;
  hiddenAgentIds?: string[];
  onToggleHiddenAgent?: (agentId: string) => void;
  /** Render leading content (icon / status dots) for each tab. */
  renderTabLeading?: (tab: Tab) => React.ReactNode;
}

/** 单个 Agent 按钮 */
interface AgentBarButtonProps {
  agent: AgentConfig;
  compactMode: boolean;
  onClick: (agent: AgentConfig) => void;
}

const AgentBarButton: React.FC<AgentBarButtonProps> = React.memo(
  ({ agent, compactMode, onClick }) => {
    const handleClick = useCallback(() => {
      onClick(agent);
    }, [agent, onClick]);

    return (
      <button
        className="agent-bar-btn"
        onClick={handleClick}
        disabled={!agent.enabled}
        title={agent.name}
      >
        <AgentIcon icon={agent.icon} />
        {!compactMode && <span className="agent-bar-btn-name">{agent.name}</span>}
      </button>
    );
  },
);

AgentBarButton.displayName = 'AgentBarButton';

const TabBar: React.FC<TabBarProps> = React.memo(
  ({
    tabs,
    activeTabId,
    pinnedTabIds = EMPTY_TAB_IDS,
    onActivateTab,
    onCloseTab,
    onAddTerminalTab,
    onActionMenuOpen,
    onContextMenu,
    onNewFileTab,
    reorderable = false,
    agents = [],
    showAgentBar = false,
    onAgentClick,
    compactMode = false,
    hiddenAgentIds = [],
    renderTabLeading,
  }) => {
    const [overflowMenuAnchorEl, setOverflowMenuAnchorEl] = useState<HTMLElement | null>(null);

    const hasPlusButton = Boolean(onAddTerminalTab || onActionMenuOpen);

    // 溢出测量与计算（pinned 永不溢出，激活 tab 强制可见，收敛机制见 hook 注释）
    const { containerRef, getTabSizeRef, renderedTabs, hiddenTabs } = useTabOverflow({
      tabs,
      pinnedTabIds,
      activeTabId,
      hasPlusButton,
    });

    // 双击 tab 栏空白区域（非 tab 项、非按钮）快速新建文件
    const handleTabBarDoubleClick = useCallback(
      (e: React.MouseEvent) => {
        const target = e.target as HTMLElement;
        if (target.closest('[role="tab"]') || target.closest('button')) return;
        onNewFileTab?.();
      },
      [onNewFileTab],
    );

    const handleOverflowMenuClose = useCallback(() => setOverflowMenuAnchorEl(null), []);

    // 当前激活 tab 是否为终端
    const activeTab = useMemo(() => tabs.find((t) => t.id === activeTabId), [tabs, activeTabId]);
    const isActiveTerminal = activeTab?.data.kind === 'terminal';

    // 过滤可见 agents
    const visibleAgents = useMemo(
      () => agents.filter((a) => a.enabled && !hiddenAgentIds.includes(a.id)),
      [agents, hiddenAgentIds],
    );

    const handleAgentClick = useCallback(
      (agent: AgentConfig) => {
        onAgentClick?.(agent);
      },
      [onAgentClick],
    );

    // 空状态
    if (tabs.length === 0) return null;

    const renderTabs = () => {
      const renderItem = (tab: Tab) => (
        <div key={tab.id} ref={getTabSizeRef(tab.id)} className="flex shrink-0">
          <TabItem
            tab={tab}
            isActive={tab.id === activeTabId}
            isPinned={pinnedTabIds.includes(tab.id)}
            reorderable={reorderable}
            onActivate={onActivateTab}
            onClose={onCloseTab}
            onContextMenu={onContextMenu}
            renderLeading={renderTabLeading}
          />
        </div>
      );

      // 不设 tabs.length 下限：单 tab 面板也要可发起跨面板拖拽
      //（left 单 tab → pinned、pinned 最后一个 tab 拖出 unpin）。
      if (reorderable) {
        // 可排序分支必须运行在 EditorGroupLayout 的共享 DndContext 内
        //（跨面板碰撞检测）；TabBar 自身不自建 DndContext。
        // 仅可见 tab 参与排序；溢出 tab 无物理位置，不可拖拽。
        return (
          <SortableContext
            items={renderedTabs.map((tab) => tab.id)}
            strategy={horizontalListSortingStrategy}
          >
            {renderedTabs.map(renderItem)}
          </SortableContext>
        );
      }

      return renderedTabs.map(renderItem);
    };

    return (
      <div className="shrink-0">
        {/* Tab 列表（溢出 tab 收纳进下拉，不再横向滚动） */}
        <div
          ref={containerRef}
          role="tablist"
          tabIndex={-1}
          className="flex items-center gap-1 overflow-hidden"
          onDoubleClick={handleTabBarDoubleClick}
        >
          {renderTabs()}

          {/* 新增动作按钮：New Terminal / New Browser / …（始终显示，不受终端数量门控） */}
          {hasPlusButton && (
            <button
              className="tb-icon-btn w-6 h-6 rounded-md flex items-center justify-center text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors shrink-0"
              onClick={(e) => {
                if (onActionMenuOpen) {
                  onActionMenuOpen(e.currentTarget.getBoundingClientRect());
                } else {
                  onAddTerminalTab?.();
                }
              }}
              title="New action"
              aria-label="New action"
              aria-haspopup="menu"
            >
              <Plus size={14} />
            </button>
          )}

          {/* 溢出收纳按钮：仅存在被隐藏 tab 时渲染 */}
          {hiddenTabs.length > 0 && (
            <button
              className="tb-icon-btn w-6 h-6 rounded-md flex items-center justify-center text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors shrink-0"
              onClick={(e) => setOverflowMenuAnchorEl((prev) => (prev ? null : e.currentTarget))}
              title="Hidden tabs"
              aria-label="Hidden tabs"
              aria-haspopup="menu"
            >
              <ChevronDown size={14} />
            </button>
          )}
        </div>

        {/* Agent Bar */}
        {showAgentBar && isActiveTerminal && visibleAgents.length > 0 && (
          <div className={cn('flex items-center gap-1 px-2 pb-1', compactMode && 'gap-0.5')}>
            {visibleAgents.map((agent) => (
              <AgentBarButton
                key={agent.id}
                agent={agent}
                compactMode={compactMode}
                onClick={handleAgentClick}
              />
            ))}
          </div>
        )}

        {/* 溢出 tab 下拉（锚定 ⋯ 按钮，窗口缩放时跟随） */}
        {overflowMenuAnchorEl && hiddenTabs.length > 0 && (
          <TabOverflowMenu
            tabs={hiddenTabs}
            anchorEl={overflowMenuAnchorEl}
            onActivateTab={onActivateTab}
            onCloseTab={onCloseTab}
            onClose={handleOverflowMenuClose}
            renderLeading={renderTabLeading}
          />
        )}
      </div>
    );
  },
);

TabBar.displayName = 'TabBar';

export default TabBar;
