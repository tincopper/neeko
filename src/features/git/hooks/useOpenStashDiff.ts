import { useCallback } from 'react';

import type { StashEntry } from '@/features/git/types';
import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import type { Tab } from '@/shared/types';
import { parseProjectIdFromTabKey, resolveTabKey } from '@/shared/utils/tabKey';

/**
 * 点击 stash 文件打开 diff tab（与 history 打开 diff 文件机制一致）。
 * tabKey 与 ProjectWorkspace 对齐：使用 store 中的原始项目 ID，而非 use-active-project
 * 的统一 ID（wsl:distro:path / remote:host:path）；worktree 激活时使用 worktree 专属 tab key，
 * 避免 diff tab 落入 local tab 组。
 */
export function useOpenStashDiff(
  projectId: string | undefined,
  activeWorktreePath?: string | null,
  stashes: StashEntry[] = [],
): (selector: string, filePath: string) => void {
  return useCallback(
    (selector: string, filePath: string) => {
      const projectState = useProjectStore.getState();
      const editorState = useEditorStore.getState();
      const tabKey = resolveTabKey(
        projectState.activeProjectId ?? projectId ?? '',
        activeWorktreePath,
      );
      const existingTabs = editorState.tabs[tabKey];
      const existingDiffTab = existingTabs?.tabs.find(
        (t) =>
          t.data.kind === 'diff' &&
          t.data.filePath === filePath &&
          t.data.diffSource.type === 'stash' &&
          t.data.diffSource.selector === selector,
      );
      if (existingDiffTab) {
        editorState.activateTab(tabKey, existingDiffTab.id);
        return;
      }
      const message = stashes.find((s) => s.selector === selector)?.message ?? '';
      const fileName = filePath.split(/[\\/]/).pop() || filePath;
      const tabId = `tab_${crypto.randomUUID()}`;
      const tabItem: Tab = {
        id: tabId,
        // tab 的 projectId 必须是真实 project id，不能用复合 worktree tab key
        //（否则后端 resolve_project 找不到项目）
        projectId: parseProjectIdFromTabKey(tabKey),
        title: message ? `${selector}: ${message}` : selector,
        order: existingTabs?.tabs.length ?? 0,
        data: {
          kind: 'diff',
          filePath,
          fileName,
          diffSource: {
            type: 'stash',
            projectId: parseProjectIdFromTabKey(tabKey),
            selector,
          },
        },
      };
      editorState.addTab(tabKey, tabItem);
      editorState.activateTab(tabKey, tabId);
    },
    [projectId, activeWorktreePath, stashes],
  );
}
