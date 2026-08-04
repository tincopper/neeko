import { invoke } from '@tauri-apps/api/core';

import type { PromptResource, PromptInput, PromptVariable } from '@/shared/types/library';
import type {
  McpServer,
  McpServerInput,
  McpTestResult,
  McpTagGroup,
  McpTagGroupInput,
  McpServerTarget,
  SlashResource,
  AgentCapabilities,
} from '@/shared/types/mcpServer';

// ─── DTOs (mirror src-tauri/src/skill/commands.rs PromptDtoOut) ─────────────

interface PromptDto {
  id: string;
  name: string;
  description: string | null;
  content: string;
  slash: string | null;
  tags: string[];
  scope: string;
  project_id: string | null;
  kind: string;
  favorite: boolean;
  usage_count: number;
  last_used_at: number | null;
  created_at: number;
  updated_at: number;
  variables: PromptVariable[];
}

function dtoToPrompt(dto: PromptDto): PromptResource {
  return {
    id: dto.id,
    name: dto.name,
    description: dto.description,
    content: dto.content,
    slash: dto.slash,
    tags: dto.tags,
    scope: dto.scope as 'global' | 'project',
    projectId: dto.project_id,
    kind: dto.kind,
    favorite: dto.favorite,
    usageCount: dto.usage_count,
    lastUsedAt: dto.last_used_at,
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
    variables: dto.variables,
  };
}

function promptToDto(input: PromptInput): {
  name: string;
  description: string | null;
  content: string;
  slash: string | null;
  tags: string[];
  scope: string;
  project_id: string | null;
  kind: string;
  variables: PromptVariable[];
} {
  return {
    name: input.name,
    description: input.description ?? null,
    content: input.content,
    slash: input.slash ?? null,
    tags: input.tags,
    scope: input.scope,
    project_id: input.projectId ?? null,
    kind: input.kind ?? 'prompt',
    variables: input.variables ?? [],
  };
}

// ─── Prompt CRUD ─────────────────────────────────────────────────────────────

export async function listPrompts(): Promise<PromptResource[]> {
  const dtos = await invoke<PromptDto[]>('list_prompts');
  return dtos.map(dtoToPrompt);
}

export async function getPrompt(id: string): Promise<PromptResource> {
  const dto = await invoke<PromptDto>('get_prompt', { id });
  return dtoToPrompt(dto);
}

export async function savePrompt(input: PromptInput): Promise<PromptResource> {
  const dto = await invoke<PromptDto>('save_prompt', {
    input: promptToDto(input),
  });
  return dtoToPrompt(dto);
}

export async function updatePrompt(
  id: string,
  input: PromptInput & { favorite?: boolean },
): Promise<PromptResource> {
  const dto = await invoke<PromptDto>('update_prompt_cmd', {
    id,
    input: {
      ...promptToDto(input),
      favorite: input.favorite,
    },
  });
  return dtoToPrompt(dto);
}

export async function deletePrompt(id: string): Promise<void> {
  await invoke<void>('delete_prompt_cmd', { id });
}

/** Record usage (increments counter + last_used_at). */
export async function recordPromptUsage(id: string): Promise<void> {
  await invoke<void>('use_prompt_cmd', { id });
}

/** Resolve a slash command to a prompt (project scope overrides global). */
export async function resolveSlashPrompt(
  slash: string,
  projectId?: string | null,
): Promise<PromptResource | null> {
  const dto = await invoke<PromptDto | null>('resolve_slash_prompt', {
    slash,
    projectId: projectId ?? null,
  });
  return dto ? dtoToPrompt(dto) : null;
}

export async function getAllPromptTags(): Promise<string[]> {
  return invoke<string[]>('get_all_prompt_tags_cmd');
}

// ─── DTOs (mirror src-tauri/src/skill/commands.rs McpServerDtoOut) ───────────

interface McpServerDto {
  id: string;
  name: string;
  description: string | null;
  command: string;
  url: string | null;
  args: unknown[];
  env: Record<string, string>;
  transport: string;
  scope: string;
  project_id: string | null;
  source_registry: string | null;
  source_ref: string | null;
  tags: string[];
  enabled: boolean;
  usage_count: number;
  last_used_at: number | null;
  created_at: number;
  updated_at: number;
}

