import { create } from 'zustand';

export type AppView = 'normal' | 'skills' | 'settings' | 'library';

/** Type guard: is the given string a real AppView value (defends against invalid casts). */
export function isAppView(value: string): value is AppView {
  return value === 'normal' || value === 'skills' || value === 'settings' || value === 'library';
}

/**
 * 单一中心路由源。值由各处写入：
 * - settings：工具栏按钮（useToolbarFooterProps）/ SettingsView
 * - library：dockStore 的 tab-mode 面板（openAs: 'tab'）
 * - skills：dockStore 的中心耦合 dock 面板（DOCK_PANEL_TO_APP_VIEW）
 * - normal：上述视图退出后的兜底
 */

interface AppViewStore {
  appView: AppView;
  setAppView: (view: AppView) => void;
}

export const useAppViewStore = create<AppViewStore>((set) => ({
  appView: 'normal',
  setAppView: (view) => set({ appView: view }),
}));
