import { useCallback, useEffect, useMemo, useState } from 'react';

import { checkAgentsInstalled } from '@/features/agent/api/agentApi';
import type { AgentConfig } from '@/shared/types';

// Module-level cache: `${projectId}::${agentId}` — status is environment-specific.
const agentInstalledCache = new Map<string, boolean>();

function agentInstallCacheKey(projectId: string | null, agentId: string): string {
  return `${projectId ?? '__none__'}::${agentId}`;
}

interface UseProjectAgentsParams {
  agents: AgentConfig[];
  projectId: string | null;
  showToast: (message: string, type?: 'info' | 'error') => void;
  onAgentClick: (agent: AgentConfig) => void;
}

/**
 * 当前项目可安装 agent 的安装状态 + 点击门控。
 * 缓存按「项目环境」隔离（Local/WSL/SSH 各自 PATH）。
 */
export function useProjectAgents({
  agents,
  projectId,
  showToast,
  onAgentClick,
}: UseProjectAgentsParams): {
  installedMap: Map<string, boolean>;
  handleAgentClick: (agent: AgentConfig) => boolean;
} {
  const agentIdFingerprint = useMemo(
    () =>
      agents
        .map((a) => a.id)
        .sort()
        .join(','),
    [agents],
  );

  // Seed installed status from cache when agents change
  const [installedMap, setInstalledMap] = useState<Map<string, boolean>>(new Map());
  useEffect(() => {
    // Defer to avoid sync setState in effect (can trigger cascading renders)
    Promise.resolve().then(() => {
      const ids = agents.map((a) => a.id);
      const allCached = ids.every((id) =>
        agentInstalledCache.has(agentInstallCacheKey(projectId, id)),
      );
      if (allCached) {
        const map = new Map<string, boolean>();
        for (const id of ids) {
          map.set(id, agentInstalledCache.get(agentInstallCacheKey(projectId, id)) ?? true);
        }
        setInstalledMap(map);
      } else {
        setInstalledMap(new Map());
      }
    });
  }, [agentIdFingerprint, projectId, agents]);

  useEffect(() => {
    const ids = agents.map((a) => a.id);
    if (ids.length === 0) return;

    const missing = ids.filter(
      (id) => !agentInstalledCache.has(agentInstallCacheKey(projectId, id)),
    );
    if (missing.length === 0) return;

    checkAgentsInstalled(missing, projectId)
      .then((result) => {
        for (const [id, installed] of Object.entries(result)) {
          agentInstalledCache.set(agentInstallCacheKey(projectId, id), installed);
        }
        const map = new Map<string, boolean>();
        for (const id of ids) {
          map.set(id, agentInstalledCache.get(agentInstallCacheKey(projectId, id)) ?? true);
        }
        setInstalledMap(map);
      })
      .catch((err) => console.error('[useProjectAgents] Failed to check agents installed:', err));
  }, [agentIdFingerprint, projectId, agents]);

  const handleAgentClick = useCallback(
    (agent: AgentConfig) => {
      const installed = installedMap.size === 0 || (installedMap.get(agent.id) ?? true);
      if (!installed) {
        showToast(`${agent.name} (${agent.command}) is not installed`, 'error');
        return false;
      }
      if (!agent.enabled) return false;
      onAgentClick(agent);
      return true;
    },
    [installedMap, onAgentClick, showToast],
  );

  return { installedMap, handleAgentClick };
}