function dtoToMcpServer(dto: McpServerDto): McpServer {
  return {
    id: dto.id,
    name: dto.name,
    description: dto.description,
    command: dto.command,
    url: dto.url,
    args: dto.args,
    env: dto.env,
    transport: dto.transport as 'stdio' | 'sse' | 'http',
    scope: dto.scope as 'global' | 'project',
    projectId: dto.project_id,
    sourceRegistry: dto.source_registry,
    sourceRef: dto.source_ref,
    tags: dto.tags,
    enabled: dto.enabled,
    usageCount: dto.usage_count,
    lastUsedAt: dto.last_used_at,
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
  };
}

function mcpServerToDto(input: McpServerInput): {
  name: string;
  description: string | null;
  command: string;
  url: string | null;
  args: string[] | null;
  env: Record<string, string> | null;
  transport: string | null;
  scope: string | null;
  project_id: string | null;
  source_registry: string | null;
  source_ref: string | null;
  tags: string[] | null;
} {
  return {
    name: input.name,
    description: input.description ?? null,
    command: input.command,
    url: input.url ?? null,
    args: (input.args as string[]) ?? null,
    env: input.env ?? null,
    transport: input.transport ?? null,
    scope: input.scope ?? null,
    project_id: input.projectId ?? null,
    source_registry: input.sourceRegistry ?? null,
    source_ref: input.sourceRef ?? null,
    tags: input.tags ?? null,
  };
}

// ─── MCP Server CRUD ──────────────────────────────────────────────────────────

export async function listMcpServers(): Promise<McpServer[]> {
  const dtos = await invoke<McpServerDto[]>('list_mcp_servers');
  return dtos.map(dtoToMcpServer);
}

export async function getMcpServer(id: string): Promise<McpServer> {
  const dto = await invoke<McpServerDto>('get_mcp_server', { id });
  return dtoToMcpServer(dto);
}

export async function saveMcpServer(input: McpServerInput): Promise<McpServer> {
  const dto = await invoke<McpServerDto>('save_mcp_server', {
    input: mcpServerToDto(input),
  });
  return dtoToMcpServer(dto);
}

export async function updateMcpServer(id: string, input: McpServerInput): Promise<McpServer> {
  const dto = await invoke<McpServerDto>('update_mcp_server_cmd', {
    id,
    input: mcpServerToDto(input),
  });
  return dtoToMcpServer(dto);
}

export async function deleteMcpServer(id: string): Promise<void> {
  await invoke<void>('delete_mcp_server_cmd', { id });
}

// ─── MCP/Command Deployment ───────────────────────────────────────────────────

export async function deployMcpToAgent(
  mcpId: string,
  agentId: string,
  projectPath?: string | null,
): Promise<void> {
  await invoke<void>('deploy_mcp_to_agent', {
    input: { mcpId, agentId, projectPath: projectPath ?? null },
  });
}

export async function deployCommandToAgent(
  commandId: string,
  agentId: string,
  projectPath?: string | null,
): Promise<void> {
  await invoke<void>('deploy_command_to_agent', {
    input: { commandId, agentId, projectPath: projectPath ?? null },
  });
}

export async function listDeployedMcp(
  agentId: string,
  projectPath?: string | null,
): Promise<unknown[]> {
  return invoke<unknown[]>('list_deployed_mcp', {
    agentId,
    projectPath: projectPath ?? null,
  });
}

export async function listDeployedCommands(
  agentId: string,
  projectPath?: string | null,
): Promise<string[]> {
  return invoke<string[]>('list_deployed_commands', {
    agentId,
    projectPath: projectPath ?? null,
  });
}

export async function removeDeployedMcp(
  serverName: string,
  agentId: string,
  projectPath?: string | null,
): Promise<void> {
  await invoke<void>('remove_deployed_mcp', {
    input: { serverName, agentId, projectPath: projectPath ?? null },
  });
}

export async function removeDeployedCommand(
  commandName: string,
  agentId: string,
  projectPath?: string | null,
): Promise<void> {
  await invoke<void>('remove_deployed_command', {
    input: { commandName, agentId, projectPath: projectPath ?? null },
  });
}

// ─── Agent Capabilities & Slash Resolution ────────────────────────────────────

export async function getAgentCapabilities(agentId: string): Promise<AgentCapabilities | null> {
  const dto = await invoke<{
    agent_id: string;
    agent_name: string;
    supports_mcp: boolean;
    supports_commands: boolean;
    mcp_transports: string[];
    commands_format: string | null;
    mcp_path: string;
    commands_path: string;
  } | null>('get_agent_capabilities', { agentId });
  if (!dto) return null;
  return {
    agentId: dto.agent_id,
    agentName: dto.agent_name,
    supportsMcp: dto.supports_mcp,
    supportsCommands: dto.supports_commands,
    mcpTransports: dto.mcp_transports,
    commandsFormat: dto.commands_format,
    mcpPath: dto.mcp_path,
    commandsPath: dto.commands_path,
  };
}

