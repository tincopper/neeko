import { invoke } from '@tauri-apps/api/core';

import type {
  ActionResource,
  PromptResource,
  PromptInput,
  PromptVariable,
} from '@/shared/types/library';
import type {
  McpServer,
  McpServerInput,
  McpTestResult,
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

// ─── DTOs (mirror src-tauri/src/skill/commands.rs ActionDtoOut) ──────────────

interface ActionDto {
  id: string;
  name: string;
  description: string | null;
  group: string;
  payload_json: string;
  shortcut: string | null;
  tags: string[];
  enabled: boolean;
  usage_count: number;
  last_used_at: number | null;
  created_at: number;
  updated_at: number;
}

function dtoToAction(dto: ActionDto): ActionResource {
  return {
    id: dto.id,
    name: dto.name,
    description: dto.description,
    group: dto.group as ActionResource['group'],
    payload: JSON.parse(dto.payload_json) as ActionResource['payload'],
    shortcut: dto.shortcut,
    tags: dto.tags,
    enabled: dto.enabled,
    usageCount: dto.usage_count,
    lastUsedAt: dto.last_used_at,
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
  };
}

function actionToDto(input: {
  name: string;
  description?: string | null;
  group?: string;
  payload: ActionResource['payload'];
  shortcut?: string | null;
  tags?: string[];
}): {
  name: string;
  description: string | null;
  group: string;
  payload_json: string;
  shortcut: string | null;
  tags: string[];
} {
  return {
    name: input.name,
    description: input.description ?? null,
    group: input.group ?? 'custom',
    payload_json: JSON.stringify(input.payload),
    shortcut: input.shortcut ?? null,
    tags: input.tags ?? [],
  };
}

// ─── Action CRUD ──────────────────────────────────────────────────────────────

export async function listActions(): Promise<ActionResource[]> {
  const dtos = await invoke<ActionDto[]>('list_actions');
  return dtos.map(dtoToAction);
}

export async function getAction(id: string): Promise<ActionResource> {
  const dto = await invoke<ActionDto>('get_action', { id });
  return dtoToAction(dto);
}

export async function saveAction(input: {
  name: string;
  description?: string | null;
  group?: string;
  payload: ActionResource['payload'];
  shortcut?: string | null;
  tags?: string[];
}): Promise<ActionResource> {
  const dto = await invoke<ActionDto>('save_action', {
    input: actionToDto(input),
  });
  return dtoToAction(dto);
}

export async function updateAction(
  id: string,
  input: {
    name: string;
    description?: string | null;
    group?: string;
    payload: ActionResource['payload'];
    shortcut?: string | null;
    tags?: string[];
    enabled?: boolean;
  },
): Promise<ActionResource> {
  const dto = await invoke<ActionDto>('update_action_cmd', {
    id,
    input: {
      ...actionToDto(input),
      enabled: input.enabled,
    },
  });
  return dtoToAction(dto);
}

export async function deleteAction(id: string): Promise<void> {
  await invoke<void>('delete_action_cmd', { id });
}

export async function runAction(id: string): Promise<{
  dispatched: boolean;
  promptContent: string | null;
  command: string | null;
  panelId: string | null;
}> {
  const result = await invoke<{
    dispatched: boolean;
    prompt_content: string | null;
    command: string | null;
    panel_id: string | null;
  }>('run_action_cmd', { id });
  return {
    dispatched: result.dispatched,
    promptContent: result.prompt_content,
    command: result.command,
    panelId: result.panel_id,
  };
}

// ─── Library Bundle (import/export) ───────────────────────────────────────────

export interface ImportResult {
  promptsImported: number;
  promptsSkipped: number;
  actionsImported: number;
  actionsSkipped: number;
}

export async function exportLibraryBundle(path: string): Promise<void> {
  await invoke<void>('export_library_bundle', { path });
}

export async function importLibraryBundle(
  path: string,
  mode: 'skip' | 'overwrite',
): Promise<ImportResult> {
  const result = await invoke<{
    prompts_imported: number;
    prompts_skipped: number;
    actions_imported: number;
    actions_skipped: number;
  }>('import_library_bundle', { input: { path, mode } });
  return {
    promptsImported: result.prompts_imported,
    promptsSkipped: result.prompts_skipped,
    actionsImported: result.actions_imported,
    actionsSkipped: result.actions_skipped,
  };
}

// ─── DTOs (mirror src-tauri/src/skill/commands.rs McpServerDtoOut) ───────────

interface McpServerDto {
  id: string;
  name: string;
  description: string | null;
  command: string;
  args: unknown[];
  env: Record<string, string>;
  transport: string;
  scope: string;
  project_id: string | null;
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
    args: dto.args,
    env: dto.env,
    transport: dto.transport as 'stdio' | 'sse',
    scope: dto.scope as 'global' | 'project',
    projectId: dto.project_id,
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
  args: string[] | null;
  env: Record<string, string> | null;
  transport: string | null;
  scope: string | null;
  project_id: string | null;
  tags: string[] | null;
} {
  return {
    name: input.name,
    description: input.description ?? null,
    command: input.command,
    args: (input.args as string[]) ?? null,
    env: input.env ?? null,
    transport: input.transport ?? null,
    scope: input.scope ?? null,
    project_id: input.projectId ?? null,
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
