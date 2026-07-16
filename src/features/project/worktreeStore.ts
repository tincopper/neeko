import { create } from "zustand";

export interface WorktreeSnapshotItem {
  path: string;
  branch: string;
}

interface WorktreeStoreState {
  activeWorktreePath: string | null;
  activeWorktreeBranch: string;
  openedWorktrees: WorktreeSnapshotItem[];
  worktreeStateMap: Record<string, { activePath: string | null; activeBranch: string; opened: WorktreeSnapshotItem[] }>;
  /** @deprecated Will be removed when WSL migrates to unified worktree state */
  wslActiveWtBranch: string;
  /** @deprecated Will be removed when WSL migrates to unified worktree state */
  wslOpenedWt: WorktreeSnapshotItem[];
  /** @deprecated Will be removed when Remote migrates to unified worktree state */
  remoteActiveWtBranch: string;
  /** @deprecated Will be removed when Remote migrates to unified worktree state */
  remoteOpenedWt: WorktreeSnapshotItem[];
}

export const useWorktreeStore = create<WorktreeStoreState>(() => ({
  activeWorktreePath: null,
  activeWorktreeBranch: "",
  openedWorktrees: [],
  worktreeStateMap: {},
  wslActiveWtBranch: "",
  wslOpenedWt: [],
  remoteActiveWtBranch: "",
  remoteOpenedWt: [],
}));
