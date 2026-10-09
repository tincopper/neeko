import { readFileContent } from '@/features/file/api/fileApi';
import { useFileChangedEvent } from '@/features/git';
import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import type { FileChangedEvent, FileContent } from '@/shared/types';
import { pathsContainFile } from '@/shared/utils/fileRef';
import { resolveTabKey } from '@/shared/utils/tabKey';
import { parseWorkspaceKey, workspaceRootOf } from '@/shared/utils/workspaceRef';

interface FileRefreshCommands {
  readFileContent(path: string): Promise<FileContent>;
}

/**
 * useFileTabRefresh — listens for file-changed events and refreshes open file tabs.
 * Accepts optional commands for WSL/Remote file reading (from use-active-project).
 * Falls back to unified_read_file_content for local when commands is null.
 *
 * **按Workspace定址**：事件的 `workspace_key` 决定唯一目标 —— 工作树根（路径的相对基准）与
 * tab 空间（`resolveTabKey(projectId, worktreePath)`）都从它派生，只遍历该单元的 tab 组。
 * 旧实现遍历所有 tab 组并用「项目根」比对，于是 linked worktree 的事件既配不上自己的
 * tab 空间（列表不刷新的症状），又可能与主仓同名相对路径误配。
 *
 * 命中判定仍收敛到**身份所有者**（`pathsContainFile`）：事件路径可能是单元相对（正常）
 * 或绝对（watcher `strip_prefix` 失败时的回退），两侧混合形态也必须命中。
 */
export function useFileTabRefresh(commands?: FileRefreshCommands | null) {
  useFileChangedEvent(async (event: FileChangedEvent) => {
    const { project_id: projectId, paths } = event;
    if (!paths.length) return;

    const { worktreePath } = parseWorkspaceKey(event.workspace_key);
    const projectRoot =
      useProjectStore.getState().projects.find((p) => p.id === projectId)?.path ?? '';
    // 路径相对**该单元工作树根**：归一基准的唯一派生点是 `workspaceRootOf`（状态管理原则 4），
    // 消费侧不得手写 `worktreePath ?? projectRoot` 的等价形态（第二派生点必然漂移）
    const workspaceRoot = workspaceRootOf(event.workspace_key, projectRoot);
    const tabKey = resolveTabKey(projectId, worktreePath);
    const projectTabs = useEditorStore.getState().tabs[tabKey];
    if (!projectTabs) return;

    for (const tab of projectTabs.tabs) {
      if (tab.data.kind !== 'file') continue;

      if (!pathsContainFile(workspaceRoot, paths, tab.data.filePath)) continue;

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
            content = await readFileContent(projectId, tab.data.filePath);
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
  });
}
