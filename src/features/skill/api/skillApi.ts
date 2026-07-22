import { invoke } from '@tauri-apps/api/core';

import type {
  ManagedSkillDto,
  TagGroup,
  SkillDocumentDto,
  DiscoveredSkillDto,
  SkillsShSkill,
  AgentSkillGroup,
  ProjectDiskSkill,
} from '@/shared/types';

// ─── Managed Skills ──────────────────────────────────────────────────────────

export function getManagedSkills(): Promise<ManagedSkillDto[]> {
  return invoke<ManagedSkillDto[]>('get_managed_skills');
}

export function getSkillDocument(skillId: string): Promise<SkillDocumentDto> {
  return invoke<SkillDocumentDto>('get_skill_document', { skillId });
}

/** Read SKILL.md from an on-disk skill directory (agent-local, not necessarily managed). */
export function getSkillDocumentAtPath(path: string): Promise<SkillDocumentDto> {
  return invoke<SkillDocumentDto>('get_skill_document_at_path', { path });
}

/** Re-parse SKILL.md for all managed skills; returns number of rows updated. */
export function refreshSkillMetadata(): Promise<number> {
  return invoke<number>('refresh_skill_metadata');
}

/** Wipe managed skills + central repo dirs (tag groups kept). */
export function clearAllManagedSkills(): Promise<number> {
  return invoke<number>('clear_all_managed_skills');
}

export function deleteManagedSkill(skillId: string): Promise<void> {
  return invoke<void>('delete_managed_skill', { skillId });
}

// ─── Tag Groups ──────────────────────────────────────────────────────────────

export function getTagGroups(): Promise<TagGroup[]> {
  return invoke<TagGroup[]>('get_tag_groups');
}

export function createTagGroup(
  name: string,
  description?: string | null,
  icon?: string | null,
): Promise<TagGroup> {
  return invoke<TagGroup>('create_tag_group', { name, description, icon });
}

export function deleteTagGroup(id: string): Promise<void> {
  return invoke<void>('delete_tag_group_cmd', { id });
}

export function updateTagGroup(
  id: string,
  name: string,
  description?: string | null,
  icon?: string | null,
): Promise<void> {
  return invoke<void>('update_tag_group_cmd', { id, name, description, icon });
}

export function reorderTagGroups(ids: string[]): Promise<void> {
  return invoke<void>('reorder_tag_groups_cmd', { ids });
}

// ─── Tag Group ↔ Skill association ──────────────────────────────────────────

export function addSkillToTagGroup(tagGroupId: string, skillId: string): Promise<void> {
  return invoke<void>('add_skill_to_tag_group_cmd', { tagGroupId, skillId });
}

export function removeSkillFromTagGroup(tagGroupId: string, skillId: string): Promise<void> {
  return invoke<void>('remove_skill_from_tag_group_cmd', { tagGroupId, skillId });
}

export function getSkillsForTagGroup(tagGroupId: string): Promise<ManagedSkillDto[]> {
  return invoke<ManagedSkillDto[]>('get_skills_for_tag_group_cmd', { tagGroupId });
}

// ─── Tags ────────────────────────────────────────────────────────────────────

export function getAllTags(): Promise<string[]> {
  return invoke<string[]>('get_all_tags_cmd');
}

export function setSkillTags(skillId: string, tags: string[]): Promise<void> {
  return invoke<void>('set_skill_tags_cmd', { skillId, tags });
}

// ─── Tool Toggle ─────────────────────────────────────────────────────────────

export function setSkillToolToggle(
  tagGroupId: string,
  skillId: string,
  tool: string,
  enabled: boolean,
): Promise<void> {
  return invoke<void>('set_skill_tool_toggle_cmd', { tagGroupId, skillId, tool, enabled });
}

// ─── Sync ────────────────────────────────────────────────────────────────────

export function syncTagGroup(tagGroupId: string): Promise<void> {
  return invoke<void>('sync_tag_group_cmd', { tagGroupId });
}

export function unsyncTagGroup(tagGroupId: string): Promise<void> {
  return invoke<void>('unsync_tag_group_cmd', { tagGroupId });
}

/** Incremental apply: install skills for project's tag groups; never removes others. */
export function applyProjectSkills(projectId: string): Promise<void> {
  return invoke<void>('apply_project_skills_cmd', { projectId });
}

// ─── Project ↔ Tag Group ────────────────────────────────────────────────────

export function getProjectTagGroups(projectId: string): Promise<TagGroup[]> {
  return invoke<TagGroup[]>('get_project_tag_groups_cmd', { projectId });
}

export function setProjectTagGroups(
  projectId: string,
  tagGroupIds: string[],
  projectPath?: string,
): Promise<void> {
  return invoke<void>('set_project_tag_groups_cmd', {
    projectId,
    tagGroupIds,
    projectPath: projectPath ?? null,
  });
}

export function addProjectTagGroup(projectId: string, tagGroupId: string): Promise<void> {
  return invoke<void>('add_project_tag_group_cmd', { projectId, tagGroupId });
}

export function removeProjectTagGroup(projectId: string, tagGroupId: string): Promise<void> {
  return invoke<void>('remove_project_tag_group_cmd', { projectId, tagGroupId });
}

// ─── Create Skill ────────────────────────────────────────────────────────────

export function createSkill(name: string, skillContent: string): Promise<ManagedSkillDto> {
  return invoke<ManagedSkillDto>('create_skill', { name, skillContent });
}

// ─── Local Install ───────────────────────────────────────────────────────────

