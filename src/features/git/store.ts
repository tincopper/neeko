import { create } from "zustand";
import type { AheadBehind } from "../../types";

interface GitStoreState {
  aheadBehind: Record<string, AheadBehind>;
  setAheadBehind: (key: string, info: AheadBehind | null) => void;
}

export const useGitStore = create<GitStoreState>((set) => ({
  aheadBehind: {},

  setAheadBehind: (key, info) =>
    set((state) => {
      if (info === null) {
        if (!(key in state.aheadBehind)) return state;
        const { [key]: _, ...rest } = state.aheadBehind;
        return { aheadBehind: rest };
      }
      const current = state.aheadBehind[key];
      if (current && current.ahead === info.ahead && current.behind === info.behind) {
        return state;
      }
      return { aheadBehind: { ...state.aheadBehind, [key]: info } };
    }),
}));
