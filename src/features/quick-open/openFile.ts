/**
 * Open a file in the editor (shared by Goto File / Recent / search / history).
 *
 * 输入路径是项目根相对（quick-open 文件索引本就按项目根）；tab 身份统一存
 * canonical 绝对路径（worktree 激活时索引与读取 base 仍为项目根，与后端
 * `read_file_content` 缺省 resolve_base 一致）。
 */
import { readFileContent } from '@/features/file/api/fileApi';
import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorktreeStore } from '@/shared/store/worktreeStore';
import type { Tab } from '@/shared/types';
import { preloadLanguageExtension } from '@/shared/utils/codemirror';
import { canonicalFsPath } from '@/shared/utils/fileRef';
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
  const { projectId, filePath: rawPath } = opts;
  const line = Math.max(1, opts.line ?? 1);
  const col = Math.max(0, opts.column ?? 0);

  const projectPath =
    useProjectStore.getState().projects.find((p) => p.id === projectId)?.path ?? '';
  const filePath = canonicalFsPath(projectPath, rawPath);

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
