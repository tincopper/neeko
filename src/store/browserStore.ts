import { create } from "zustand";

export interface BrowserState {
  /** 当前 webview label（由后端返回） */
  label: string | null;
  /** 当前 URL */
  url: string;
  /** webview 是否已创建 */
  isCreated: boolean;
  /** 是否正在加载 */
  isLoading: boolean;

  // ── Actions ──
  /** 设置 label（由 useBrowserPanel 调用） */
  setLabel: (label: string | null) => void;
  /** 设置 URL */
  setUrl: (url: string) => void;
  /** 设置已创建状态 */
  setCreated: (created: boolean) => void;
  /** 设置加载状态 */
  setLoading: (loading: boolean) => void;
  /** 导航到新 URL（由终端链接模块调用） */
  navigateTo: (url: string) => void;
  /** 重置状态 */
  reset: () => void;
}

const initialState = {
  label: null,
  url: "",
  isCreated: false,
  isLoading: false,
};

export const useBrowserStore = create<BrowserState>()((set) => ({
  ...initialState,

  setLabel: (label) => set({ label }),
  setUrl: (url) => set({ url }),
  setCreated: (isCreated) => set({ isCreated }),
  setLoading: (isLoading) => set({ isLoading }),

  navigateTo: (url) => {
    set({ url, isLoading: true });
    // 注意：实际的 webview 创建/导航由 useBrowserPanel hook 监听 url 变化后执行
  },

  reset: () => set(initialState),
}));
