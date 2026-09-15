import type { DebugPanelSlice, DebugSliceCreator } from './types';

/** 面板可见性与页签：纯 UI 状态，无外部依赖。 */
export const createPanelSlice: DebugSliceCreator<DebugPanelSlice> = (set, get) => ({
  panelOpen: false,
  panelTab: 'console',

  setPanelOpen: (open) => set({ panelOpen: open }),

  setPanelTab: (tab) => set({ panelTab: tab }),

  openPanel: (tab) =>
    set({
      panelOpen: true,
      ...(tab ? { panelTab: tab } : {}),
    }),

  togglePanel: () => {
    const next = !get().panelOpen;
    set({ panelOpen: next });
  },
});
