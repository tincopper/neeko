/**
 * Open a project-relative file in the editor (shared by Goto File / Recent / history).
 */
import { readFileContent } from '@/features/file/api/fileApi';
import { useEditorStore } from '@/shared/store/editorStore';
import { useWorktreeStore } from '@/shared/store/worktreeStore';
import type { Tab } from '@/shared/types';
import { preloadLanguageExtension } from '@/shared/utils/codemirror';
import { getFileName, getTabId } from '@/shared/utils/fileTree';
import { resolveTabKey } from '@/shared/utils/tabKey';

import { useRecentFilesStore } from './store/recentFilesStore';

export async function openProjectFile(opts: {
  projectId: string;
  filePath: string;
  line?: number;
  column?: number;
  /** When set, overrides the default preview mode (e.g. force source for newly created files). */
  defaultPreviewMode?: 'preview' | 'source';
}): Promise<void> {
  const { projectId, filePath } = opts;
  const line = Math.max(1, opts.line ?? 1);
  const col = Math.max(0, opts.column ?? 0);

  const wt = useWorktreeStore.getState().activeWorktreePath;
  const tabKey = resolveTabKey(projectId, wt);
  const store = useEditorStore.getState();
  const tabId = getTabId(tabKey, filePath);
  const existing = store.tabs[tabKey]?.tabs.find((t) => t.id === tabId);

  useRecentFilesStore.getState().record(projectId, filePath);

  if (existing) {
    store.setPendingNavigateTarget({ tabKey, tabId, line, col });
    store.activateTab(tabKey, tabId);
    return;
  }

  preloadLanguageExtension(filePath);
  const content = await readFileContent(projectId, filePath);
  const newTab: Tab = {
    id: tabId,
    projectId,
    title: getFileName(filePath),
    order: store.tabs[tabKey]?.tabs.length ?? 0,
    data: {
      kind: 'file',
      filePath,
      fileName: getFileName(filePath),
      content,
      isDirty: false,
      initialPreviewMode: opts.defaultPreviewMode,
    },
  };
  store.setPendingNavigateTarget({ tabKey, tabId, line, col });
  store.addTab(tabKey, newTab);
}
