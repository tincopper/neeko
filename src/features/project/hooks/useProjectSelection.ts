import { useCallback } from 'react';

import { restoreActiveTabId } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { selectActiveCheckoutPath, useWorkspaceStore } from '@/shared/store/workspaceStore';
import { WorkspaceSession, type ProjectId } from '@/shared/utils/workspaceRef';

import { setActiveProject } from '../api/projectApi';

/**
 * useProjectSelection — extract project selection logic from useAppContainer.
 *
 * Simplified to use only the unified Project store.
 * WSL/Remote project selection is handled through their own hooks.
 */
export function useProjectSelection() {
  const selectProject = useCallback(async (projectId: ProjectId) => {
    // Read all current state first (before any mutations)
    // 选中项目 = 回到主仓单元（下方 clearActiveWorkspace）；重派生主仓单元的激活 tab
    const wtStore = useWorkspaceStore.getState();
    const targetProject =
      useProjectStore.getState().projects.find((p) => p.id === projectId) ?? null;

    const projectDelta = {
      activeProjectId: projectId,
      activeProject: targetProject,
    };

    // 选中项目 = 回到该项目的主仓单元（后端挂载由 useActiveWorkspaceSync 跟随激活态变化）
    if (selectActiveCheckoutPath(wtStore, projectId) !== null) {
      wtStore.clearActiveWorkspace(projectId);
    }
    useProjectStore.setState(projectDelta);
    restoreActiveTabId(WorkspaceSession.of(projectId, null).key);

    setActiveProject(projectId).catch(console.error);
  }, []);

  return { selectProject };
}
