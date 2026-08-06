import { create } from 'zustand';

import { createHistoryStack, type HistoryStack } from '@/shared/utils/historyStack';

import { useProjectStore } from './projectStore';

export interface BrowserPanelState {
  label: string;
  url: string;
  isCreated: boolean;
  isLoading: boolean;
  /** 每项目导航历史栈(驱动 canGoBack/canGoForward)。 */
  history: HistoryStack;
  /** 当前页面标题(空则地址栏降级显示 URL)。 */
  title: string;
  /** 当前页面 favicon URL(可能为空)。 */
  favicon: string;
  /** 最后活跃时间(epoch ms),项目切换到此项目时更新;驱动闲置回收。 */
  lastActiveAt: number;
}

interface ProjectBrowserStore {
  states: Record<string, BrowserPanelState>;
  getPanelState: (projectId: string) => BrowserPanelState;
  setPanelState: (projectId: string, patch: Partial<BrowserPanelState>) => void;
  removeState: (projectId: string) => void;
  navigateTo: {
    (url: string): void;
    (projectId: string, url: string): void;
  };
  reset: () => void;
}

const defaultPanelState = (label: string): BrowserPanelState => ({
  label,
  url: '',
  isCreated: false,
  isLoading: false,
  history: createHistoryStack(),
  title: '',
  favicon: '',
  lastActiveAt: 0,
});

function deriveLabel(projectId: string): string {
  return `neeko-browser-${projectId}`;
}

export const useProjectBrowserStore = create<ProjectBrowserStore>()((set, get) => ({
  states: {},

  getPanelState: (projectId) => {
    const existing = get().states[projectId];
    if (existing) return existing;
    const newState = defaultPanelState(deriveLabel(projectId));
    set((s) => ({ states: { ...s.states, [projectId]: newState } }));
    return newState;
  },

  setPanelState: (projectId, patch) =>
    set((s) => ({
      states: {
        ...s.states,
        [projectId]: { ...s.states[projectId], ...patch },
      },
    })),

  removeState: (projectId) =>
    set((s) => {
      const rest = { ...s.states };
      delete rest[projectId];
      return { states: rest };
    }),

  navigateTo: (urlOrProjectId: string, maybeUrl?: string) => {
    const projectId =
      maybeUrl !== undefined ? urlOrProjectId : useProjectStore.getState().activeProjectId;
    const url = maybeUrl ?? urlOrProjectId;
    if (!projectId) return;
    const state = get().getPanelState(projectId);
    get().setPanelState(projectId, { url, isLoading: true, isCreated: state.isCreated });
  },

  reset: () => set({ states: {} }),
}));

// 向后兼容：旧 store 引用继续工作
export const useBrowserStore = useProjectBrowserStore;
export type { BrowserPanelState as BrowserState };
