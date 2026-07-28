import { create } from 'zustand';

import type { AheadBehind } from '@/shared/types';

interface GitStoreState {
  aheadBehind: Record<string, AheadBehind>;
  setAheadBehind: (key: string, info: AheadBehind | null) => void;

  favoriteBranches: Record<string, string[]>;
  setFavoriteBranches: (projectId: string, branches: string[]) => void;
  toggleFavorite: (projectId: string, branchName: string) => void;
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
