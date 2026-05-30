import { useCallback } from "react";
import { useWorktreeStore } from '@/features/project/worktreeStore';
import { useEditorStore } from '@/app/editor/store';
import { useShallow } from "zustand/shallow";
import { buildWorktreeTabKey } from '@/shared/utils/tabKey';

export interface WorktreeItem {
  path: string;
  branch: string;
}

interface WorktreeState {
  activePath: string | null;
  activeBranch: string;
  opened: WorktreeItem[];
}

const EMPTY_STATE: WorktreeState = { activePath: null, activeBranch: "", opened: [] };

export function useWorktreeState(activeProjectId: string | null) {
  const worktreeStateMap = useWorktreeStore(useShallow((s) => s.worktreeStateMap));

  const currentWtState: WorktreeState = activeProjectId
    ? (worktreeStateMap[activeProjectId] ?? EMPTY_STATE)
    : EMPTY_STATE;

  const activeWorktreePath = currentWtState.activePath;
  const activeWorktreeBranch = currentWtState.activeBranch;
  const openedWorktrees = currentWtState.opened;

  const updateWtPath = useCallback((path: string | null, branch: string) => {
    if (!activeProjectId) return;
    useWorktreeStore.setState((s) => {
      const prev = s.worktreeStateMap[activeProjectId] ?? EMPTY_STATE;
      return {
        worktreeStateMap: {
          ...s.worktreeStateMap,
          [activeProjectId]: {
            ...prev,
            activePath: path,
            activeBranch: branch,
          },
        },
        activeWorktreePath: path,
        activeWorktreeBranch: branch,
      };
    });
    // Sync activeTabId from editor tabs
    const tabKey = path
      ? buildWorktreeTabKey(activeProjectId, path)
      : activeProjectId;
    const projectTabs = useEditorStore.getState().tabs[tabKey];
    useEditorStore.setState({ activeTabId: projectTabs?.activeTabId ?? null });
  }, [activeProjectId]);

  const setActiveWorktreePath = useCallback((path: string | null) => {
    if (!activeProjectId) return;
    useWorktreeStore.setState((s) => {
      const prev = s.worktreeStateMap[activeProjectId] ?? EMPTY_STATE;
      return {
        worktreeStateMap: {
          ...s.worktreeStateMap,
          [activeProjectId]: {
            ...prev,
            activePath: path,
          },
        },
        activeWorktreePath: path,
      };
    });
    // Sync activeTabId from editor tabs
    const tabKey = path
      ? buildWorktreeTabKey(activeProjectId, path)
      : activeProjectId;
    const projectTabs = useEditorStore.getState().tabs[tabKey];
    useEditorStore.setState({ activeTabId: projectTabs?.activeTabId ?? null });
  }, [activeProjectId]);

  const setActiveWorktreeBranch = useCallback((branch: string) => {
    if (!activeProjectId) return;
    useWorktreeStore.setState((s) => ({
      worktreeStateMap: {
        ...s.worktreeStateMap,
        [activeProjectId]: {
          ...(s.worktreeStateMap[activeProjectId] ?? EMPTY_STATE),
          activeBranch: branch,
        },
      },
      activeWorktreeBranch: branch,
    }));
  }, [activeProjectId]);

  const setOpenedWorktrees = useCallback(
    (updater: WorktreeItem[] | ((prev: WorktreeItem[]) => WorktreeItem[])) => {
      if (!activeProjectId) return;
      useWorktreeStore.setState((s) => {
        const cur = s.worktreeStateMap[activeProjectId] ?? EMPTY_STATE;
        const newOpened = typeof updater === "function" ? updater(cur.opened) : updater;
        return {
          worktreeStateMap: {
            ...s.worktreeStateMap,
            [activeProjectId]: { ...cur, opened: newOpened },
          },
          openedWorktrees: newOpened,
        };
      });
    },
    [activeProjectId],
  );

  // Clear worktree active path for a specific project (e.g. when switching projects)
  const clearWorktreeForProject = useCallback((pid: string) => {
    useWorktreeStore.setState((s) => {
      const cur = s.worktreeStateMap[pid];
      if (!cur || cur.activePath === null) return {};
      return {
        worktreeStateMap: {
          ...s.worktreeStateMap,
          [pid]: { ...cur, activePath: null, activeBranch: "" },
        },
      };
    });
  }, []);

  return {
    activeWorktreePath,
    activeWorktreeBranch,
    openedWorktrees,
    updateWtPath,
    setActiveWorktreePath,
    setActiveWorktreeBranch,
    setOpenedWorktrees,
    clearWorktreeForProject,
  };
}
