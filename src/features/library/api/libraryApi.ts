import { invoke } from '@tauri-apps/api/core';

import type { PromptResource, PromptInput, PromptVariable } from '@/shared/types/library';

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
