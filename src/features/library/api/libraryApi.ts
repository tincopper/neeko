import { invoke } from '@tauri-apps/api/core';

import type {
  ActionResource,
  PromptResource,
  PromptInput,
  PromptVariable,
} from '@/shared/types/library';

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