export function installLocalSkill(
  sourcePath: string,
  name?: string | null,
): Promise<ManagedSkillDto> {
  return invoke<ManagedSkillDto>('install_local_skill', { sourcePath, name });
}

export function scanLocalSkills(): Promise<DiscoveredSkillDto[]> {
  return invoke<DiscoveredSkillDto[]>('scan_local_skills');
}

export function importDiscoveredSkill(
  discoveredPath: string,
  name?: string | null,
): Promise<ManagedSkillDto> {
  return invoke<ManagedSkillDto>('import_discovered_skill', { discoveredPath, name });
}

// ─── Git Install ─────────────────────────────────────────────────────────────

export function previewGitInstall(
  cloneUrl: string,
  branch?: string | null,
  subpath?: string | null,
): Promise<{
  id: string;
  clone_url: string;
  branch: string | null;
  available_skills: Array<{ name: string; path: string; description?: string }>;
}> {
  return invoke<{
    id: string;
    clone_url: string;
    branch: string | null;
    available_skills: Array<{ name: string; path: string; description?: string }>;
  }>('preview_git_install', { cloneUrl, branch, subpath });
}

export function confirmGitInstall(
  previewId: string,
  selectedPath: string,
  name?: string | null,
): Promise<ManagedSkillDto> {
  return invoke<ManagedSkillDto>('confirm_git_install', {
    input: { preview_id: previewId, selected_path: selectedPath, name },
  });
}

export function cancelGitPreview(previewId: string): Promise<void> {
  return invoke<void>('cancel_git_preview', { previewId });
}

// ─── Update ──────────────────────────────────────────────────────────────────

export interface CheckUpdateResult {
  status: string;
  remote_revision: string | null;
}

export function checkSkillUpdate(skillId: string): Promise<CheckUpdateResult> {
  return invoke<CheckUpdateResult>('check_skill_update', { skillId });
}

export function updateSkill(skillId: string): Promise<ManagedSkillDto> {
  return invoke<ManagedSkillDto>('update_skill', { skillId });
}

// ─── Marketplace ─────────────────────────────────────────────────────────────

export function fetchLeaderboard(board: string): Promise<SkillsShSkill[]> {
  return invoke<SkillsShSkill[]>('fetch_leaderboard', { board });
}

export function searchSkillssh(query: string, limit?: number | null): Promise<SkillsShSkill[]> {
  return invoke<SkillsShSkill[]>('search_skillssh', { query, limit });
}

export function installFromSkillssh(source: string, skillId: string): Promise<ManagedSkillDto> {
  return invoke<ManagedSkillDto>('install_from_skillssh', { source, skillId });
}

export function getAgentSkills(): Promise<AgentSkillGroup[]> {
  return invoke<AgentSkillGroup[]>('get_agent_skills_cmd');
}

export interface ProjectSkillCount {
  project_id: string;
  total_count: number;
}

export function getAllProjectSkillCounts(): Promise<ProjectSkillCount[]> {
  return invoke<ProjectSkillCount[]>('get_all_project_skill_counts');
}

/** Bound tag-group count per project (declaration layer; missing project => 0). */
export interface ProjectTagGroupCount {
  project_id: string;
  group_count: number;
}

export function getAllProjectTagGroupCounts(): Promise<ProjectTagGroupCount[]> {
  return invoke<ProjectTagGroupCount[]>('get_all_project_tag_group_counts');
}

export function importSkillToAgent(skillId: string, agentId: string): Promise<void> {
  return invoke<void>('import_skill_to_agent_cmd', { skillId, agentId });
}

export function removeSkillFromAgent(
  agentId: string,
  skillPath: string,
  skillId?: string | null,
): Promise<void> {
  return invoke<void>('remove_skill_from_agent_cmd', {
    agentId,
    skillPath,
    skillId: skillId ?? null,
  });
}

// ─── Project-local agent skill dirs ──────────────────────────────────────────

export function getProjectSkills(projectPath: string): Promise<ProjectDiskSkill[]> {
  return invoke<ProjectDiskSkill[]>('get_project_skills_cmd', { projectPath });
}

/** Deploy library skills into `{project}/{agent-relative-skills-dir}/`. */
export function importSkillsToProject(
  projectPath: string,
  skillIds: string[],
  agentIds: string[],
): Promise<number> {
  return invoke<number>('import_skills_to_project_cmd', {
    projectPath,
    skillIds,
    agentIds,
  });
}

export function removeSkillFromProject(
  projectPath: string,
  skillName: string,
  agentIds?: string[] | null,
  skillId?: string | null,
): Promise<void> {
  return invoke<void>('remove_skill_from_project_cmd', {
    projectPath,
    skillName,
    agentIds: agentIds ?? null,
    skillId: skillId ?? null,
  });
}

/** Toggle one agent for a project skill (symlink on/off). */
export function setProjectSkillAgentEnabled(
  projectPath: string,
  skillName: string,
  agentId: string,
  enabled: boolean,
  skillId?: string | null,
): Promise<void> {
  return invoke<void>('set_project_skill_agent_enabled_cmd', {
    projectPath,
    skillName,
    skillId: skillId ?? null,
    agentId,
    enabled,
  });
}

/** Enable or pause a project skill for all given agents. */
export function setProjectSkillEnabled(
  projectPath: string,
  skillName: string,
  agentIds: string[],
  enabled: boolean,
  skillId?: string | null,
): Promise<void> {
  return invoke<void>('set_project_skill_enabled_cmd', {
    projectPath,
    skillName,
    skillId: skillId ?? null,
    agentIds,
    enabled,
  });
}
