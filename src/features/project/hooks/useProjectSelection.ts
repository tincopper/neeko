import { useCallback } from "react";
import { setActiveProject } from "../api/projectApi";
import { useProjectStore } from '@/features/project/store';
import { useConnectionStore } from '@/features/connection/store';
import { useWorktreeStore, type WorktreeSnapshotItem } from '@/features/project/worktreeStore';
import { useEditorStore } from '@/shared/store';

/**
 * useProjectSelection �?extract project selection logic from useAppContainer.
 *
 * Batches cross-store mutations: reads all current state, computes deltas,
 * then applies them. Each zustand store still notifies subscribers separately,
 * but the mutation window is minimised.
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
        activeWslWorktreePath: null,
        wslActiveWtBranch: "",
        wslOpenedWt: [] as WorktreeSnapshotItem[],
        activeRemoteWorktreePath: null,
        remoteActiveWtBranch: "",
        remoteOpenedWt: [] as WorktreeSnapshotItem[],
      };

      const connectionDelta = {
        activeWslKey: null,
        activeWslProject: null,
        activeRemoteKey: null,
        activeRemoteProject: null,
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
      useConnectionStore.setState(connectionDelta);
      useProjectStore.setState(projectDelta);
      useEditorStore.setState(editorDelta);

      setActiveProject(projectId).catch(console.error);
    },
    [],
  );

  return { selectProject };
}
