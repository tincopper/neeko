import React, { useCallback, useRef, useMemo } from "react";
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
import { Plus } from "@/shared/components/icons"
import { cn } from '@/lib/utils';
import TabItem from "./TabItem";
import AgentIcon from "@/features/agent/components/AgentIcon";
import type { Tab } from '@/shared/types/tab';
import type { AgentConfig } from '@/shared/types';

interface TabBarProps {
  tabs: Tab[];
  activeTabId: string | null;
  /** The id of the currently-pinned tab, if any. Used to render the pin indicator. */
  pinnedTabId?: string | null;
  onActivateTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onAddTerminalTab?: () => void;
  onContextMenu?: (tabId: string, e: React.MouseEvent) => void;
  /** 关闭其他 tab */
  onCloseOtherTabs?: (tabId: string) => void;
  /** 关闭所�?tab */
  onCloseAllTabs?: () => void;
  /** 启用拖拽排序 */
  reorderable?: boolean;
  onReorderTab?: (tabId: string, overId: string) => void;
  // Agent Bar 相关（仅终端 tab 时显示）
  agents?: AgentConfig[];
  showAgentBar?: boolean;
  onAgentClick?: (agent: AgentConfig) => void;
  compactMode?: boolean;
  hiddenAgentIds?: string[];
  onToggleHiddenAgent?: (agentId: string) => void;
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
  }
);

AgentBarButton.displayName = "AgentBarButton";

const TabBar: React.FC<TabBarProps> = React.memo(
  ({
    tabs,
    activeTabId,
    pinnedTabId = null,
    onActivateTab,
    onCloseTab,
    onAddTerminalTab,
    onContextMenu,
    reorderable = false,
    onReorderTab,
    agents = [],
    showAgentBar = false,
    onAgentClick,
    compactMode = false,
    hiddenAgentIds = [],
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

    // 空状�?
    if (tabs.length === 0) return null;

    // 终端 tab 数量
    const terminalTabCount = useMemo(
      () => tabs.filter((t) => t.data.kind === "terminal").length,
      [tabs]
    );

    // 当前激�?tab 是否为终�?
    const activeTab = useMemo(
      () => tabs.find((t) => t.id === activeTabId),
      [tabs, activeTabId]
    );
    const isActiveTerminal = activeTab?.data.kind === "terminal";

    // 过滤可见 agents
    const visibleAgents = useMemo(
      () =>
        agents.filter(
          (a) => a.enabled && !hiddenAgentIds.includes(a.id)
        ),
      [agents, hiddenAgentIds]
    );

    const handleAgentClick = useCallback(
      (agent: AgentConfig) => {
        onAgentClick?.(agent);
      },
      [onAgentClick]
    );

    const tabItems = useMemo(() => tabs.map((tab) => tab.id), [tabs]);

    const renderTabs = () => {
      if (reorderable && tabs.length > 1) {
        return (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={tabItems}
              strategy={horizontalListSortingStrategy}
            >
              {tabs.map((tab) => (
                <TabItem
                  key={tab.id}
                  tab={tab}
                  isActive={tab.id === activeTabId}
                  isPinned={tab.id === pinnedTabId}
                  reorderable
                  onActivate={onActivateTab}
                  onClose={onCloseTab}
                  onContextMenu={onContextMenu}
                  agents={agents}
                />
              ))}
            </SortableContext>
          </DndContext>
        );
      }

      return tabs.map((tab) => (
        <TabItem
          key={tab.id}
          tab={tab}
          isActive={tab.id === activeTabId}
          isPinned={tab.id === pinnedTabId}
          onActivate={onActivateTab}
          onClose={onCloseTab}
          onContextMenu={onContextMenu}
          agents={agents}
        />
      ));
    };

    return (
      <div className="shrink-0">
        {/* Tab 列表 */}
        <div
          ref={scrollRef}
          className="flex items-center gap-1 overflow-x-auto no-scrollbar"
          onWheel={handleWheel}
        >
          {renderTabs()}

          {/* 新增终端按钮 */}
          {terminalTabCount < 10 && onAddTerminalTab && (
            <button
              className="tb-icon-btn w-6 h-6 rounded-md flex items-center justify-center text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors"
              onClick={onAddTerminalTab}
              title="New terminal tab"
            >
              <Plus size={14} />
            </button>
          )}
        </div>

        {/* Agent Bar */}
        {showAgentBar && isActiveTerminal && visibleAgents.length > 0 && (
          <div
            className={cn(
              "flex items-center gap-1 px-2 pb-1",
              compactMode && "gap-0.5"
            )}
          >
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
  }
);

TabBar.displayName = "TabBar";

export default TabBar;
