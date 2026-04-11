import { useState, useRef, useCallback } from "react";

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

export function useWorktreeState(activeProjectIdRef: React.RefObject<string | null>) {
  const [worktreeStateMap, setWorktreeStateMap] = useState<WorktreeStateMap>({});
  const activeWorktreePathRef = useRef<string | null>(null);
  const openedWorktreesRef = useRef<WorktreeItem[]>([]);

  const getCurrentState = (pid: string | null): WorktreeState => {
    if (!pid) return EMPTY_STATE;
    return worktreeStateMap[pid] ?? EMPTY_STATE;
  };

  const currentPid = activeProjectIdRef.current;
  const currentWtState = getCurrentState(currentPid);
  const activeWorktreePath = currentWtState.activePath;
  const activeWorktreeBranch = currentWtState.activeBranch;
  const openedWorktrees = currentWtState.opened;

  const updateWtPath = useCallback((path: string | null, branch: string) => {
    const pid = activeProjectIdRef.current;
    if (!pid) return;
    setWorktreeStateMap(prev => ({
      ...prev,
      [pid]: { ...(prev[pid] ?? EMPTY_STATE), activePath: path, activeBranch: branch },
    }));
  }, []);

  const setActiveWorktreePath = useCallback((path: string | null) => {
    const pid = activeProjectIdRef.current;
    if (!pid) return;
    setWorktreeStateMap(prev => ({
      ...prev,
      [pid]: { ...(prev[pid] ?? EMPTY_STATE), activePath: path },
    }));
  }, []);

  const setActiveWorktreeBranch = useCallback((branch: string) => {
    const pid = activeProjectIdRef.current;
    if (!pid) return;
    setWorktreeStateMap(prev => ({
      ...prev,
      [pid]: { ...(prev[pid] ?? EMPTY_STATE), activeBranch: branch },
    }));
  }, []);

  const setOpenedWorktrees = useCallback(
    (updater: WorktreeItem[] | ((prev: WorktreeItem[]) => WorktreeItem[])) => {
      const pid = activeProjectIdRef.current;
      if (!pid) return;
      setWorktreeStateMap(prev => {
        const cur = prev[pid] ?? EMPTY_STATE;
        const newOpened = typeof updater === "function" ? updater(cur.opened) : updater;
        return { ...prev, [pid]: { ...cur, opened: newOpened } };
      });
    },
    [],
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
    activeWorktreePathRef,
    openedWorktreesRef,
    updateWtPath,
    setActiveWorktreePath,
    setActiveWorktreeBranch,
    setOpenedWorktrees,
    clearWorktreeForProject,
  };
}
