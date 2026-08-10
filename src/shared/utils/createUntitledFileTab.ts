import { useEditorStore } from '@/shared/store/editorStore';
import type { Tab } from '@/shared/types';

/**
 * Create and activate an untitled file tab for the given project tab key.
 * Centralises the logic that was duplicated in ProjectWorkspace and
 * EditorGroupPane.
 */
export function createUntitledFileTab(tabKey: string, projectId: string): void {
  const store = useEditorStore.getState();
  const projTabs = store.tabs[tabKey]?.tabs ?? [];
  const untitledCount = projTabs.filter((t) => t.data.kind === 'file' && t.data.isUntitled).length;
  const num = untitledCount + 1;
  const name = `Untitled-${num}`;
  const tabId = `tab_${crypto.randomUUID()}`;

  const tab: Tab = {
    id: tabId,
    projectId,
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

  store.addTab(tabKey, tab);
  store.activateTab(tabKey, tabId);
}
