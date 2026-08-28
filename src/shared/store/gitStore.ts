import { create } from 'zustand';

import type { AheadBehind } from '@/shared/types';

interface GitStoreState {
  aheadBehind: Record<string, AheadBehind>;
  setAheadBehind: (key: string, info: AheadBehind | null) => void;

  favoriteBranches: Record<string, string[]>;
  setFavoriteBranches: (projectId: string, branches: string[]) => void;
  toggleFavorite: (projectId: string, branchName: string) => void;

  /**
   * 各项目被 .gitignore 忽略的路径集合（文件树灰色显示的装饰输入）。
   * 独立于 Project.git_info 存储：git_info 会被项目列表刷新等路径用 Rust 返回值
   * 整体重建（Rust GitInfo 无此字段），寄生其中会被随时洗掉（补拉成果不可靠的根因）。
   */
  ignoredByProject: Record<string, string[]>;
  setIgnoredFiles: (projectId: string, files: string[]) => void;
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

  ignoredByProject: {},

  setIgnoredFiles: (projectId, files) =>
    set((state) => {
      const current = state.ignoredByProject[projectId];
      if (current && current.length === files.length && current.every((v, i) => v === files[i])) {
        return state;
      }
      return { ignoredByProject: { ...state.ignoredByProject, [projectId]: files } };
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
