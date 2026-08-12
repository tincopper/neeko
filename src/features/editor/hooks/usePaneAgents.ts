import { useCallback, useEffect, useMemo, useState } from 'react';

import { checkAgentsInstalled } from '@/features/agent/api/agentApi';
import type { AgentConfig } from '@/shared/types';
import { reportFrontendError } from '@/shared/utils/errorReporting';

interface UsePaneAgentsParams {
  agents: AgentConfig[];
  hiddenAgentIds: string[];
  projectIdForCheck: string | null;
  onAgentClick: (agent: AgentConfig) => void;
  showToast: (message: string, type?: 'info' | 'error') => void;
}

/**
 * Agent 安装状态检查、可点击过滤与点击处理。
 */
export function usePaneAgents({
  agents,
  hiddenAgentIds,
  projectIdForCheck,
  onAgentClick,
  showToast,
}: UsePaneAgentsParams) {
  const [installedMap, setInstalledMap] = useState<Map<string, boolean>>(new Map());

  useEffect(() => {
    if (agents.length === 0) return;
    const agentIds = agents.map((a) => a.id);
    checkAgentsInstalled(agentIds, projectIdForCheck)
      .then((result) => setInstalledMap(new Map(Object.entries(result))))
      .catch((err) => reportFrontendError('editor.checkAgentsInstalled', err));
  }, [agents, projectIdForCheck]);

  const handleAgentClick = useCallback(
    (agent: AgentConfig) => {
      const installed = installedMap.size === 0 || (installedMap.get(agent.id) ?? true);
      if (!installed) {
        showToast(`${agent.name} (${agent.command}) is not installed`, 'error');
        return;
      }
      if (!agent.enabled) return;
      onAgentClick(agent);
    },
    [installedMap, onAgentClick, showToast],
  );

  const enabledAgents = useMemo(
    () => agents.filter((a) => a.enabled && !hiddenAgentIds.includes(a.id)),
    [agents, hiddenAgentIds],
  );

  const installedEnabledAgents = useMemo(
    () => enabledAgents.filter((a) => installedMap.size === 0 || (installedMap.get(a.id) ?? true)),
    [enabledAgents, installedMap],
  );

  return { installedMap, handleAgentClick, enabledAgents, installedEnabledAgents };
}
