import { ChevronDown, ChevronRight, Terminal } from 'lucide-react';
import React, { useCallback, useState } from 'react';

// eslint-disable-next-line import/no-restricted-paths -- need agent icon resolution
import { resolveAgentIconSrc } from '@/features/agent/api/agentApi';
import { useMcpStore } from '@/features/library/store/mcpStore';
import { useSkillStore } from '@/features/skill/store';
import { cn } from '@/lib/utils';

/** Agent group list inside the MCP navigation panel (selecting one opens the agent view). */
const McpAgentGroupList: React.FC = React.memo(() => {
  const agentGroups = useSkillStore((s) => s.agentSkillGroups);
  const mcpView = useMcpStore((s) => s.mcpView);
  const activeMcpAgentId = useMcpStore((s) => s.activeMcpAgentId);
  const setActiveMcpAgentId = useMcpStore((s) => s.setActiveMcpAgentId);
  const setActiveMcpTagGroup = useMcpStore((s) => s.setActiveMcpTagGroup);
  const setMcpView = useMcpStore((s) => s.setMcpView);

  const [expanded, setExpanded] = useState(false);

  const handleSelect = useCallback(
    (agentId: string) => {
      setActiveMcpAgentId(agentId);
      setActiveMcpTagGroup(null);
      setMcpView('agent');
    },
    [setActiveMcpAgentId, setActiveMcpTagGroup, setMcpView],
  );

  return (
    <div className="border-t border-border mt-0.5 pt-1">
      <button
        type="button"
        className="flex items-center gap-1 px-3 py-1.5 w-full min-w-0 text-left select-none"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 text-text-muted shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 text-text-muted shrink-0" />
        )}
        <span className="text-[10.5px] font-bold tracking-[0.14em] uppercase text-text-muted">
          Agents
        </span>
      </button>
      {expanded && (
        <div className="pb-1 px-1.5">
          {agentGroups.length === 0 ? (
            <p className="px-2.5 py-1 text-[11px] text-text-muted leading-relaxed">
              No agents configured.
            </p>
          ) : (
            agentGroups.map((group) => {
              const icon = resolveAgentIconSrc(group.agent_icon);
              const isActive = mcpView === 'agent' && group.agent_id === activeMcpAgentId;
              return (
                <button
                  key={group.agent_id}
                  type="button"
                  onClick={() => handleSelect(group.agent_id)}
                  className={cn(
                    'flex items-center gap-2 w-full px-2.5 py-1.5 rounded-md text-left transition-colors duration-150',
                    'text-[var(--font-size)]',
                    isActive
                      ? 'bg-bg-selected text-text-primary'
                      : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
                  )}
                >
                  {icon ? (
                    <img src={icon} alt="" className="h-4 w-4 rounded shrink-0" />
                  ) : (
                    <Terminal className="h-3.5 w-3.5 shrink-0 opacity-50" />
                  )}
                  <span className="truncate flex-1 font-medium">{group.agent_name}</span>
                  {!group.agent_enabled && (
                    <span className="text-[10px] text-text-muted">disabled</span>
                  )}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
});

McpAgentGroupList.displayName = 'McpAgentGroupList';

export default McpAgentGroupList;
