import { create } from 'zustand';

import { useProjectStore } from './projectStore';

export interface BrowserPanelState {
  label: string;
  url: string;
  isCreated: boolean;
  isLoading: boolean;
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
