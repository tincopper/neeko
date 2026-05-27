import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useProjectStore } from "../store/projectStore";
import { useConnectionStore } from "../store/connectionStore";
import { useWorktreeStore, type WorktreeSnapshotItem } from "../store/worktreeStore";
import { useEditorStore } from "../store/editorStore";

/**
 * useProjectSelection — extract project selection logic from useAppContainer.
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

      invoke("set_active_project", { projectId }).catch(console.error);
    },
    [],
  );

  return { selectProject };
}
