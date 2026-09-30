import { useCallback } from 'react';

import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { selectActiveWorktreePath, useWorktreeStore } from '@/shared/store/worktreeStore';

import { setActiveProject } from '../api/projectApi';

/**
 * useProjectSelection — extract project selection logic from useAppContainer.
 *
 * Simplified to use only the unified Project store.
 * WSL/Remote project selection is handled through their own hooks.
 */
export function useProjectSelection() {
  const selectProject = useCallback(async (projectId: string) => {
    // Read all current state first (before any mutations)
    const editorTabs = useEditorStore.getState().tabs[projectId];
    const wtStore = useWorktreeStore.getState();
    const targetProject =
      useProjectStore.getState().projects.find((p) => p.id === projectId) ?? null;

    const projectDelta = {
      activeProjectId: projectId,
      activeProject: targetProject,
    };

    const editorDelta = {
      activeTabId: editorTabs?.activeTabId ?? null,
    };

    // 选中项目 = 回到该项目的主仓单元（后端挂载由 useActiveRepoUnitSync 跟随激活态变化）
    if (selectActiveWorktreePath(wtStore, projectId) !== null) {
      wtStore.clearActiveWorktree(projectId);
    }
    useProjectStore.setState(projectDelta);
    useEditorStore.setState(editorDelta);

    setActiveProject(projectId).catch(console.error);
  }, []);

  return { selectProject };
}
