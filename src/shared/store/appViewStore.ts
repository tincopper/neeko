import { create } from 'zustand';

export type AppView = 'normal' | 'skills' | 'settings' | 'library';

/** Type guard: is the given string a real AppView value (defends against invalid casts). */
export function isAppView(value: string): value is AppView {
  return value === 'normal' || value === 'skills' || value === 'settings' || value === 'library';
}

interface AppViewStore {
  appView: AppView;
  setAppView: (view: AppView) => void;
}

export const useAppViewStore = create<AppViewStore>((set) => ({
  appView: 'normal',
  setAppView: (view) => set({ appView: view }),
}));
