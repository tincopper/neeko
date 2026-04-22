import { useState, useCallback } from "react";

export interface WorktreeItem {
  path: string;
  branch: string;
}

interface WorktreeState {
  activePath: string | null;
  activeBranch: string;
  opened: WorktreeItem[];
}

type WorktreeStateMap = Record<string, WorktreeState>;

const EMPTY_STATE: WorktreeState = { activePath: null, activeBranch: "", opened: [] };

export function useWorktreeState(activeProjectId: string | null) {
  const [worktreeStateMap, setWorktreeStateMap] = useState<WorktreeStateMap>({});

  const getCurrentState = (pid: string | null): WorktreeState => {
    if (!pid) return EMPTY_STATE;
    return worktreeStateMap[pid] ?? EMPTY_STATE;
  };

  const currentWtState = getCurrentState(activeProjectId);
  const activeWorktreePath = currentWtState.activePath;
  const activeWorktreeBranch = currentWtState.activeBranch;
  const openedWorktrees = currentWtState.opened;

  const updateWtPath = useCallback((path: string | null, branch: string) => {
    if (!activeProjectId) return;
    setWorktreeStateMap(prev => ({
      ...prev,
      [activeProjectId]: {
        ...(prev[activeProjectId] ?? EMPTY_STATE),
        activePath: path,
        activeBranch: branch,
      },
    }));
  }, [activeProjectId]);

  const setActiveWorktreePath = useCallback((path: string | null) => {
    if (!activeProjectId) return;
    setWorktreeStateMap(prev => ({
      ...prev,
      [activeProjectId]: { ...(prev[activeProjectId] ?? EMPTY_STATE), activePath: path },
    }));
  }, [activeProjectId]);

  const setActiveWorktreeBranch = useCallback((branch: string) => {
    if (!activeProjectId) return;
    setWorktreeStateMap(prev => ({
      ...prev,
      [activeProjectId]: { ...(prev[activeProjectId] ?? EMPTY_STATE), activeBranch: branch },
    }));
  }, [activeProjectId]);

  const setOpenedWorktrees = useCallback(
    (updater: WorktreeItem[] | ((prev: WorktreeItem[]) => WorktreeItem[])) => {
      if (!activeProjectId) return;
      setWorktreeStateMap(prev => {
        const cur = prev[activeProjectId] ?? EMPTY_STATE;
        const newOpened = typeof updater === "function" ? updater(cur.opened) : updater;
        return { ...prev, [activeProjectId]: { ...cur, opened: newOpened } };
      });
    },
    [activeProjectId],
  );

  // Clear worktree active path for a specific project (e.g. when switching projects)
  const clearWorktreeForProject = useCallback((pid: string) => {
    setWorktreeStateMap(prev => {
      const cur = prev[pid];
      if (!cur || cur.activePath === null) return prev;
      return { ...prev, [pid]: { ...cur, activePath: null, activeBranch: "" } };
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
