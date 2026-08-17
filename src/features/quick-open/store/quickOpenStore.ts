/**
 * Quick Open palette state (Goto File / Recent Files).
 *
 * Tab switching no longer uses a palette: Ctrl+Tab / Ctrl+Shift+Tab perform a
 * direct MRU cycle via `tabCycleStore` (press-to-switch, no overlay).
 */
import { create } from 'zustand';

import { readDirTree } from '@/features/file/api/fileApi';
import { useOverlayStore } from '@/shared/store/overlayStore';
import { useProjectStore } from '@/shared/store/projectStore';

import { flattenFilePaths } from '../fileIndex';
import { fuzzyFilter } from '../fuzzy';
import { openProjectFile } from '../openFile';

import { useRecentFilesStore } from './recentFilesStore';

/** Quick-open palette 浮层 id（z-order 专项）。 */
export const QUICK_OPEN_OVERLAY_ID = 'quick-open';

export type QuickOpenMode = 'gotoFile' | 'recentFiles';

export interface QuickOpenItem {
  id: string;
  label: string;
  description?: string;
  /** File path to open. */
  payload: string;
}

interface QuickOpenState {
  open: boolean;
  mode: QuickOpenMode;
  query: string;
  selectedIndex: number;
  /** Flattened project files (cached per open of gotoFile). */
  fileIndex: string[];
  loading: boolean;
  items: QuickOpenItem[];

  openPalette: (mode: QuickOpenMode) => void;
  closePalette: () => void;
  setQuery: (q: string) => void;
  moveSelection: (delta: number) => void;
  confirm: () => Promise<void>;
}

function buildFileItems(paths: string[], query: string): QuickOpenItem[] {
  const filtered = fuzzyFilter(paths, query, (p) => p, 80);
  return filtered.map((p) => {
    const base = p.split('/').pop() ?? p;
    return {
      id: `file:${p}`,
      label: base,
      description: p,
      payload: p,
    };
  });
}

function buildRecentItems(projectId: string, query: string): QuickOpenItem[] {
  const recent = useRecentFilesStore.getState().list(projectId);
  const paths = recent.map((r) => r.filePath);
  const filtered = fuzzyFilter(paths, query, (p) => p, 50);
  return filtered.map((p) => {
    const base = p.split('/').pop() ?? p;
    return {
      id: `recent:${p}`,
      label: base,
      description: p,
      payload: p,
    };
  });
}

function recomputeItems(
  mode: QuickOpenMode,
  query: string,
  fileIndex: string[],
  projectId: string | null,
): QuickOpenItem[] {
  if (!projectId) return [];
  switch (mode) {
    case 'gotoFile':
      return buildFileItems(fileIndex, query);
    case 'recentFiles':
      return buildRecentItems(projectId, query);
  }
}

async function loadFileIndex(projectId: string): Promise<string[]> {
  try {
    const tree = await readDirTree(projectId, null, null, 12);
    return flattenFilePaths(tree);
  } catch (e) {
    console.warn('[quick-open] failed to load file index', e);
    return [];
  }
}

export const useQuickOpenStore = create<QuickOpenState>((set, get) => ({
  open: false,
  mode: 'gotoFile',
  query: '',
  selectedIndex: 0,
  fileIndex: [],
  loading: false,
  items: [],

  openPalette: (mode) => {
    const projectId = useProjectStore.getState().activeProjectId;
    const fileIndex = get().fileIndex;
    const items = recomputeItems(mode, '', fileIndex, projectId);
    // 浮层上报：palette 打开期间隐藏内容区 Browser webview（z-order 专项）
    useOverlayStore.getState().setOverlayOpen(QUICK_OPEN_OVERLAY_ID, true);
    set({
      open: true,
      mode,
      query: '',
      selectedIndex: 0,
      items,
      loading: mode === 'gotoFile',
    });

    if (mode === 'gotoFile' && projectId) {
      void loadFileIndex(projectId).then((idx) => {
        if (!get().open || get().mode !== 'gotoFile') return;
        const nextItems = recomputeItems('gotoFile', get().query, idx, projectId);
        set({ fileIndex: idx, items: nextItems, loading: false, selectedIndex: 0 });
      });
    } else {
      set({ loading: false });
    }
  },

  closePalette: () => {
    useOverlayStore.getState().setOverlayOpen(QUICK_OPEN_OVERLAY_ID, false);
    set({ open: false, query: '', selectedIndex: 0, loading: false });
  },

  setQuery: (q) => {
    const projectId = useProjectStore.getState().activeProjectId;
    const { mode, fileIndex } = get();
    const items = recomputeItems(mode, q, fileIndex, projectId);
    set({ query: q, items, selectedIndex: 0 });
  },

  moveSelection: (delta) => {
    const { items, selectedIndex } = get();
    if (items.length === 0) return;
    const next = (selectedIndex + delta + items.length) % items.length;
    set({ selectedIndex: next });
  },

  confirm: async () => {
    const { items, selectedIndex } = get();
    const item = items[selectedIndex];
    if (!item) {
      get().closePalette();
      return;
    }
    const projectId = useProjectStore.getState().activeProjectId;
    if (!projectId) {
      get().closePalette();
      return;
    }

    get().closePalette();
    try {
      await openProjectFile({ projectId, filePath: item.payload });
    } catch (e) {
      console.error('[quick-open] open failed', e);
    }
  },
}));

/** Label for palette header. */
export function quickOpenTitle(mode: QuickOpenMode): string {
  switch (mode) {
    case 'gotoFile':
      return 'Go to File';
    case 'recentFiles':
      return 'Recent Files';
  }
}