export function listAgentsSupporting(capability: string): Promise<string[]> {
  return invoke<string[]>('list_agents_supporting', { capability });
}

export async function testMcpServer(id: string): Promise<McpTestResult> {
  const result = await invoke<{
    command_found: boolean;
    command: string;
    message: string;
  }>('test_mcp_server_cmd', { id });
  return {
    commandFound: result.command_found,
    command: result.command,
    message: result.message,
  };
}

// ─── MCP Tag Groups ───────────────────────────────────────────────────────────

export async function getMcpTagGroups(): Promise<McpTagGroup[]> {
  const dtos = await invoke<McpTagGroupDto[]>('get_mcp_tag_groups');
  return dtos.map(dtoToMcpTagGroup);
}

export async function createMcpTagGroup(input: McpTagGroupInput): Promise<McpTagGroup> {
  const dto = await invoke<McpTagGroupDto>('create_mcp_tag_group', {
    name: input.name,
    description: input.description ?? null,
    icon: input.icon ?? null,
  });
  return dtoToMcpTagGroup(dto);
}

export async function deleteMcpTagGroup(id: string): Promise<void> {
  await invoke('delete_mcp_tag_group_cmd', { id });
}

export async function updateMcpTagGroup(
  id: string,
  input: Partial<McpTagGroupInput>,
): Promise<McpTagGroup> {
  const dto = await invoke<McpTagGroupDto>('update_mcp_tag_group_cmd', {
    id,
    name: input.name ?? null,
    description: input.description ?? null,
    icon: input.icon ?? null,
  });
  return dtoToMcpTagGroup(dto);
}

export async function reorderMcpTagGroups(ids: string[]): Promise<void> {
  await invoke('reorder_mcp_tag_groups_cmd', { ids });
}

export async function addServerToMcpTagGroup(tagGroupId: string, serverId: string): Promise<void> {
  await invoke('add_server_to_mcp_tag_group_cmd', { tagGroupId, serverId });
}

export async function removeServerFromMcpTagGroup(
  tagGroupId: string,
  serverId: string,
): Promise<void> {
  await invoke('remove_server_from_mcp_tag_group_cmd', { tagGroupId, serverId });
}

export async function getServersForMcpTagGroup(tagGroupId: string): Promise<McpServer[]> {
  const dtos = await invoke<McpServerDto[]>('get_servers_for_mcp_tag_group_cmd', { tagGroupId });
  return dtos.map(dtoToMcpServer);
}

export async function setMcpServerAgentToggle(
  tagGroupId: string,
  serverId: string,
  agentId: string,
  enabled: boolean,
): Promise<void> {
  await invoke('set_mcp_server_agent_toggle_cmd', { tagGroupId, serverId, agentId, enabled });
}

// ─── MCP Project Bindings ─────────────────────────────────────────────────────

export async function getProjectMcpTagGroups(projectId: string): Promise<McpTagGroup[]> {
  const dtos = await invoke<McpTagGroupDto[]>('get_project_mcp_tag_groups_cmd', { projectId });
  return dtos.map(dtoToMcpTagGroup);
}

export async function setProjectMcpTagGroups(
  projectId: string,
  tagGroupIds: string[],
): Promise<void> {
  await invoke('set_project_mcp_tag_groups_cmd', { projectId, tagGroupIds });
}

export async function addProjectMcpTagGroup(projectId: string, tagGroupId: string): Promise<void> {
  await invoke('add_project_mcp_tag_group_cmd', { projectId, tagGroupId });
}

export async function removeProjectMcpTagGroup(
  projectId: string,
  tagGroupId: string,
): Promise<void> {
  await invoke('remove_project_mcp_tag_group_cmd', { projectId, tagGroupId });
}

export async function getAllProjectMcpTagGroupCounts(): Promise<Array<[string, number]>> {
  return invoke('get_all_project_mcp_tag_group_counts_cmd');
}

export async function applyProjectMcpServers(
  projectId: string,
  projectPath: string,
): Promise<void> {
  await invoke('apply_project_mcp_servers_cmd', { projectId, projectPath });
}

// ─── MCP Deployment Targets ───────────────────────────────────────────────────

