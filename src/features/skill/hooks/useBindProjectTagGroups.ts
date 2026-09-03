import { useCallback, useState } from 'react';

import { openLibraryAt } from '@/features/library/store/libraryNavigation';
import { useNotificationStore } from '@/shared/store/notificationStore';
import type { AgentConfig } from '@/shared/types';

import { getSkillsForTagGroup, importSkillsToProject } from '../api/skillApi';
import { useSkillStore } from '../store';
import { bindProjectTagGroups } from '../utils/bindProjectTagGroups';

export function resolveProjectTargetAgentIds(
  agents: AgentConfig[],
  selectedAgentIds: string[],
): string[] {
  const selected = new Set(selectedAgentIds);
  return agents.filter((a) => selected.has(a.id) && Boolean(a.skill_path?.trim())).map((a) => a.id);
}

export interface UseBindProjectTagGroupsOptions {
  projectId: string;
  projectPath: string;
  /** Current bound group ids (declaration). */
  previousBoundIds: string[];
  /** Project selected_agents ∩ project-capable. */
  targetAgentIds: string[];
  /** After successful bind, open Skills → Project. Default true. */
  openSkillsOnSuccess?: boolean;
  onSuccess?: () => void;
}

/**
 * Bind project ↔ tag groups using the shared pure helper + skill store.
 * Optional navigation to Skills Project view after success.
 */
export function useBindProjectTagGroups({
  projectId,
  projectPath,
  previousBoundIds,
  targetAgentIds,
  openSkillsOnSuccess = true,
  onSuccess,
}: UseBindProjectTagGroupsOptions) {
  const [saving, setSaving] = useState(false);
  const setProjectTagGroups = useSkillStore((s) => s.setProjectTagGroups);

  const notify = useCallback((message: string, type: 'info' | 'error' | 'success' = 'info') => {
    useNotificationStore.getState().addNotification({
      type: type === 'error' ? 'error' : type === 'success' ? 'success' : 'info',
      title: type === 'error' ? 'Error' : 'Tag groups',
      message,
    });
  }, []);

  const openSkillsProject = useCallback(() => {
    openLibraryAt({ kind: 'skill', skillView: 'project' });
  }, []);
  const bind = useCallback(
    async (tagGroupIds: string[]) => {
      if (!projectId || !projectPath) {
        notify('No active project path', 'error');
        return null;
      }
      setSaving(true);
      try {
        const result = await bindProjectTagGroups(
          {
            projectId,
            projectPath,
            tagGroupIds,
            previousBoundIds,
            targetAgentIds,
          },
          {
            setProjectTagGroups,
            getSkillsForTagGroup,
            importSkillsToProject,
          },
        );

        if (result.syncSkippedReason) {
          notify(`${result.summary}. ${result.syncSkippedReason}`, 'info');
        } else {
          notify(result.summary, 'success');
        }

        if (openSkillsOnSuccess) {
          openSkillsProject();
        }
        onSuccess?.();
        return result;
      } catch (e) {
        notify(String(e), 'error');
        throw e;
      } finally {
        setSaving(false);
      }
    },
    [
      projectId,
      projectPath,
      previousBoundIds,
      targetAgentIds,
      setProjectTagGroups,
      openSkillsOnSuccess,
      openSkillsProject,
      onSuccess,
      notify,
    ],
  );

  return { bind, saving, openSkillsProject, notify };
}
