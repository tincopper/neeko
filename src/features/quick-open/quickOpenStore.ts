/**
 * Quick Open palette state (Goto File / Recent Files / Tab Switcher).
 */
import { create } from 'zustand';

import { readDirTree } from '@/features/file/api/fileApi';
import { useProjectStore } from '@/features/project/store';
import { useWorktreeStore } from '@/features/project/worktreeStore';
import { useEditorStore } from '@/shared/store';
import { buildWorktreeTabKey } from '@/shared/utils/tabKey';

import { flattenFilePaths } from './fileIndex';
import { fuzzyFilter } from './fuzzy';
import { useMruTabsStore } from './mruTabsStore';
import { openProjectFile } from './openFile';
import { useRecentFilesStore } from './recentFilesStore';

export type QuickOpenMode = 'gotoFile' | 'recentFiles' | 'tabSwitcher';

export interface QuickOpenItem {
  id: string;
  label: string;
  description?: string;
  /** file path or tab id depending on mode */
  payload: string;
  kind: 'file' | 'tab';
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
  /** Ctrl+Tab while already open: move selection without closing. */
  cycleTabSwitcher: (direction: 1 | -1) => void;
  closePalette: () => void;
  setQuery: (q: string) => void;
  moveSelection: (delta: number) => void;
  confirm: () => Promise<void>;
  /** Activate selected tab (tab switcher on Ctrl release). */
  confirmTabSwitcher: () => void;
}

function currentTabKey(projectId: string): string {
  const wt = useWorktreeStore.getState().activeWorktreePath;
  return wt ? buildWorktreeTabKey(projectId, wt) : projectId;
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
      kind: 'file' as const,
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
      kind: 'file' as const,
    };
  });
}

function buildTabItems(projectId: string, query: string): QuickOpenItem[] {
  const tabKey = currentTabKey(projectId);
  const projectTabs = useEditorStore.getState().tabs[tabKey];
  if (!projectTabs) return [];

  const byId = new Map(projectTabs.tabs.map((t) => [t.id, t]));
  let order = useMruTabsStore.getState().list(tabKey);
  // Ensure all tabs present
  for (const t of projectTabs.tabs) {
    if (!order.includes(t.id)) order = [...order, t.id];
  }
  // Skip current active as first so first Ctrl+Tab goes to previous
  const active = projectTabs.activeTabId;
  if (active && order[0] === active && order.length > 1) {
    order = [...order.slice(1), active];
  }

  const items: QuickOpenItem[] = [];
  for (const id of order) {
    const tab = byId.get(id);
    if (!tab) continue;
    const label = tab.title;
    const desc =
      tab.data.kind === 'file'
        ? tab.data.filePath
        : tab.data.kind === 'terminal'
          ? 'Terminal'
          : tab.data.kind;
    items.push({
      id: `tab:${id}`,
      label,
      description: typeof desc === 'string' ? desc : String(desc),
      payload: id,
      kind: 'tab',
    });
  }

  if (!query.trim()) return items;
  return fuzzyFilter(items, query, (i) => `${i.label} ${i.description ?? ''}`, 40);
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
    case 'tabSwitcher':
      return buildTabItems(projectId, query);
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
    if (!projectId && mode !== 'tabSwitcher') {
      // Still allow if we have project for tabs
    }
    const pid = projectId ?? '';
    const fileIndex = get().fileIndex;
    const items = recomputeItems(mode, '', fileIndex, projectId);
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

    // Refresh tab list immediately for switcher
    if (mode === 'tabSwitcher' && projectId) {
      set({
        items: recomputeItems('tabSwitcher', '', fileIndex, projectId),
        selectedIndex: 0,
      });
    }
    void pid;
  },

  cycleTabSwitcher: (direction) => {
    const { open, mode } = get();
    if (!open || mode !== 'tabSwitcher') {
      get().openPalette('tabSwitcher');
      // After open, selection is 0 (first non-active in MRU)
      if (direction < 0) {
        // move to last
        const items = get().items;
        if (items.length > 0) set({ selectedIndex: items.length - 1 });
      }
      return;
    }
    get().moveSelection(direction);
  },

  closePalette: () => set({ open: false, query: '', selectedIndex: 0, loading: false }),

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
    const { items, selectedIndex, mode } = get();
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

    if (item.kind === 'file') {
      get().closePalette();
      try {
        await openProjectFile({ projectId, filePath: item.payload });
      } catch (e) {
        console.error('[quick-open] open failed', e);
      }
      return;
    }

    if (item.kind === 'tab') {
      get().confirmTabSwitcher();
    }
    void mode;
  },

  confirmTabSwitcher: () => {
    const { items, selectedIndex } = get();
    const item = items[selectedIndex];
    get().closePalette();
    if (!item || item.kind !== 'tab') return;
    const projectId = useProjectStore.getState().activeProjectId;
    if (!projectId) return;
    const tabKey = currentTabKey(projectId);
    useEditorStore.getState().activateTab(tabKey, item.payload);
  },
}));

/** Label for palette header. */
export function quickOpenTitle(mode: QuickOpenMode): string {
  switch (mode) {
    case 'gotoFile':
      return 'Go to File';
    case 'recentFiles':
      return 'Recent Files';
    case 'tabSwitcher':
      return 'Switch Tab';
  }
}
