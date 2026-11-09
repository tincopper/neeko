import { Terminal } from 'lucide-react';
import React from 'react';

import CountLabel from '@/shared/components/nav/CountLabel';
import NavRow from '@/shared/components/nav/NavRow';
import type { AgentSkillGroup } from '@/shared/types';

import AgentIcon from './AgentIcon';

interface AgentRailRowProps {
  group: AgentSkillGroup;
  active: boolean;
  /** 选中该行（回传 agent id —— 消费方直传稳定回调，行 memo 才有意义）。 */
  onSelect: (agentId: string) => void;
  /** Row test id — MCP 左栏用 `mcp-agent-row-*`；Skills 左栏不传（DOM 无该属性）。 */
  testId?: string;
}

/**
 * 左栏的 agent 行（Skills 面板与 MCP 导航面板共用）。
 * 两侧此前的实现逐字相同（仅 testId 有无之差），提取为单一实现；
 * 归属 agent feature：图标解析（AgentIcon）本就属于此域。
 */
const AgentRailRow: React.FC<AgentRailRowProps> = React.memo(
  ({ group, active, onSelect, testId }) => {
    return (
      <NavRow
        active={active}
        onSelect={() => onSelect(group.agent_id)}
        testId={testId}
        leading={
          <AgentIcon
            icon={group.agent_icon}
            size={16}
            className="h-4 w-4 rounded shrink-0"
            fallback={<Terminal className="h-3.5 w-3.5 shrink-0 opacity-50" />}
          />
        }
      >
        <span className="truncate flex-1 font-medium">{group.agent_name}</span>
        {!group.agent_enabled && <span className="text-[10px] text-text-muted">disabled</span>}
        <CountLabel loading={false} count={group.skills.length} />
      </NavRow>
    );
  },
);

AgentRailRow.displayName = 'AgentRailRow';

export default AgentRailRow;
