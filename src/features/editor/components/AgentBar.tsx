import React from 'react';

import AgentIcon from '@/features/agent/components/AgentIcon';
import { ChevronDown, ChevronUp } from '@/shared/components/icons';
import type { AgentConfig } from '@/shared/types';

import { useAgentBarCollapse } from '../hooks/useAgentBarCollapse';

interface AgentBarProps {
  /** 已安装且启用的 agent 列表 */
  agents: AgentConfig[];
  /** 当前终端 tab 绑定的 agent id（选中高亮） */
  selectedAgentId: string | null;
  /** 紧凑模式：不显示 agent 名字 */
  compactMode: boolean;
  onAgentClick: (agent: AgentConfig) => void;
}

/**
 * terminal tab 下的 agent 操作行。
 *
 * 折叠态仅显示图标（紧凑），展开态显示图标 + 完整名字；
 * 展开态 flex-wrap 自适应换行（无滚动条），长名字 break-words 完整显示不被挤压。
 * 折叠/展开按钮恒显示（图标随状态切换），保证"折叠开/折叠关"闭环。
 *
 * 折叠状态由 useAgentBarCollapse 自管理（ResizeObserver 溢出测量 + 折叠态保护），
 * 组件卸载时 observer 自动 disconnect，无内存泄漏。
 */
function AgentBar({ agents, selectedAgentId, compactMode, onAgentClick }: AgentBarProps) {
  const {
    containerRef: agentListRef,
    collapsed: agentsCollapsed,
    toggleCollapsed: toggleAgentsCollapsed,
  } = useAgentBarCollapse({}, [agents.length]);

  // 折叠态仅图标（紧凑）；展开态显示图标 + 完整名字
  const showName = !compactMode && !agentsCollapsed;

  return (
    <>
      <div ref={agentListRef} className="flex flex-1 min-w-0 min-h-6 gap-1 flex-wrap items-center">
        {agents.map((agent) => {
          const selected = selectedAgentId === agent.id;
          return (
            <button
              key={agent.id}
              className={`tb-icon-btn flex items-center gap-1.5 px-2 min-h-6 max-w-full rounded-md transition-colors ${selected ? 'text-text-primary bg-bg-hover' : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'}`}
              style={{ fontSize: 'var(--terminal-font-size)' }}
              onClick={() => onAgentClick(agent)}
              title={agent.name}
            >
              <AgentIcon icon={agent.icon} />
              {showName && <span className="min-w-0 break-words">{agent.name}</span>}
            </button>
          );
        })}
      </div>
      {/* 折叠/展开按钮：恒显示，图标随状态切换，保证折叠开/关闭环 */}
      <button
        className="tb-icon-btn flex items-center justify-center w-6 h-6 rounded-md transition-colors text-text-secondary hover:bg-bg-hover hover:text-text-primary shrink-0"
        onClick={toggleAgentsCollapsed}
        title={agentsCollapsed ? 'Expand agents' : 'Collapse agents'}
        aria-label={agentsCollapsed ? 'Expand agents' : 'Collapse agents'}
      >
        {agentsCollapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
      </button>
    </>
  );
}

export default React.memo(AgentBar);
