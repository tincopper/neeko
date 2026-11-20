import { useCallback } from 'react';

import { useEditorStore } from '@/shared/store/editorStore';
import { activeWorkspaceSession } from '@/shared/store/workspaceStore';
import { teamBoardTabTitle } from '@/shared/utils/teamTabTitles';
import type { ProjectId, WorkspaceSession } from '@/shared/utils/workspaceRef';

/**
 * 打开「团队看板 / 分配图」的中央 tab（300px 的 dock 列装不下整张板）。
 *
 * # 与 terminal tab 同一套规矩
 *
 * - 落键 = `activeWorkspaceSession(projectId)`（团队 v16 起绑定 projectId，与终端同一口径；
 *   旧行缺 projectId 由调用方回落激活项目）。
 * - **去重按 teamId**：同一支队伍只开一个看板 tab。重复打开 = **只激活**（`activateTab`），
 *   **不改它的视图** —— 「打开」是「带我去那儿」，不是「重置我上次的选择」。
 * - 激活即前台（addTab 后 activateTab）。
 *
 * # 视图（board / flow）是 tab 自己的导航态
 *
 * 建 tab 时用调用方给的 `view`（首次打开因此是调用方看到的那个视图，侧栏 / 内部入口一律 `board`）；
 * 之后它就归那个 tab：用户在中央 tab 内切换走 `PaneContent` 注入的 `onViewChange` →
 * `updateTab` → `mergeTabData` 合并 `view`。本 hook **不再**是写入点。
 *
 * 代价（有意为之）：面板自己的 board/flow 切换只影响面板；面板停在 flow 时点「在中间打开」，
 * 若该 tab 已存在，中央仍是他上次选的那个视图。要换视图用中央 tab 自己的头部按钮 —— 那里
 * 一直是该 tab 视图的唯一入口。反过来把「打开」当「推送视图」会把记忆抹掉，而用户对同一个
 * tab 的心智是「那是我上次待的地方」。
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
      // 只激活：**任何**对 `view` 的写入都等于重置用户上次的选择（R4）。
      state.activateTab(key, existing.id);
      return existing.id;
    }
    // id 里不带 view：view 是会被原地更新的可变量（用户在 tab 内切换），写进身份会让 id 立刻过时；
    // 去重也一直按 `data.teamId` 扫描，id 里的 teamId 只为人读。
    const tabId = `team-board_${spec.teamId}`;
    state.addTab({
      id: tabId,
      scope: { kind: 'workspace', session },
      title: teamBoardTabTitle(spec.teamName),
      data: { kind: 'team-board', teamId: spec.teamId, teamName: spec.teamName, view: spec.view },
    });
    state.activateTab(key, tabId);
    return tabId;
  }, []);

  return { openBoardTab };
}
