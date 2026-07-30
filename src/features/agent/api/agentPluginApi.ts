/**
 * AgentPlugin IPC API wrapper.
 *
 * Provides typed access to the Agent Plugin System backend commands.
 */

import { invoke } from '@tauri-apps/api/core';

import type { AgentPlugin } from '@/shared/types/agentPlugin';

/** List all built-in AgentPlugin definitions. */
export function listAgentPlugins(): Promise<AgentPlugin[]> {
  return invoke<AgentPlugin[]>('list_agent_plugins');
}

/** Get a single built-in AgentPlugin by ID. */
export function getAgentPlugin(pluginId: string): Promise<AgentPlugin> {
  return invoke<AgentPlugin>('get_agent_plugin', { pluginId });
}

/** Resolve a plugin's path template to an absolute path. */
export function resolvePluginPath(
  pluginId: string,
  resourceType: string,
  projectPath?: string | null,
): Promise<string> {
  return invoke<string>('resolve_plugin_path', {
    pluginId,
    resourceType,
    projectPath: projectPath ?? null,
  });
}

/** Result of detecting installed agents. */
export interface AgentDetectionResult {
  plugin_id: string;
  installed: boolean;
  resolved_target?: string | null;
}

/** Detect which built-in AgentPlugins are installed. */
export function detectInstalledAgents(
  projectPath?: string | null,
): Promise<AgentDetectionResult[]> {
  return invoke<AgentDetectionResult[]>('detect_installed_agents', {
    projectPath: projectPath ?? null,
  });
}

/** Deploy a skill to an agent via the plugin system. */
export function deploySkillToAgent(
  skillId: string,
  agentId: string,
  projectPath?: string | null,
): Promise<void> {
  return invoke<void>('deploy_skill_to_agent', {
    input: { skillId, agentId, projectPath: projectPath ?? null },
  });
}

/** Get all resource paths for a plugin (resolved). */
export function getPluginResourcePaths(
  pluginId: string,
  projectPath?: string | null,
): Promise<Record<string, string>> {
  return invoke<Record<string, string>>('get_plugin_resource_paths', {
    pluginId,
    projectPath: projectPath ?? null,
  });
}

/** List all custom (user-defined) agent plugins. */
export function listCustomPlugins(): Promise<AgentPlugin[]> {
  return invoke<AgentPlugin[]>('list_custom_plugins');
}

/** Input for saving a custom agent plugin. */
export interface SaveCustomPluginInput {
  id: string;
  name: string;
  icon?: string | null;
  description?: string | null;
  version?: string | null;
  execution_json: string;
  configuration_json: string;
  capabilities_json: string;
  paths_json: string;
  lifecycle_json?: string | null;
}

/** Save a custom agent plugin. */
export function saveCustomPlugin(input: SaveCustomPluginInput): Promise<void> {
  return invoke<void>('save_custom_plugin', { input });
}

/** Delete a custom agent plugin by ID. */
export function deleteCustomPlugin(pluginId: string): Promise<void> {
  return invoke<void>('delete_custom_plugin', { pluginId });
}
