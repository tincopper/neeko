import { invoke } from '@tauri-apps/api/core';

import type {
  ManagedSkillDto,
  TagGroup,
  SkillDocumentDto,
  DiscoveredSkillDto,
  SkillsShSkill,
} from '../types';

// ─── Managed Skills ──────────────────────────────────────────────────────────

export function getManagedSkills(): Promise<ManagedSkillDto[]> {
  return invoke<ManagedSkillDto[]>('get_managed_skills');
}

export function getSkillDocument(skillId: string): Promise<SkillDocumentDto> {
  return invoke<SkillDocumentDto>('get_skill_document', { skillId });
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

// ─── Project ↔ Tag Group ────────────────────────────────────────────────────

export function getProjectTagGroups(projectId: string): Promise<TagGroup[]> {
  return invoke<TagGroup[]>('get_project_tag_groups_cmd', { projectId });
}

export function setProjectTagGroups(projectId: string, tagGroupIds: string[]): Promise<void> {
  return invoke<void>('set_project_tag_groups_cmd', { projectId, tagGroupIds });
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
