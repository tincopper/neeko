import { create } from 'zustand';

export type AppView = 'normal' | 'settings' | 'library' | 'tasks';

/** Type guard: is the given string a real AppView value (defends against invalid casts). */
export function isAppView(value: string): value is AppView {
  return value === 'normal' || value === 'settings' || value === 'library' || value === 'tasks';
}

/**
 * 单一中心路由源。值由各处写入：
 * - settings：工具栏按钮（useToolbarFooterProps）/ SettingsView
 * - library：dockStore 的 tab-mode 面板（openAs: 'tab'，内含 Skills/Prompts/MCP）
 * - tasks：dockStore 的 tab-mode 面板（openAs: 'tab'，工作项看板要整幅宽度）
 * - normal：上述视图退出后的兜底
 *
 * 新增中心视图 ≠ 在这里加一个字符串就够：同时要（1）在 `DOCK_PANEL_META` 标
 * `openAs: 'tab'`（否则它会被塞进 dock zone），（2）在 `AppCenter` 加渲染分支，
 * （3）让 `isAppView` 认它（否则 `togglePanel` 的防御守卫会静默吞掉点击）。
 */

interface AppViewStore {
  appView: AppView;
  setAppView: (view: AppView) => void;
}

export const useAppViewStore = create<AppViewStore>((set) => ({
  appView: 'normal',
  setAppView: (view) => set({ appView: view }),
}));
