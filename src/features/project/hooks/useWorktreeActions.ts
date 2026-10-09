import { useCallback } from 'react';

import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { selectActiveCheckoutPath, useWorkspaceStore } from '@/shared/store/workspaceStore';
import { reportFrontendError } from '@/shared/utils/errorReporting';
import { isActiveWorktree } from '@/shared/utils/git';

import { loadOnboardingState } from '../api/onboardingApi';
import { setActiveProject, setViewTerminal } from '../api/projectApi';

interface UseWorktreeActionsParams {
  /** 激活某Workspace（`null` = 主仓）。只写激活态，后端挂载由 useActiveWorkspaceSync 跟随。 */
  activateWorkspace: (projectId: string, path: string | null, branch?: string) => void;
  /** 记入「打开过的工作树」清单。 */
  markWorkspaceOpened: (projectId: string, path: string, branch: string) => void;
  saveWorktreeState: (projectId: string, wtPath: string | null) => void;
}

export function useWorktreeActions({
  activateWorkspace,
  markWorkspaceOpened,
  saveWorktreeState,
}: UseWorktreeActionsParams) {
  const activeProjectId = useProjectStore((s) => s.activeProjectId);

  const handleBackToMainTerminal = useCallback(
    (projectId: string) => {
      const path = selectActiveCheckoutPath(useWorkspaceStore.getState(), projectId);
      if (isActiveWorktree(path)) {
        activateWorkspace(projectId, null, '');
        saveWorktreeState(projectId, null);
        setViewTerminal(projectId).catch((err) =>
          reportFrontendError('project.setViewTerminal', err),
        );
      }
    },
    [activateWorkspace, saveWorktreeState],
  );

  const handleOpenWorktreeTerminal = useCallback(
    async (projectId: string, worktreePath: string, branch: string) => {
      // 首次访问该工作树时展示引导页，否则直接进入终端
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

      // mutator 显式收目标项目：上面的 setState 不会让渲染期闭包重新绑定，
      // 靠闭包里的 activeProjectId 会把激活态写进切换前的旧项目（跨项目串写）。
      activateWorkspace(projectId, worktreePath, branch);
      markWorkspaceOpened(projectId, worktreePath, branch);
      saveWorktreeState(projectId, worktreePath);

      if (!isFirstVisit) {
        setViewTerminal(projectId).catch((err) =>
          reportFrontendError('project.setViewTerminal', err),
        );
      }
    },
    [activeProjectId, activateWorkspace, markWorkspaceOpened, saveWorktreeState],
  );

  return {
    handleBackToMainTerminal,
    handleOpenWorktreeTerminal,
  };
}
