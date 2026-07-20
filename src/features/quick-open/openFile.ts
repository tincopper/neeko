/**
 * Open a project-relative file in the editor (shared by Goto File / Recent / history).
 */
import { readFileContent } from '@/features/file/api/fileApi';
import { useWorktreeStore } from '@/features/project/worktreeStore';
import { useEditorStore } from '@/shared/store';
import type { Tab } from '@/shared/types';
import { preloadLanguageExtension } from '@/shared/utils/codemirror';
import { getFileName, getTabId } from '@/shared/utils/fileTree';
import { buildWorktreeTabKey } from '@/shared/utils/tabKey';

import { useRecentFilesStore } from './recentFilesStore';

export async function openProjectFile(opts: {
  projectId: string;
  filePath: string;
  line?: number;
  column?: number;
}): Promise<void> {
  const { projectId, filePath } = opts;
  const line = Math.max(1, opts.line ?? 1);
  const col = Math.max(0, opts.column ?? 0);

  const wt = useWorktreeStore.getState().activeWorktreePath;
  const tabKey = wt ? buildWorktreeTabKey(projectId, wt) : projectId;
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
    },
  };
  store.setPendingNavigateTarget({ tabKey, tabId, line, col });
  store.addTab(tabKey, newTab);
}
