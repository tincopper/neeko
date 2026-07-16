import { useCallback } from "react";
import { setActiveProject } from "../api/projectApi";
import { useProjectStore } from '@/features/project/store';
import { useWorktreeStore } from '@/features/project/worktreeStore';
import { useEditorStore } from '@/shared/store';

/**
 * useProjectSelection — extract project selection logic from useAppContainer.
 *
 * Simplified to use only the unified Project store.
 * WSL/Remote project selection is handled through their own hooks.
 */
export function useProjectSelection() {
  const selectProject = useCallback(
    async (projectId: string) => {
      // Read all current state first (before any mutations)
      const editorTabs = useEditorStore.getState().tabs[projectId];
      const wtStateMap = useWorktreeStore.getState().worktreeStateMap;
      const wtCur = wtStateMap[projectId];
      const nextWtMap =
        wtCur && wtCur.activePath !== null
          ? { ...wtStateMap, [projectId]: { ...wtCur, activePath: null, activeBranch: "" } }
          : wtStateMap;
      const targetProject =
        useProjectStore.getState().projects.find((p) => p.id === projectId) ?? null;

      // Compute all deltas upfront
      const worktreeDelta = {
        worktreeStateMap: nextWtMap,
        activeWorktreePath: null,
        activeWorktreeBranch: "",
      };

      const projectDelta = {
        activeProjectId: projectId,
        activeProject: targetProject,
      };

      const editorDelta = {
        activeTabId: editorTabs?.activeTabId ?? null,
      };

      // Apply all mutations
      useWorktreeStore.setState(worktreeDelta);
      useProjectStore.setState(projectDelta);
      useEditorStore.setState(editorDelta);

      setActiveProject(projectId).catch(console.error);
    },
    [],
  );

  return { selectProject };
}