export async function getMcpServerTargets(serverId: string): Promise<McpServerTarget[]> {
  const dtos = await invoke<McpServerTargetDto[]>('get_mcp_server_targets_cmd', { serverId });
  return dtos.map(dtoToMcpServerTarget);
}

// ─── DTO helpers ──────────────────────────────────────────────────────────────

interface McpTagGroupDto {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  sort_order: number;
  server_count: number;
}

function dtoToMcpTagGroup(dto: McpTagGroupDto): McpTagGroup {
  return {
    id: dto.id,
    name: dto.name,
    description: dto.description,
    icon: dto.icon,
    sortOrder: dto.sort_order,
    serverCount: dto.server_count,
  };
}

interface McpServerTargetDto {
  id: string;
  server_id: string;
  agent_id: string;
  target_path: string;
  status: string;
  deployed_at: number | null;
  last_error: string | null;
}

function dtoToMcpServerTarget(dto: McpServerTargetDto): McpServerTarget {
  return {
    id: dto.id,
    serverId: dto.server_id,
    agentId: dto.agent_id,
    targetPath: dto.target_path,
    status: dto.status,
    deployedAt: dto.deployed_at,
    lastError: dto.last_error,
  };
}

// ─── MCP Registry (marketplace) ──────────────────────────────────────────────

/** One row in the MCP Registry listing (what a marketplace card shows). */
export interface McpRegistrySummary {
  name: string;
  title: string;
  description: string | null;
  version: string | null;
  transports: string[];
  repository: string | null;
  /** GitHub stars (null when unavailable / rate-limited / not a GitHub repo). */
  stars: number | null;
  /** Package downloads (last month; null when unavailable / unsupported registry). */
  downloads: number | null;
  /** Server-declared configuration inputs (Argument schema) — drives dynamic form rendering. */
  inputs: McpRegistryInput[];
  /** Registry lifecycle status: "active" | "deprecated" | "deleted". */
  status: string | null;
  /** Registry last-updated timestamp (RFC3339). */
  updatedAt: string | null;
}

/** A declared configuration input (matches the registry Argument schema). */
export interface McpRegistryInput {
  name: string;
  /** "positional" | "named" (argument type). */
  inputType: string | null;
  /** "string" | "number" | "boolean" | "filepath". */
  format: string | null;
  isRequired: boolean;
  isSecret: boolean;
  isRepeated: boolean;
  default: unknown;
  placeholder: string | null;
  choices: string[];
  /** Positional-arg hint (used in remote URL variable substitution). */
  valueHint: string | null;
}

/** Search response: current page + next pagination cursor. */
export interface McpRegistrySearchResult {
  servers: McpRegistrySummary[];
  nextCursor: string | null;
}

/** An env var entry from server.json (secret values never filled). */
export interface McpRegistryEnvVar {
  name: string;
  isSecret: boolean;
  isRequired: boolean;
  default: string | null;
}

/** Generated launch-config template prefilling the MCP editor. */
export interface McpRegistryGeneratedConfig {
  name: string;
  description: string | null;
  command: string;
  args: string[];
  env: McpRegistryEnvVar[];
  transport: 'stdio' | 'sse' | 'http';
  url: string | null;
  /** Server-declared configuration inputs — drive dynamic form rendering. */
  inputs: McpRegistryInput[];
}

/** Full detail for a single registry server. */
export interface McpRegistryServerDetail {
  summary: McpRegistrySummary;
  generated: McpRegistryGeneratedConfig | null;
  raw: unknown;
}

export function searchMcpRegistry(
  query: string,
  limit: number,
  cursor?: string | null,
): Promise<McpRegistrySearchResult> {
  return invoke<McpRegistrySearchResult>('search_mcp_registry_cmd', {
    query,
    limit,
    cursor: cursor ?? null,
  });
}

export function fetchMcpRegistryServer(name: string): Promise<McpRegistryServerDetail> {
  return invoke<McpRegistryServerDetail>('fetch_mcp_registry_server_cmd', { name });
}

export async function resolveSlashResource(
  slash: string,
  projectId?: string | null,
): Promise<SlashResource | null> {
  const dto = await invoke<{
    kind: string;
    id: string;
    name: string;
    content: string;
    slash: string | null;
  } | null>('resolve_slash_resource', { slash, projectId: projectId ?? null });
  if (!dto) return null;
  return {
    kind: dto.kind as 'prompt' | 'command',
    id: dto.id,
    name: dto.name,
    content: dto.content,
    slash: dto.slash,
  };
}
