import { useCallback } from 'react';

import { useEditorStore } from '@/shared/store/editorStore';
import { activeWorkspaceSession } from '@/shared/store/workspaceStore';
import type { ProjectId, WorkspaceSession } from '@/shared/utils/workspaceRef';

/**
 * 打开「任务详情」的中央 tab（markdown 渲染 + 步骤轨迹）。
 *
 * 与 `useTeamBoardTab` 同一套规矩：去重按（teamId, taskId），重复打开 = 激活既有的。
 * 详情**点开才拉**（红线 4）：tab data 只带地址，渲染组件挂载时自己发
 * `team_task_detail`，关 tab 即弃 —— 不进 store，没有缓存失效问题。
 */
export interface TeamTaskTabSpec {
  teamId: string;
  taskId: string;
  /** 任务标题（tab 标题用；建 tab 时快照）。 */
  title: string;
  /**
   * 团队绑定 projectId（**必填**）。
   *
   * 旧行的回落是调用方的事（见 `useTeamBoardTab` 同名注释）：`null` 兜成 `''` 会
   * 铸造伪工作区身份。
   */
  projectId: ProjectId;
}

export function useTeamTaskTab() {
  const openTaskTab = useCallback((spec: TeamTaskTabSpec) => {
    const state = useEditorStore.getState();
    const session: WorkspaceSession = activeWorkspaceSession(spec.projectId);
    const key = session.key;
    const tabId = `team-task_${spec.teamId}_${spec.taskId}`;
    const existing = (state.tabs[key]?.tabs ?? []).find((tab) => tab.id === tabId);
    if (existing) {
      state.activateTab(key, tabId);
      return tabId;
    }
    state.addTab({
      id: tabId,
      scope: { kind: 'workspace', session },
      title: `${spec.taskId} · ${spec.title}`,
      data: {
        kind: 'team-task',
        teamId: spec.teamId,
        taskId: spec.taskId,
        label: spec.title,
      },
    });
    state.activateTab(key, tabId);
    return tabId;
  }, []);

  return { openTaskTab };
}
