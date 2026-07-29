/**
 * Resource Library unified types.
 *
 * The Library shell manages three resource kinds — skills, prompts, actions —
 * through a single surface. Skills reuse the existing skillStore; prompts and
 * actions are owned by the library feature.
 */

import type { ManagedSkillDto } from './skill';

/** Resource kinds managed by the Library. */
export type ResourceKind = 'skill' | 'prompt' | 'action';

/**
 * Insert target for a prompt. `agent` dispatches the custom event the agent
 * input listens to; `terminal` writes directly to the active PTY session.
 */
export type PromptInsertTarget = 'agent' | 'terminal';

/** View mode for the resource list. */
export type ViewMode = 'grid' | 'list';

/** Scope filter for prompts. */
export type ScopeFilter = 'all' | 'global' | 'project';

/**
 * Unified resource summary used by the Library list/grid.
 *
 * Skills are projected from {@link ManagedSkillDto} via an adapter; prompts and
 * actions map 1:1 from their records.
 */
export interface ResourceSummary {
  id: string;
  kind: ResourceKind;
  name: string;
  description?: string | null;
  tags: string[];
  scope: 'global' | 'project';
  projectId?: string | null;
  favorite: boolean;
  usageCount: number;
  lastUsedAt?: number | null;
  createdAt: number;
  updatedAt: number;
  /** Kind-specific preview (prompt body snippet / skill description). */
  preview?: string;
  /** Slash command (prompts only, e.g. "review" → /review). */
  slash?: string | null;
}

/**
 * Prompt resource — the primary new entity introduced by the Library.
 */
export interface PromptResource {
  id: string;
  name: string;
  description?: string | null;
  content: string;
  /** Slash command without the leading slash (e.g. "review" → /review). */
  slash?: string | null;
  tags: string[];
  scope: 'global' | 'project';
  projectId?: string | null;
  variables?: PromptVariable[];
  favorite: boolean;
  usageCount: number;
  lastUsedAt?: number | null;
  createdAt: number;
  updatedAt: number;
}

/** A template variable inside a prompt (e.g. `{{branch}}`). */
export interface PromptVariable {
  name: string;
  description?: string;
  default?: string;
  required?: boolean;
}

/**
 * Payload for creating / updating a prompt.
 */
export type PromptInput = Omit<
  PromptResource,
  'id' | 'createdAt' | 'updatedAt' | 'usageCount' | 'lastUsedAt' | 'favorite'
>;

/**
 * Action resource (P1 — data model only in MVP).
 *
 * Action templates are stored for future Palette integration. MVP registers a
 * few static actions; user-defined action templates land here in P1+.
 */
export interface ActionResource {
  id: string;
  name: string;
  description?: string | null;
  group: 'terminal' | 'agent' | 'file' | 'git' | 'quick' | 'custom';
  keywords: string[];
  payload:
    | { type: 'insert-prompt'; promptId: string }
    | { type: 'run-skill'; skillId: string }
    | { type: 'run-command'; command: string }
    | { type: 'open-panel'; panelId: string };
  shortcut?: string | null;
  tags: string[];
  enabled: boolean;
}

/** Adapter: managed skill DTO → resource summary for the Library list. */
export function skillToResourceSummary(skill: ManagedSkillDto): ResourceSummary {
  return {
    id: skill.id,
    kind: 'skill',
    name: skill.name,
    description: skill.description,
    tags: skill.tags,
    scope: 'global',
    favorite: false,
    usageCount: 0,
    createdAt: skill.created_at,
    updatedAt: skill.updated_at,
    preview: skill.description ?? undefined,
  };
}
