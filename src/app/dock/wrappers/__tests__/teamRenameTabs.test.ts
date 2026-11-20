import { beforeEach, describe, expect, it } from 'vitest';

import { useEditorStore } from '@/shared/store/editorStore';
import { activeWorkspaceSession, useWorkspaceStore } from '@/shared/store/workspaceStore';
import type { Tab } from '@/shared/types/tab';
import { leaderTerminalTabTitle, teamBoardTabTitle } from '@/shared/utils/teamTabTitles';
import { WorkspaceSession, type ProjectId } from '@/shared/utils/workspaceRef';
import { createProject } from '@/testing/factories';

import { retitleTeamTabs } from '../teamRenameTabs';

/**
 * 改名之后**已打开的 tab** 标题要跟上。
 *
 * # 为什么它是一段可单测的纯投影
 *
 * 团队名在后端只有一处（`team.name`），而它在**两个域**各有一份投影：dock 面板（读快照）
 * 与 tab 栏（标题是建 tab 那一刻的快照）。改名只改后端那一行，投影不追的症状是
 * 「列表叫新名字，tab 上还写着『队长 · 旧名』」—— 而它在任何单域测试里都是绿的。
 *
 * 判据（每条都是一个真实的可错点）：
 *
 * 1. **按句柄认人**：队长终端 tab 靠 `ptySessionId` 相等，**不是**靠标题字符串匹配
 *    （标题就是要被重写的东西，拿它当判据等于用结果找结果）；别的终端 tab 一个字节都不动。
 * 2. **看板 tab 只认 `data.teamId`**：同一台机器上有多个队，别的队的看板不能跟着改。
 * 3. **`data.teamName` 也要跟**：它不只是渲染用的副本，重新打开 / 去重时它还是落键的一部分。
 * 4. **落键不算判据**：tab 在**哪个工作区**里不影响命中 —— 用户建队后换了工作树，
 *    `activeWorkspaceSession` 已经不是 tab 所在的那个（这条曾经让改名静默只改一半）。
 */
const PROJECT = createProject({ id: 'p1' as ProjectId, path: '/repo/main' });
const TEAM = 'tm_1';

/** 团队所在的工作区（建队时的激活单元）。 */
function teamSession() {
  return activeWorkspaceSession(PROJECT.id);
}

/**
 * **另一个**工作树的单元（用户建队后切过去的那棵）。
 *
 * 身份由 `WorkspaceSession.of` 铸造（唯一身份源），不手写 key —— 这条测试本身不许再造一份。
 */
function otherWorktreeSession() {
  return WorkspaceSession.of('p1', '/repo/wt-other');
}

function spaceKey(): string {
  return teamSession().key;
}

function terminalTab(id: string, ptySessionId: string, title: string): Tab {
  return {
    id,
    scope: { kind: 'workspace', session: teamSession() },
    title,
    data: { kind: 'terminal', agentId: 'claude-code', ptySessionId },
  };
}

function boardTab(id: string, teamId: string, teamName: string): Tab {
  return {
    id,
    scope: { kind: 'workspace', session: teamSession() },
    title: teamBoardTabTitle(teamName),
    data: { kind: 'team-board', teamId, teamName, view: 'board' },
  };
}

function tabById(id: string): Tab | undefined {
  return useEditorStore.getState().tabs[spaceKey()]?.tabs.find((tab) => tab.id === id);
}

describe('retitleTeamTabs — 改名后已打开的 tab 跟上', () => {
  beforeEach(() => {
    useEditorStore.setState({ tabs: {}, editorLayout: {} });
    useWorkspaceStore.setState({ byProject: {} });
  });

  it('队长终端 tab 换成新标题；别的终端 tab 一个字节都不动', () => {
    useEditorStore
      .getState()
      .addTab(terminalTab('t-lead', 'term-lead', leaderTerminalTabTitle('旧名')));
    useEditorStore.getState().addTab(terminalTab('t-other', 'term-other', 'npm test'));

    retitleTeamTabs({
      teamId: TEAM,
      teamName: '新名',
      leaderTerminalId: 'term-lead',
    });

    expect(tabById('t-lead')?.title).toBe(leaderTerminalTabTitle('新名'));
    expect(tabById('t-other')?.title).toBe('npm test');
  });

  it('看板 tab：标题与 `data.teamName` 一起跟上，别的队的看板不动', () => {
    useEditorStore.getState().addTab(boardTab(`team-board_${TEAM}`, TEAM, '旧名'));
    useEditorStore.getState().addTab(boardTab('team-board_tm_2', 'tm_2', '另一个队'));

    retitleTeamTabs({
      teamId: TEAM,
      teamName: '新名',
      leaderTerminalId: null,
    });

    expect(tabById(`team-board_${TEAM}`)?.title).toBe(teamBoardTabTitle('新名'));
    const board = tabById(`team-board_${TEAM}`);
    expect(board?.data.kind === 'team-board' ? board.data.teamName : null).toBe('新名');

    expect(tabById('team-board_tm_2')?.title).toBe(teamBoardTabTitle('另一个队'));
  });

  it('没有队长句柄（队长进程已退出 / 快照不是这一队）⇒ 终端一个都不碰，看板照改', () => {
    useEditorStore
      .getState()
      .addTab(terminalTab('t-lead', 'term-lead', leaderTerminalTabTitle('旧名')));
    useEditorStore.getState().addTab(boardTab(`team-board_${TEAM}`, TEAM, '旧名'));

    retitleTeamTabs({
      teamId: TEAM,
      teamName: '新名',
      leaderTerminalId: null,
    });

    expect(tabById('t-lead')?.title).toBe(leaderTerminalTabTitle('旧名'));
    expect(tabById(`team-board_${TEAM}`)?.title).toBe(teamBoardTabTitle('新名'));
  });

  it('tab 落在**别的工作区**（用户建队后切过工作树）⇒ 照样命中，空间键不参与判定', () => {
    const elsewhere = otherWorktreeSession();
    useEditorStore.getState().addTab({
      id: `team-board_${TEAM}`,
      scope: { kind: 'workspace', session: elsewhere },
      title: teamBoardTabTitle('旧名'),
      data: { kind: 'team-board', teamId: TEAM, teamName: '旧名', view: 'board' },
    });
    useEditorStore.getState().addTab({
      id: 't-lead',
      scope: { kind: 'workspace', session: elsewhere },
      title: leaderTerminalTabTitle('旧名'),
      data: { kind: 'terminal', agentId: 'pi', ptySessionId: 'term-lead' },
    });

    retitleTeamTabs({ teamId: TEAM, teamName: '新名', leaderTerminalId: 'term-lead' });

    const inOther = useEditorStore
      .getState()
      .tabs[elsewhere.key]?.tabs.find((tab) => tab.id === 't-lead');
    expect(inOther?.title).toBe(leaderTerminalTabTitle('新名'));
    const boardInOther = useEditorStore
      .getState()
      .tabs[elsewhere.key]?.tabs.find((tab) => tab.id === `team-board_${TEAM}`);
    expect(boardInOther?.title).toBe(teamBoardTabTitle('新名'));
    // 主仓那个空间里没有这些 tab：同一份 tab 不会在另一个空间里留副本
    expect(tabById('t-lead')).toBeUndefined();
  });

  it('没有任何 tab ⇒ 空操作（不炸、不造空间）', () => {
    retitleTeamTabs({ teamId: TEAM, teamName: '新名', leaderTerminalId: 'term-lead' });
    expect(useEditorStore.getState().tabs).toEqual({});
  });
});
