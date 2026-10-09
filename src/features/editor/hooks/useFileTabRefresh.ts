import { useCallback } from 'react';

import { readFileContent } from '@/features/file/api/fileApi';
import { useFileChangedEvent } from '@/features/git';
import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import type { FileChangedEvent } from '@/shared/types';
import { pathsContainFile } from '@/shared/utils/fileRef';
import { workspaceRootOf } from '@/shared/utils/workspaceRef';

/**
 * useFileTabRefresh — listens for file-changed events and refreshes open file tabs.
 *
 * **按Workspace定址**：事件的 `workspace_key` 是 tab 组的**索引**（L2 后组键 = canonical
 * `WorkspaceKey`），只遍历该单元的 tab 组。**读取地址取自 `tab.workspace`**（值对象携带），
 * 不再从 key 解析还原身份。
 *
 * 命中判定仍收敛到**身份所有者**（`pathsContainFile`）：事件路径可能是单元相对（正常）
 * 或绝对（watcher `strip_prefix` 失败时的回退），两侧混合形态也必须命中。
 */
export function useFileTabRefresh() {
  // 稳定回调：宿主每次渲染重订阅会 churn 共享监听（refCount 反复升降）。
  const handleFileChanged = useCallback(async (event: FileChangedEvent) => {
    const { project_id: projectId, paths, workspace_key: workspaceKey } = event;
    if (!paths.length) return;

    const projectRoot =
      useProjectStore.getState().projects.find((p) => p.id === projectId)?.path ?? '';
    // 路径相对**该单元工作树根**：归一基准的唯一派生点是 `workspaceRootOf`，
    // 消费侧不得手写 `worktreePath ?? projectRoot` 的等价形态（第二派生点必然漂移）。
    const workspaceRoot = workspaceRootOf(workspaceKey, projectRoot);
    const projectTabs = useEditorStore.getState().tabs[workspaceKey];
    if (!projectTabs) return;

    for (const tab of projectTabs.tabs) {
      if (tab.data.kind !== 'file') continue;

      if (!pathsContainFile(workspaceRoot, paths, tab.data.filePath)) continue;

      if (tab.data.isDirty) {
        useEditorStore.getState().updateTab(workspaceKey, tab.id, {
          kind: 'file',
          externallyModified: true,
        });
      } else {
        try {
          // 地址 = 该 tab 所属Workspace（值携带，非解析）
          const content = await readFileContent(tab.data.workspace, tab.data.filePath);
          useEditorStore.getState().updateTab(workspaceKey, tab.id, {
            kind: 'file',
            content,
            externallyModified: false,
          });
        } catch (e) {
          console.warn('[useFileTabRefresh] Failed to refresh tab:', tab.data.filePath, e);
        }
      }
    }
  }, []);
  useFileChangedEvent(handleFileChanged);
}
