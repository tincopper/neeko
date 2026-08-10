import { useCallback } from 'react';

import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorktreeStore } from '@/shared/store/worktreeStore';
import { isActiveWorktree } from '@/shared/utils/git';

import { loadOnboardingState } from '../api/onboardingApi';
import { setActiveProject, setViewTerminal } from '../api/projectApi';

import type { WorktreeItem } from './useWorktreeState';

interface UseWorktreeActionsParams {
  setActiveWorktreePath: (path: string | null) => void;
  setActiveWorktreeBranch: (branch: string) => void;
  setOpenedWorktrees: React.Dispatch<React.SetStateAction<WorktreeItem[]>>;
  saveWorktreeState: (projectId: string, wtPath: string | null) => void;
}

export function useWorktreeActions({
  setActiveWorktreePath,
  setActiveWorktreeBranch,
  setOpenedWorktrees,
  saveWorktreeState,
}: UseWorktreeActionsParams) {
  const activeWorktreePath = useWorktreeStore((s) => s.activeWorktreePath);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);

  const handleBackToMainTerminal = useCallback(
    (projectId: string) => {
      if (isActiveWorktree(activeWorktreePath)) {
        setActiveWorktreePath(null);
        setActiveWorktreeBranch('');
        saveWorktreeState(projectId, null);
        setViewTerminal(projectId).catch(() => {});
      }
    },
    [activeWorktreePath, setActiveWorktreePath, setActiveWorktreeBranch, saveWorktreeState],
  );

  const handleOpenWorktreeTerminal = useCallback(
    async (projectId: string, worktreePath: string, branch: string) => {
      // Check if this is the first visit to this worktree
      const worktreeKey = `${projectId}::${worktreePath}`;
      const onboardingState = await loadOnboardingState(worktreeKey);
      const isFirstVisit = onboardingState === null;

      if (activeProjectId !== projectId) {
        const targetProjectTabs = useEditorStore.getState().tabs[projectId];
        useProjectStore.setState({
          activeProjectId: projectId,
          activeProject:
            useProjectStore.getState().projects.find((project) => project.id === projectId) ?? null,
        });
        useEditorStore.setState({
          activeTabId: targetProjectTabs?.activeTabId ?? null,
        });
        setActiveProject(projectId).catch(console.error);
      }

      setActiveWorktreePath(worktreePath);
      setActiveWorktreeBranch(branch);
      setOpenedWorktrees((prev) => {
        if (prev.some((item) => item.path === worktreePath)) {
          return prev;
        }
        return [...prev, { path: worktreePath, branch }];
      });
      saveWorktreeState(projectId, worktreePath);

      // Only auto-create terminal tab if this is not the first visit
      // First visit shows the onboarding page instead
      if (!isFirstVisit) {
        setViewTerminal(projectId).catch(() => {});
      }
    },
    [
      activeProjectId,
      setActiveWorktreePath,
      setActiveWorktreeBranch,
      setOpenedWorktrees,
      saveWorktreeState,
    ],
  );
  return {
    handleBackToMainTerminal,
    handleOpenWorktreeTerminal,
  };
}
