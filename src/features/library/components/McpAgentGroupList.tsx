import { Terminal } from 'lucide-react';
import React, { useCallback } from 'react';

// eslint-disable-next-line import/no-restricted-paths -- need agent icon resolution
import { resolveAgentIconSrc } from '@/features/agent/api/agentApi';
import { useMcpStore } from '@/features/library/store/mcpStore';
import { useSkillStore } from '@/features/skill/store';
import CountLabel from '@/shared/components/nav/CountLabel';
import NavEmpty from '@/shared/components/nav/NavEmpty';
import NavRow from '@/shared/components/nav/NavRow';
import NavSection from '@/shared/components/nav/NavSection';
/** Agent group list inside the MCP navigation panel (selecting one opens the agent view). */
const McpAgentGroupList: React.FC = React.memo(() => {
  const agentGroups = useSkillStore((s) => s.agentSkillGroups);
  const mcpView = useMcpStore((s) => s.mcpView);
  const activeMcpAgentId = useMcpStore((s) => s.activeMcpAgentId);
  const setActiveMcpAgentId = useMcpStore((s) => s.setActiveMcpAgentId);
  const setActiveMcpTagGroup = useMcpStore((s) => s.setActiveMcpTagGroup);
  const setMcpView = useMcpStore((s) => s.setMcpView);

  const handleSelect = useCallback(
    (agentId: string) => {
      setActiveMcpAgentId(agentId);
      setActiveMcpTagGroup(null);
      setMcpView('agent');
    },
    [setActiveMcpAgentId, setActiveMcpTagGroup, setMcpView],
  );

  return (
    <NavSection title="Agents">
      {agentGroups.length === 0 ? (
        <NavEmpty>No agents configured.</NavEmpty>
      ) : (
        agentGroups.map((group) => {
          const icon = resolveAgentIconSrc(group.agent_icon);
          return (
            <NavRow
              key={group.agent_id}
              active={mcpView === 'agent' && group.agent_id === activeMcpAgentId}
              onSelect={() => handleSelect(group.agent_id)}
              testId={`mcp-agent-row-${group.agent_id}`}
              leading={
                icon ? (
                  <img src={icon} alt="" className="h-4 w-4 rounded shrink-0" />
                ) : (
                  <Terminal className="h-3.5 w-3.5 shrink-0 opacity-50" />
                )
              }
            >
              <span className="truncate flex-1 font-medium">{group.agent_name}</span>
              {!group.agent_enabled && (
                <span className="text-[10px] text-text-muted">disabled</span>
              )}
              <CountLabel loading={false} count={group.skills.length} />
            </NavRow>
          );
        })
      )}
    </NavSection>
  );
});

McpAgentGroupList.displayName = 'McpAgentGroupList';

export default McpAgentGroupList;
