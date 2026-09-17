/**
 * Open a file in the editor (shared by Goto File / Recent / search / history).
 *
 * 输入可能是**项目根相对路径**（quick-open 索引本就按项目根），也可能是**已规范的身份**
 * （最近文件列表存的就是 tab 身份：`dap-source:` 虚拟源码 / `jdt:` / JDK 缓存路径）。
 * 两者都由身份所有者归一（`sourceIdentityOf`），**不得**用 `canonicalFsPath` ——
 * 它会把非文件路径当相对路径拼上项目根，产出伪身份并开出重复 tab。
 *
 * worktree 激活时索引与读取 base 仍为项目根，与后端 `read_file_content` 缺省
 * resolve_base 一致。
 */
import { readFileContent } from '@/features/file/api/fileApi';
import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorktreeStore } from '@/shared/store/worktreeStore';
import type { Tab } from '@/shared/types';
import { getLanguageExtension } from '@/shared/utils/codemirror';
import { sourceIdentityOf } from '@/shared/utils/fileRef';
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
  const filePath = sourceIdentityOf(projectPath, rawPath);

  const wt = useWorktreeStore.getState().activeWorktreePath;
  const tabKey = resolveTabKey(projectId, wt);
  const store = useEditorStore.getState();
  const tabId = getTabId(tabKey, filePath);
  const existing = store.tabs[tabKey]?.tabs.find((t) => t.id === tabId);

  useRecentFilesStore.getState().record(projectId, filePath);

  if (existing) {
    store.setNavigateGoal({ tabKey, tabId, line, col });
    store.activateTab(tabKey, tabId);
    return;
  }

  // 语言扩展就绪屏障：await（与 runner/sourceTab 停点打开同款；in-flight 去重 +
  // 缓存命中即时返回）—— 扩展就绪后 tab 才挂载，CodeMirror 只配置一次，消灭
  // 「兑现后 reconfigure 重排」。quick-open 语义为 last-write-wins，屏障后不做许可复检。
  await getLanguageExtension(filePath);
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
  store.setNavigateGoal({ tabKey, tabId, line, col });
  store.addTab(tabKey, newTab);
}
