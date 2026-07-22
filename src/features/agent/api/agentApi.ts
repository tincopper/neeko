import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { getAgentIconSrc as getPresetIconSrc } from '@/shared/utils/agents';

import type { AgentConfig } from '@/shared/types';

export function listAgents(): Promise<AgentConfig[]> {
  return invoke<AgentConfig[]>('list_agents');
}

export function getAgent(agentId: string): Promise<AgentConfig> {
  return invoke<AgentConfig>('get_agent', { agentId });
}

export function addAgent(agent: AgentConfig): Promise<void> {
  return invoke<void>('add_agent', { agent });
}

export function removeAgent(agentId: string): Promise<void> {
  return invoke<void>('remove_agent', { agentId });
}

export function setProjectAgents(projectId: string, agentIds: string[]): Promise<void> {
  return invoke<void>('set_project_agents', { projectId, agentIds });
}

/**
 * Check whether agent CLIs exist in the project's execution environment
 * (Local / WSL / SSH). Prefer always passing `projectId` for the active project.
 */
export function checkAgentsInstalled(
  agentIds?: string[],
  projectId?: string | null,
): Promise<Record<string, boolean>> {
  return invoke<Record<string, boolean>>('check_agents_installed', {
    agentIds,
    projectId: projectId ?? null,
  });
}

export function importAgentIcon(sourcePath: string): Promise<string> {
  return invoke<string>('import_agent_icon', { sourcePath });
}

export function resolveAgentIconSrc(icon: string | null | undefined): string | null {
  const preset = getPresetIconSrc(icon);
  if (preset) return preset;
  if (!icon) return null;
  return convertFileSrc(icon);
}
