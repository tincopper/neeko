import { create } from 'zustand';

export interface SaveAsRequest {
  tabId: string;
  tabKey: string;
  projectId: string;
  content: string;
  defaultDirectory: string;
  defaultFilename: string;
  /** 关闭确认触发的 Save As：保存成功后自动关闭该 tab（Ctrl+S 手动保存不传）。 */
  closeAfterSave?: boolean;
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
