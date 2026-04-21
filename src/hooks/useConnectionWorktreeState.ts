import { useState, useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { WorktreeItem } from "./useWorktreeState";

export interface UseConnectionWorktreeStateResult<TDiffState> {
  diffState: TDiffState | null;
  setDiffState: Dispatch<SetStateAction<TDiffState | null>>;
  activeWorktreePath: string | null;
  setActiveWorktreePath: Dispatch<SetStateAction<string | null>>;
  activeWorktreeBranch: string;
  setActiveWorktreeBranch: Dispatch<SetStateAction<string>>;
  openedWorktrees: WorktreeItem[];
  setOpenedWorktrees: Dispatch<SetStateAction<WorktreeItem[]>>;
  openWorktreeTerminal: (worktreePath: string, branch: string) => void;
  resetConnectionState: () => void;
}

export function useConnectionWorktreeState<TDiffState>(): UseConnectionWorktreeStateResult<TDiffState> {
  const [diffState, setDiffState] = useState<TDiffState | null>(null);
  const [activeWorktreePath, setActiveWorktreePath] = useState<string | null>(null);
  const [activeWorktreeBranch, setActiveWorktreeBranch] = useState("");
  const [openedWorktrees, setOpenedWorktrees] = useState<WorktreeItem[]>([]);

  const openWorktreeTerminal = useCallback((worktreePath: string, branch: string) => {
    setActiveWorktreePath(worktreePath);
    setActiveWorktreeBranch(branch);
    setOpenedWorktrees((prev) => {
      if (prev.some((item) => item.path === worktreePath)) {
        return prev;
      }
      return [...prev, { path: worktreePath, branch }];
    });
    setDiffState(null);
  }, []);

  const resetConnectionState = useCallback(() => {
    setDiffState(null);
    setActiveWorktreePath(null);
    setActiveWorktreeBranch("");
    setOpenedWorktrees([]);
  }, []);

  return {
    diffState,
    setDiffState,
    activeWorktreePath,
    setActiveWorktreePath,
    activeWorktreeBranch,
    setActiveWorktreeBranch,
    openedWorktrees,
    setOpenedWorktrees,
    openWorktreeTerminal,
    resetConnectionState,
  };
}
