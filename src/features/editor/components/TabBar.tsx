import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import React, { useCallback, useRef, useMemo } from 'react';

import { AgentIcon } from '@/features/agent';
import { cn } from '@/lib/utils';
import { Plus } from '@/shared/components/icons';
import type { AgentConfig } from '@/shared/types';
import type { Tab } from '@/shared/types/tab';

import TabItem from './TabItem';

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
  /** 启用拖拽排序 */
  reorderable?: boolean;
  onReorderTab?: (tabId: string, overId: string) => void;
  /**
   * 外部已提供共享 DndContext（跨面板拖拽场景）。为 true 时 TabBar 不自建
   * DndContext，仅渲染 SortableContext，依赖编辑布局层的共享 DndContext。
   */
  externalDnd?: boolean;
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
    pinnedTabIds = [],
    onActivateTab,
    onCloseTab,
    onAddTerminalTab,
    onActionMenuOpen,
    onContextMenu,
    onNewFileTab,
    reorderable = false,
    onReorderTab,
    externalDnd = false,
    agents = [],
    showAgentBar = false,
    onAgentClick,
    compactMode = false,
    hiddenAgentIds = [],
    renderTabLeading,
  }) => {
    const scrollRef = useRef<HTMLDivElement>(null);

    const sensors = useSensors(
      useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
      useSensor(KeyboardSensor),
    );

    const handleDragEnd = useCallback(
      (event: DragEndEvent) => {
        const { active, over } = event;
        if (over && active.id !== over.id) {
          onReorderTab?.(String(active.id), String(over.id));
        }
      },
      [onReorderTab],
    );

    // 鼠标滚轮横向滚动
    const handleWheel = useCallback((e: React.WheelEvent) => {
      if (scrollRef.current) {
        scrollRef.current.scrollLeft += e.deltaY;
      }
    }, []);

    // 双击 tab 栏空白区域（非 tab 项、非按钮）快速新建文件
    const handleTabBarDoubleClick = useCallback(
      (e: React.MouseEvent) => {
        const target = e.target as HTMLElement;
        if (target.closest('[role="tab"]') || target.closest('button')) return;
        onNewFileTab?.();
      },
      [onNewFileTab],
    );

    // 终端 tab 数量
    const terminalTabCount = useMemo(
      () => tabs.filter((t) => t.data.kind === 'terminal').length,
      [tabs],
    );

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

    const tabItems = useMemo(() => tabs.map((tab) => tab.id), [tabs]);

    // 空状态
    if (tabs.length === 0) return null;

    const renderTabs = () => {
      if (reorderable && tabs.length > 1) {
        const sortableContent = (
          <SortableContext items={tabItems} strategy={horizontalListSortingStrategy}>
            {tabs.map((tab) => (
              <TabItem
                key={tab.id}
                tab={tab}
                isActive={tab.id === activeTabId}
                isPinned={pinnedTabIds.includes(tab.id)}
                reorderable
                onActivate={onActivateTab}
                onClose={onCloseTab}
                onContextMenu={onContextMenu}
                renderLeading={renderTabLeading}
              />
            ))}
          </SortableContext>
        );

        // 外部共享 DndContext 场景：不自建，直接渲染 SortableContext。
        if (externalDnd) {
          return sortableContent;
        }

        return (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            {sortableContent}
          </DndContext>
        );
      }

      return tabs.map((tab) => (
        <TabItem
          key={tab.id}
          tab={tab}
          isActive={tab.id === activeTabId}
          isPinned={pinnedTabIds.includes(tab.id)}
          onActivate={onActivateTab}
          onClose={onCloseTab}
          onContextMenu={onContextMenu}
          renderLeading={renderTabLeading}
        />
      ));
    };

    return (
      <div className="shrink-0">
        {/* Tab 列表 */}
        <div
          ref={scrollRef}
          role="tablist"
          tabIndex={-1}
          className="flex items-center gap-1 overflow-x-auto no-scrollbar"
          onWheel={handleWheel}
          onDoubleClick={handleTabBarDoubleClick}
        >
          {renderTabs()}

          {/* 新增终端 / 动作菜单按钮 */}
          {terminalTabCount < 10 && (onAddTerminalTab || onActionMenuOpen) && (
            <button
              className="tb-icon-btn w-6 h-6 rounded-md flex items-center justify-center text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors"
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
      </div>
    );
  },
);

TabBar.displayName = 'TabBar';

export default TabBar;
