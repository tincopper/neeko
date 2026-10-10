import { useEditorStore } from '@/shared/store/editorStore';
import { activeWorkspaceSession } from '@/shared/store/workspaceStore';
import type { EditorGroupId, Tab } from '@/shared/types';
import type { ProjectId } from '@/shared/utils/workspaceRef';

/**
 * Create and activate an untitled file tab in the project's **active unit**.
 * Centralises the logic that was duplicated in ProjectView and
 * EditorGroupPane. `targetGroup` 指定落组（缺省走 addTab 既有落组逻辑）。
 *
 * 构造律 P3：store 键由 `session.key` 推导（不再由调用方传 tabKey）—— 键与 tab
 * 身份在构造上恒一致。
 */
export function createUntitledFileTab(
  projectId: ProjectId,
  targetGroup?: EditorGroupId | 'pinned',
): void {
  const store = useEditorStore.getState();
  const session = activeWorkspaceSession(projectId);
  const tabKey = session.key;
  const projTabs = store.tabs[tabKey]?.tabs ?? [];
  const untitledCount = projTabs.filter((t) => t.data.kind === 'file' && t.data.isUntitled).length;
  const num = untitledCount + 1;
  const name = `Untitled-${num}`;
  const tabId = `tab_${crypto.randomUUID()}`;

  const tab: Tab = {
    id: tabId,
    scope: { kind: 'workspace', session },
    title: name,
    order: projTabs.length,
    data: {
      kind: 'file',
      filePath: '',
      fileName: name,
      content: { path: '', content: '', size: 0, is_binary: false },
      isDirty: true,
      isUntitled: true,
      untitledName: name,
      initialPreviewMode: 'source',
    },
  };

  store.addTab(tab, targetGroup);
  store.activateTab(tabKey, tabId);
}
