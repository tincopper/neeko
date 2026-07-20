/**
 * App-facing navigation history (Back / Forward).
 * Restores tabs via editor store + pendingNavigateTarget.
 */
import { create } from 'zustand';

import { readFileContent } from '@/features/file/api/fileApi';
import { useProjectStore } from '@/features/project/store';
import { useWorktreeStore } from '@/features/project/worktreeStore';
import { useEditorStore } from '@/shared/store';
import type { Tab } from '@/shared/types';
import { getFileName, getTabId } from '@/shared/utils/fileTree';
import { buildWorktreeTabKey } from '@/shared/utils/tabKey';
import { preloadLanguageExtension } from '@/shared/utils/codemirror';

import {
  createNavigationHistory,
  type NavLocation,
} from './navigationHistory';

const history = createNavigationHistory(100);

/** Suppress recording while applying a history jump. */
let suppressRecord = false;

interface NavHistoryState {
  canBack: boolean;
  canForward: boolean;
  /** Record a visited location (no-op during history restore). */
  record: (loc: NavLocation) => void;
  /** Capture current editor caret and record it. */
  recordCurrent: () => void;
  goBack: () => Promise<void>;
  goForward: () => Promise<void>;
  clear: () => void;
}

function syncFlags(set: (p: Partial<NavHistoryState>) => void) {
  set({
    canBack: history.canBack(),
    canForward: history.canForward(),
  });
}

/** Best-effort current file + caret as a history entry. */
export function captureCurrentNavLocation(): NavLocation | null {
  const proj = useProjectStore.getState();
  const wt = useWorktreeStore.getState();
  const editor = useEditorStore.getState();
  const projectId = proj.activeProjectId;
  if (!projectId) return null;

  const tabKey = wt.activeWorktreePath
    ? buildWorktreeTabKey(projectId, wt.activeWorktreePath)
    : projectId;

  const projectTabs = editor.tabs[tabKey];
  if (!projectTabs?.activeTabId) return null;
  const tab = projectTabs.tabs.find((t) => t.id === projectTabs.activeTabId);
  if (!tab || tab.data.kind !== 'file') return null;

  const cursor = editor.cursorPosition;
  return {
    projectId,
    tabKey,
    filePath: tab.data.filePath,
    line: Math.max(1, cursor?.line ?? 1),
    column: Math.max(0, cursor?.col ?? 0),
  };
}

async function restoreLocation(loc: NavLocation): Promise<void> {
  const store = useEditorStore.getState();
  const tabId = getTabId(loc.tabKey, loc.filePath);
  const existing = store.tabs[loc.tabKey];
  const hasTab = existing?.tabs.some((t) => t.id === tabId);

  store.setPendingNavigateTarget({
    tabKey: loc.tabKey,
    tabId,
    line: loc.line,
    col: loc.column,
  });

  if (hasTab) {
    store.activateTab(loc.tabKey, tabId);
    return;
  }

  // Open file tab then activate (pending target applied by FileViewer).
  preloadLanguageExtension(loc.filePath);
  try {
    const content = await readFileContent(loc.projectId, loc.filePath);
    const newTab: Tab = {
      id: tabId,
      projectId: loc.projectId,
      title: getFileName(loc.filePath),
      order: existing?.tabs.length ?? 0,
      data: {
        kind: 'file',
        filePath: loc.filePath,
        fileName: getFileName(loc.filePath),
        content,
        isDirty: false,
      },
    };
    store.addTab(loc.tabKey, newTab);
  } catch (e) {
    console.error('[nav-history] Failed to open', loc.filePath, e);
    store.setPendingNavigateTarget(null);
  }
}

/**
 * Call before leaving a location for a jump (e.g. go-to-definition).
 * Records `from` then the destination after navigation is requested.
 */
export function recordNavigationJump(from: NavLocation | null, to: NavLocation): void {
  if (suppressRecord) return;
  if (from) history.push(from);
  history.push(to);
  useNavHistoryStore.setState({
    canBack: history.canBack(),
    canForward: history.canForward(),
  });
}

export const useNavHistoryStore = create<NavHistoryState>((set) => ({
  canBack: false,
  canForward: false,

  record: (loc) => {
    if (suppressRecord) return;
    history.push(loc);
    syncFlags(set);
  },

  recordCurrent: () => {
    if (suppressRecord) return;
    const cur = captureCurrentNavLocation();
    if (cur) {
      history.push(cur);
      syncFlags(set);
    }
  },

  goBack: async () => {
    // Ensure current position is on the stack tip before leaving (if user moved caret).
    if (!suppressRecord) {
      const cur = captureCurrentNavLocation();
      const tip = history.current();
      if (cur && tip && !sameTipCareless(tip, cur)) {
        // Update tip caret if same file, else push
        history.replaceTip(cur);
      } else if (cur && !tip) {
        history.push(cur);
      }
    }
    const loc = history.back();
    syncFlags(set);
    if (!loc) return;
    suppressRecord = true;
    try {
      await restoreLocation(loc);
    } finally {
      suppressRecord = false;
      syncFlags(set);
    }
  },

  goForward: async () => {
    const loc = history.forward();
    syncFlags(set);
    if (!loc) return;
    suppressRecord = true;
    try {
      await restoreLocation(loc);
    } finally {
      suppressRecord = false;
      syncFlags(set);
    }
  },

  clear: () => {
    history.clear();
    syncFlags(set);
  },
}));

function sameTipCareless(a: NavLocation, b: NavLocation): boolean {
  return (
    a.projectId === b.projectId &&
    a.tabKey === b.tabKey &&
    a.filePath === b.filePath &&
    a.line === b.line &&
    a.column === b.column
  );
}
