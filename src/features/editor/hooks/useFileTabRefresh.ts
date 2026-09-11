import { readFileContent } from '@/features/file/api/fileApi';
import { useFileChangedEvent } from '@/features/git';
import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import type { FileChangedEvent, FileContent } from '@/shared/types';
import { relativeToRoot } from '@/shared/utils/fileRef';

interface FileRefreshCommands {
  readFileContent(path: string): Promise<FileContent>;
}

/**
 * useFileTabRefresh — listens for file-changed events and refreshes open file tabs.
 * Accepts optional commands for WSL/Remote file reading (from use-active-project).
 * Falls back to unified_read_file_content for local when commands is null.
 *
 * 事件 paths 相对 watcher 监听的根（项目根）；tab.filePath 恒为 canonical 绝对，
 * 命中比较前按事件项目根剥根转相对（worktree 路径不在项目根下，与旧行为一致
 * ——watcher 只监听主项目路径）。
 */
export function useFileTabRefresh(commands?: FileRefreshCommands | null) {
  useFileChangedEvent(async (event: FileChangedEvent) => {
    const { project_id, paths } = event;
    if (!paths.length) return;

    const projectRoot =
      useProjectStore.getState().projects.find((p) => p.id === project_id)?.path ?? '';
    const state = useEditorStore.getState();
    for (const [tabKey, projectTabs] of Object.entries(state.tabs)) {
      for (const tab of projectTabs.tabs) {
        if (tab.data.kind !== 'file') continue;

        if (!paths.includes(relativeToRoot(projectRoot, tab.data.filePath))) continue;

        if (tab.data.isDirty) {
          useEditorStore.getState().updateTab(tabKey, tab.id, {
            kind: 'file',
            externallyModified: true,
          });
        } else {
          try {
            let content: FileContent;
            if (commands) {
              content = await commands.readFileContent(tab.data.filePath);
            } else {
              content = await readFileContent(project_id, tab.data.filePath);
            }
            useEditorStore.getState().updateTab(tabKey, tab.id, {
              kind: 'file',
              content,
              externallyModified: false,
            });
          } catch (e) {
            console.warn('[useFileTabRefresh] Failed to refresh tab:', tab.data.filePath, e);
          }
        }
      }
    }
  });
}
