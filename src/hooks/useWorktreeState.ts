import { useCallback } from "react";
import { useAppStore } from "../store/appStore";
import { buildWorktreeTabKey } from "../utils/tabKey";

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
  const worktreeStateMap = useAppStore((s) => s.worktreeStateMap);

  const currentWtState: WorktreeState = activeProjectId
    ? (worktreeStateMap[activeProjectId] ?? EMPTY_STATE)
    : EMPTY_STATE;

  const activeWorktreePath = currentWtState.activePath;
  const activeWorktreeBranch = currentWtState.activeBranch;
  const openedWorktrees = currentWtState.opened;

  const updateWtPath = useCallback((path: string | null, branch: string) => {
    if (!activeProjectId) return;
    useAppStore.setState((s) => {
      const tabKey = path
        ? buildWorktreeTabKey(activeProjectId, path)
        : activeProjectId;
      const projectTabs = s.tabs[tabKey];
      return {
        worktreeStateMap: {
          ...s.worktreeStateMap,
          [activeProjectId]: {
            ...(s.worktreeStateMap[activeProjectId] ?? EMPTY_STATE),
            activePath: path,
            activeBranch: branch,
          },
        },
        // Sync flat fields for direct consumers (DockPanelWrappers, TerminalView, etc.)
        activeWorktreePath: path,
        activeWorktreeBranch: branch,
        activeTabId: projectTabs?.activeTabId ?? null,
      };
    });
  }, [activeProjectId]);

  const setActiveWorktreePath = useCallback((path: string | null) => {
    if (!activeProjectId) return;
    useAppStore.setState((s) => {
      // Compute tabKey from the NEW state so activeTabId is correct in the same render
      const tabKey = path
        ? buildWorktreeTabKey(activeProjectId, path)
        : activeProjectId;
      const projectTabs = s.tabs[tabKey];
      return {
        worktreeStateMap: {
          ...s.worktreeStateMap,
          [activeProjectId]: {
            ...(s.worktreeStateMap[activeProjectId] ?? EMPTY_STATE),
            activePath: path,
          },
        },
        activeWorktreePath: path,
        activeTabId: projectTabs?.activeTabId ?? null,
      };
    });
  }, [activeProjectId]);

  const setActiveWorktreeBranch = useCallback((branch: string) => {
    if (!activeProjectId) return;
    useAppStore.setState((s) => ({
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
      useAppStore.setState((s) => {
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
    useAppStore.setState((s) => {
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
