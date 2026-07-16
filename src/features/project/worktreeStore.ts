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
}

export const useWorktreeStore = create<WorktreeStoreState>(() => ({
  activeWorktreePath: null,
  activeWorktreeBranch: "",
  openedWorktrees: [],
  worktreeStateMap: {},
}));
