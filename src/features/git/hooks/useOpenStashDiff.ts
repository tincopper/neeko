import { useCallback } from 'react';

import type { StashEntry } from '@/features/git/types';
import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import type { Tab } from '@/shared/types';
import { workspaceKeyOf } from '@/shared/utils/workspaceRef';

/**
 * 点击 stash 文件打开 diff tab（与 history 打开 diff 文件机制一致）。
 * tabKey 与 ProjectView 对齐：使用 store 中的原始项目 ID，而非 use-active-project
 * 的统一 ID（wsl:distro:path / remote:host:path）；worktree 激活时使用 worktree 专属 tab key，
 * 避免 diff tab 落入 local tab 组。
 */
export function useOpenStashDiff(
  projectId: string | undefined,
  activeCheckoutPath?: string | null,
  stashes: StashEntry[] = [],
): (selector: string, filePath: string) => void {
  return useCallback(
    (selector: string, filePath: string) => {
      const projectState = useProjectStore.getState();
      const editorState = useEditorStore.getState();
      const realProjectId = projectState.activeProjectId ?? projectId ?? '';
      const tabKey = workspaceKeyOf(realProjectId, activeCheckoutPath);
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
        // tab 的 projectId 是真实 project id（持值，不从 tabKey 解回）
        projectId: realProjectId,
        title: message ? `${selector}: ${message}` : selector,
        order: existingTabs?.tabs.length ?? 0,
        data: {
          kind: 'diff',
          filePath,
          fileName,
          diffSource: {
            type: 'stash',
            projectId: realProjectId,
            selector,
          },
        },
      };
      editorState.addTab(tabKey, tabItem);
      editorState.activateTab(tabKey, tabId);
    },
    [projectId, activeCheckoutPath, stashes],
  );
}
