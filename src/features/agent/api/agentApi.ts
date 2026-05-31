import { invoke } from '@tauri-apps/api/core';

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

export function setProjectAgent(projectId: string, agentId?: string | null): Promise<void> {
  return invoke<void>('set_project_agent', { projectId, agentId });
}

export function checkAgentsInstalled(agentIds?: string[]): Promise<Record<string, boolean>> {
  return invoke<Record<string, boolean>>('check_agents_installed', { agentIds });
}
