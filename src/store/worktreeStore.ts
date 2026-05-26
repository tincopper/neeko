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
  activeWslWorktreePath: string | null;
  wslActiveWtBranch: string;
  wslOpenedWt: WorktreeSnapshotItem[];
  activeRemoteWorktreePath: string | null;
  remoteActiveWtBranch: string;
  remoteOpenedWt: WorktreeSnapshotItem[];
  worktreeState: Record<string, string>;
}

export const useWorktreeStore = create<WorktreeStoreState>(() => ({
  activeWorktreePath: null,
  activeWorktreeBranch: "",
  openedWorktrees: [],
  worktreeStateMap: {},
  activeWslWorktreePath: null,
  wslActiveWtBranch: "",
  wslOpenedWt: [],
  activeRemoteWorktreePath: null,
  remoteActiveWtBranch: "",
  remoteOpenedWt: [],
  worktreeState: {},
}));
