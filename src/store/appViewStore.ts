import { create } from "zustand";

export type AppView = "normal" | "skills" | "settings";

interface AppViewStore {
  appView: AppView;
  setAppView: (view: AppView) => void;
}

export const useAppViewStore = create<AppViewStore>((set) => ({
  appView: "normal",
  setAppView: (view) => set({ appView: view }),
}));
