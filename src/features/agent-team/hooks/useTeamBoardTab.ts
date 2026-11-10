import { useCallback } from 'react';

import { useEditorStore } from '@/shared/store/editorStore';
import { activeWorkspaceSession } from '@/shared/store/workspaceStore';
import type { ProjectId, WorkspaceSession } from '@/shared/utils/workspaceRef';

/**
 * 打开「团队看板 / 分配图」的中央 tab（300px 的 dock 列装不下整张板）。
 *
 * # 与 terminal tab 同一套规矩
 *
 * - 落键 = `activeWorkspaceSession(projectId)`（团队 v16 起绑定 projectId，与终端同一口径；
 *   旧行缺 projectId 由调用方回落激活项目）。
 * - **去重按 teamId**：同一支队伍只开一个看板 tab —— 重复打开 = 激活既有的并把
 *   `view` 合并进 tab data（从「看板」切到「分配图」再点一次打开，切换结果要保留）。
 * - 激活即前台（addTab 后 activateTab）。
 *
 * # 数据面
 *
 * tab 只携带地址（teamId / teamName / view）；快照仍归 `teamStore` —— 渲染组件
 * （`TeamBoardCenterView`）挂载时把 store 拉到这支队伍上，面板与中央 tab 是
 * 同一支队伍的两个观察位，不发生第二份快照。
 */
export interface TeamBoardTabSpec {
  teamId: string;
  teamName: string;
  /**
   * 团队绑定 projectId（**必填**）。
   *
   * 旧行（v16 前的空 `project_id`）的回落是**调用方**的事（`TeamPanelWrapper` 用
   * `teamProjectId ?? activeProjectId`）。本 hook 不接受 `null`：把 `null` 兜成
   * `''` 会 mint 一个挂在不存在项目上的 `WorkspaceSession`（伪身份），tab 会落进
   * 空项目槽位 —— 那正是 `tabIdentity.ts::requireTabWorkspaceSession` 要根除的类别。
   */
  projectId: ProjectId;
  view: 'board' | 'flow';
}

export function useTeamBoardTab() {
  const openBoardTab = useCallback((spec: TeamBoardTabSpec) => {
    const state = useEditorStore.getState();
    const session: WorkspaceSession = activeWorkspaceSession(spec.projectId);
    const key = session.key;
    const existing = (state.tabs[key]?.tabs ?? []).find(
      (tab) => tab.data.kind === 'team-board' && tab.data.teamId === spec.teamId,
    );
    if (existing) {
      if (existing.data.kind === 'team-board' && existing.data.view !== spec.view) {
        state.updateTab(key, existing.id, { kind: 'team-board', view: spec.view });
      }
      state.activateTab(key, existing.id);
      return existing.id;
    }
    // id 里不带 view：view 是会被原地合并更新的可变量，写进身份会让 id 立刻过时；
    // 去重也一直按 `data.teamId` 扫描，id 里的 teamId 只为人读。
    const tabId = `team-board_${spec.teamId}`;
    state.addTab({
      id: tabId,
      scope: { kind: 'workspace', session },
      title: `看板 · ${spec.teamName}`,
      data: { kind: 'team-board', teamId: spec.teamId, teamName: spec.teamName, view: spec.view },
    });
    state.activateTab(key, tabId);
    return tabId;
  }, []);

  return { openBoardTab };
}
