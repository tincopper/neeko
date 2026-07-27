import { create } from 'zustand';

export interface SaveAsRequest {
  tabId: string;
  tabKey: string;
  projectId: string;
  content: string;
  defaultDirectory: string;
  defaultFilename: string;
}

interface SaveAsStoreState {
  request: SaveAsRequest | null;
  requestSaveAs: (req: SaveAsRequest) => void;
  clearSaveAs: () => void;
}

export const useSaveAsStore = create<SaveAsStoreState>((set) => ({
  request: null,
  requestSaveAs: (req) => set({ request: req }),
  clearSaveAs: () => set({ request: null }),
}));
