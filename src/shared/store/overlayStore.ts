import { create } from 'zustand';

/**
 * 全局浮层打开状态（z-order 专项的基础设施）。
 *
 * 编辑器内容区的 Browser tab 由 OS 级悬浮 webview 渲染，恒在主 React webview 之上。
 * 当任何 DOM 浮层（action 菜单 / quick-open / 右键菜单 / 确认对话框 / toast）打开时，
 * 若它与内容区重叠，会被 webview 遮挡。这些浮层在打开/关闭时向本 store 上报，
 * `useBrowserTab` 据此在浮层打开期间隐藏 Browser webview、关闭后恢复。
 */
interface OverlayStoreState {
  /** 当前打开的浮层集合（id 幂等）。 */
  open: Record<string, boolean>;
  /** 浮层 id 数量（派生，供 selector 高效订阅）。 */
  count: number;
  setOverlayOpen: (id: string, open: boolean) => void;
  reset: () => void;
}

export const useOverlayStore = create<OverlayStoreState>((set, get) => ({
  open: {},
  count: 0,

  setOverlayOpen: (id, open) => {
    const prev = get().open;
    if (open === !!prev[id]) return;
    const next = { ...prev, [id]: open };
    const count = Object.keys(next).filter((k) => next[k]).length;
    set({ open: next, count });
  },

  reset: () => set({ open: {}, count: 0 }),
}));

/** 是否有任一浮层打开（用于隐藏 Browser webview）。 */
export function hasOpenOverlay(): boolean {
  return useOverlayStore.getState().count > 0;
}
