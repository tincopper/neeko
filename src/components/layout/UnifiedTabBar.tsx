import React, { useCallback, useRef, useMemo } from "react";
import { Plus } from "lucide-react";
import { cn } from "../../utils/cn";
import UnifiedTabItem from "./UnifiedTabItem";
import AgentIcon from "./AgentIcon";
import type { Tab } from "../../types/tab";
import type { AgentConfig } from "../../types";

interface UnifiedTabBarProps {
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
  /** 关闭所有 tab */
  onCloseAllTabs?: () => void;
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

const UnifiedTabBar: React.FC<UnifiedTabBarProps> = React.memo(
  ({
    tabs,
    activeTabId,
    pinnedTabId = null,
    onActivateTab,
    onCloseTab,
    onAddTerminalTab,
    onContextMenu,
    agents = [],
    showAgentBar = false,
    onAgentClick,
    compactMode = false,
    hiddenAgentIds = [],
  }) => {
    const scrollRef = useRef<HTMLDivElement>(null);

    // 鼠标滚轮横向滚动
    const handleWheel = useCallback((e: React.WheelEvent) => {
      if (scrollRef.current) {
        scrollRef.current.scrollLeft += e.deltaY;
      }
    }, []);

    // 空状态
    if (tabs.length === 0) return null;

    // 终端 tab 数量
    const terminalTabCount = useMemo(
      () => tabs.filter((t) => t.data.kind === "terminal").length,
      [tabs]
    );

    // 当前激活 tab 是否为终端
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

    return (
      <div className="shrink-0">
        {/* Tab 列表 */}
        <div
          ref={scrollRef}
          className="flex items-center gap-1 overflow-x-auto no-scrollbar"
          onWheel={handleWheel}
        >
          {tabs.map((tab) => (
            <UnifiedTabItem
              key={tab.id}
              tab={tab}
              isActive={tab.id === activeTabId}
              isPinned={tab.id === pinnedTabId}
              onActivate={onActivateTab}
              onClose={onCloseTab}
              onContextMenu={onContextMenu}
              agents={agents}
            />
          ))}

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

UnifiedTabBar.displayName = "UnifiedTabBar";

export default UnifiedTabBar;
