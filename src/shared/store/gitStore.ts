import { create } from 'zustand';

import type { AheadBehind } from '@/shared/types';

interface GitStoreState {
  /**
   * 各**Workspace**的 ahead/behind（键 = `WorkspaceKey`，见 `shared/utils/workspaceRef.ts`）。
   *
   * 键里曾经还带 `{source}:{connectionId}` 前缀（`local:p1` / `wsl:Ubuntu:p1` / `remote:host:p1`，
   * 由已删除的 `aheadBehindKey(source, connectionId, projectId)` 拼出），但读写两侧各自拼这个前缀、
   * 三个调用点用了三种 connectionId 约定（`distro` / `${host}:${port}` / `host`）⇒ 写进去的键
   * 读侧永远拼不出来，徽标时有时无。project id 本身是 UUID（`ProjectManager` 生成），
   * `WorkspaceKey` 已全局唯一 —— connection 维度只会制造漂移，定址只留Workspace。
   */
  aheadBehind: Record<string, AheadBehind>;
  setAheadBehind: (workspaceKey: string, info: AheadBehind | null) => void;

  favoriteBranches: Record<string, string[]>;
  setFavoriteBranches: (projectId: string, branches: string[]) => void;
  toggleFavorite: (projectId: string, branchName: string) => void;

  /**
   * G4：各**Workspace**的 status 是否被截断（entries 超过 MAX_STATUS_ENTRIES=1000）。
   * ChangesList 顶部据此显示截断 banner（P3：截断显式化，对齐 orca too-many-changes）。
   * 键为 WorkspaceKey —— 主仓与 worktree 的截断状态互不相关。
   */
  truncatedByRepo: Record<string, boolean>;
  setStatusTruncated: (workspaceKey: string, truncated: boolean) => void;
}

export const useGitStore = create<GitStoreState>((set) => ({
  aheadBehind: {},

  setAheadBehind: (key, info) =>
    set((state) => {
      if (info === null) {
        if (!(key in state.aheadBehind)) return state;
        const { [key]: _, ...rest } = state.aheadBehind; // eslint-disable-line @typescript-eslint/no-unused-vars
        return { aheadBehind: rest };
      }
      const current = state.aheadBehind[key];
      if (current && current.ahead === info.ahead && current.behind === info.behind) {
        return state;
      }
      return { aheadBehind: { ...state.aheadBehind, [key]: info } };
    }),

  favoriteBranches: {},

  truncatedByRepo: {},

  setStatusTruncated: (workspaceKey, truncated) =>
    set((state) => {
      if (state.truncatedByRepo[workspaceKey] === truncated) return state;
      return { truncatedByRepo: { ...state.truncatedByRepo, [workspaceKey]: truncated } };
    }),

  setFavoriteBranches: (projectId, branches) =>
    set((state) => ({
      favoriteBranches: { ...state.favoriteBranches, [projectId]: branches },
    })),

  toggleFavorite: (projectId, branchName) =>
    set((state) => {
      const current = state.favoriteBranches[projectId] ?? [];
      const exists = current.includes(branchName);
      const next = exists ? current.filter((b) => b !== branchName) : [...current, branchName];
      return {
        favoriteBranches: { ...state.favoriteBranches, [projectId]: next },
      };
    }),
}));
