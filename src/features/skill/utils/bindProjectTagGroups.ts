import type { ManagedSkillDto } from '@/shared/types';

export interface BindProjectTagGroupsInput {
  projectId: string;
  projectPath: string;
  /** Full desired set of bound tag group ids (atomic replace). */
  tagGroupIds: string[];
  /** Previously bound group ids (for computing additions). */
  previousBoundIds: string[];
  /** Project target agents that can receive project-local skills. */
  targetAgentIds: string[];
}

export interface BindProjectTagGroupsDeps {
  setProjectTagGroups: (
    projectId: string,
    tagGroupIds: string[],
    projectPath?: string,
  ) => Promise<void>;
  getSkillsForTagGroup: (tagGroupId: string) => Promise<ManagedSkillDto[]>;
  importSkillsToProject: (
    projectPath: string,
    skillIds: string[],
    agentIds: string[],
  ) => Promise<number>;
}

export interface BindProjectTagGroupsResult {
  imported: number;
  addedGroupIds: string[];
  syncSkippedReason: string | null;
  summary: string;
}

/**
 * Persist project↔tag-group bindings and install skills from newly added groups.
 * Mirrors ProjectSkillContent.handleSaveBindings without UI concerns.
 */
export async function bindProjectTagGroups(
  input: BindProjectTagGroupsInput,
  deps: BindProjectTagGroupsDeps,
): Promise<BindProjectTagGroupsResult> {
  const { projectId, projectPath, tagGroupIds, previousBoundIds, targetAgentIds } = input;
  const prevIds = new Set(previousBoundIds);
  const addedGroupIds = tagGroupIds.filter((id) => !prevIds.has(id));

  // Persist the binding declaration first. If the subsequent skill sync fails,
  // we roll back to the previous bound ids so a retry will re-attempt the sync
  // instead of silently skipping it.
  await deps.setProjectTagGroups(projectId, tagGroupIds, projectPath);

  let imported = 0;
  let syncSkippedReason: string | null = null;

  if (addedGroupIds.length > 0) {
    const skillIds = new Set<string>();
    const groupResults = await Promise.all(
      addedGroupIds.map((id) => deps.getSkillsForTagGroup(id)),
    );
    for (const list of groupResults) {
      for (const s of list) skillIds.add(s.id);
    }

    if (skillIds.size === 0) {
      syncSkippedReason = null;
    } else if (targetAgentIds.length === 0) {
      syncSkippedReason =
        'No target agent on this project (set project agent) — bindings saved without disk sync';
    } else {
      try {
        imported = await deps.importSkillsToProject(
          projectPath,
          Array.from(skillIds),
          targetAgentIds,
        );
      } catch (syncError) {
        // Rollback the binding declaration so the next attempt still sees
        // these groups as newly added and tries to sync again.
        // 静默豁免：回滚本身尽力而为；主错误 syncError 已 re-throw 给调用方处理
        await deps.setProjectTagGroups(projectId, previousBoundIds, projectPath).catch(() => {});
        throw syncError;
      }
    }
  }

  const groupLabel = `${tagGroupIds.length} group${tagGroupIds.length === 1 ? '' : 's'}`;
  const parts: string[] = [`Bound ${groupLabel}`];
  if (imported > 0) {
    parts.push(`synced ${imported} deployment${imported === 1 ? '' : 's'} to target agent`);
  }

  return {
    imported,
    addedGroupIds,
    syncSkippedReason,
    summary: parts.join('; '),
  };
}
