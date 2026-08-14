import { useCallback } from 'react';

import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import type { ConnectionContext, Tab } from '@/shared/types';
import { buildDiffSource } from '@/shared/utils/diffSource';
import { parseProjectIdFromTabKey, resolveTabKey } from '@/shared/utils/tabKey';

/**
 * 在编辑器打开（或激活已存在的）Commit Diff tab。
 *
 * - tabKey 与 ProjectWorkspace 对齐：使用 store 中的原始项目 ID（而非 use-active-project
 *   的统一 ID wsl:distro:path / remote:host:path）；worktree 激活时使用 worktree 专属
 *   tab key，避免 diff tab 落入 local tab 组。
 * - 同文件 diff tab 已存在时只激活不重复创建（editorStore.addTab 对 diff 有
 *   "同时只保留一个" 语义，去重可避免误替换用户正在查看的其他 diff）。
 * - tab 的 projectId 必须是真实 project id，不能用复合 worktree tab key
 *   （否则后端 resolve_project 找不到项目）。
 */
export function useOpenDiffTab(
  connectionContext: ConnectionContext | null,
  activeWorktreePath?: string | null,
  projectIdFallback?: string,
): (filePath: string) => void {
  return useCallback(
    (filePath: string) => {
      const projectState = useProjectStore.getState();
      const editorState = useEditorStore.getState();
      const tabKey = resolveTabKey(
        projectState.activeProjectId ?? projectIdFallback ?? '',
        activeWorktreePath,
      );
      const existingTabs = editorState.tabs[tabKey];
      const existingDiffTab = existingTabs?.tabs.find(
        (t) => t.data.kind === 'diff' && t.data.filePath === filePath,
      );
      if (existingDiffTab) {
        editorState.activateTab(tabKey, existingDiffTab.id);
        return;
      }

      const diffSource = buildDiffSource(connectionContext, activeWorktreePath);
      const fileName = filePath.split(/[\\/]/).pop() || filePath;
      const tabId = `tab_${crypto.randomUUID()}`;
      const tab: Tab = {
        id: tabId,
        projectId: parseProjectIdFromTabKey(tabKey),
        title: `Commit Diff · ${fileName}`,
        order: existingTabs?.tabs.length ?? 0,
        data: { kind: 'diff', filePath, fileName, diffSource },
      };
      editorState.addTab(tabKey, tab);
      editorState.activateTab(tabKey, tabId);
    },
    [connectionContext, activeWorktreePath, projectIdFallback],
  );
}
