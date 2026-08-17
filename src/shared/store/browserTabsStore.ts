import { create } from 'zustand';

import { createHistoryStack, type HistoryStack } from '@/shared/utils/historyStack';

/**
 * 编辑器 Browser tab 的每-tab 状态源（与旧 dock panel 的 `browserStore` 并存）。
 *
 * 每个 Browser tab 拥有独立 webview（label = `neeko-browser-tab-{tabId}`）与独立状态：
 * URL / 历史栈 / title / favicon / 加载状态 / 是否已创建渲染资源 / 最后活跃时间。
 * 非激活 tab 采用懒创建：`isCreated=false` 时只保留 URL 等状态，激活时才建 webview。
 */
export interface BrowserTabState {
  /** webview label：`neeko-browser-tab-{tabId}`（事件路由与 Rust 侧标识）。 */
  label: string;
  /** 当前 URL（空 = 尚未导航）。 */
  url: string;
  /** webview 是否已创建（存在渲染资源）。 */
  isCreated: boolean;
  /** 是否正在加载。 */
  isLoading: boolean;
  /** 导航历史栈（驱动 canGoBack / canGoForward）。 */
  history: HistoryStack;
  /** 当前页面标题（空则地址栏降级显示 URL）。 */
  title: string;
  /** 当前页面 favicon URL（可能为空）。 */
  favicon: string;
  /** 最后活跃时间（epoch ms），tab 激活时更新；驱动闲置回收。 */
  lastActiveAt: number;
  /** 是否正在显示（可见）——由核心 hook 的 visible 驱动，供闲置回收判定。 */
  isActive: boolean;
}

interface BrowserTabsStore {
  states: Record<string, BrowserTabState>;
  /** 获取 tab 状态；不存在时按 label 初始化（幂等）。 */
  getTabState: (tabId: string, label: string) => BrowserTabState;
  setTabState: (tabId: string, patch: Partial<BrowserTabState>) => void;
  removeTabState: (tabId: string) => void;
  reset: () => void;
}

const defaultTabState = (label: string): BrowserTabState => ({
  label,
  url: '',
  isCreated: false,
  isLoading: false,
  history: createHistoryStack(),
  title: '',
  favicon: '',
  lastActiveAt: 0,
  isActive: false,
});

export const useBrowserTabsStore = create<BrowserTabsStore>()((set, get) => ({
  states: {},

  getTabState: (tabId, label) => {
    const existing = get().states[tabId];
    if (existing) return existing;
    const newState = defaultTabState(label);
    set((s) => ({ states: { ...s.states, [tabId]: newState } }));
    return newState;
  },

  setTabState: (tabId, patch) =>
    set((s) => {
      // 防御：state 不存在时先初始化完整默认状态（含 label/history），再应用 patch。
      // 与 getTabState 的初始化语义一致，避免 `{ ...undefined, ...patch }` 生成残缺状态。
      const base = s.states[tabId] ?? defaultTabState(patch.label ?? `neeko-browser-tab-${tabId}`);
      return {
        states: {
          ...s.states,
          [tabId]: { ...base, ...patch },
        },
      };
    }),

  removeTabState: (tabId) =>
    set((s) => {
      const rest = { ...s.states };
      delete rest[tabId];
      return { states: rest };
    }),

  reset: () => set({ states: {} }),
}));
