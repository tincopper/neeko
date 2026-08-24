import { invoke, convertFileSrc } from '@tauri-apps/api/core';

import type { AgentConfig } from '@/shared/types';
import { getAgentIconSrc as getPresetIconSrc } from '@/shared/utils/agents';

/** Information about a model supported by an agent. */
export interface ModelInfo {
  /** Model identifier (slug), e.g. "anthropic/claude-sonnet-4-20250514". */
  id: string;
  /** Human-readable model name. */
  name: string;
  /** Upstream provider ID (e.g. "anthropic", "openai"). */
  provider_id?: string;
  /** Upstream provider name. */
  provider_name?: string;
  /** Supported reasoning efforts (e.g. "low", "medium", "high"). */
  supported_reasoning_efforts: string[];
  /** Default reasoning effort, if any. */
  default_reasoning_effort?: string;
  /** Context window in tokens, if known. */
  context_window?: number;
  /** Whether this model is free. */
  is_free: boolean;
}

export function listAgents(): Promise<AgentConfig[]> {
  return invoke<AgentConfig[]>('list_agents');
}

/** List agents that support Agent Chat (declared chat_transport). */
export function listChatAgents(): Promise<AgentConfig[]> {
  return invoke<AgentConfig[]>('list_chat_agents');
}

/** List models an agent supports in Agent Chat. */
export function listAgentModels(agentId: string): Promise<ModelInfo[]> {
  return invoke<ModelInfo[]>('list_agent_models', { agentId });
}

/** Discover OpenCode models dynamically. */
export function discoverOpencodeModels(binaryPath?: string): Promise<ModelInfo[]> {
  return invoke<ModelInfo[]>('discover_opencode_models', { binaryPath });
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
