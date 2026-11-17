import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { openExistingTerminalTab } = vi.hoisted(() => ({ openExistingTerminalTab: vi.fn() }));

vi.mock('@/features/terminal', () => ({
  useTerminalTabs: () => ({ openExistingTerminalTab }),
}));

vi.mock('@/shared/contexts', () => ({
  useAppContext: () => ({ showToast: vi.fn() }),
}));

import { __resetTeamGenerationForTests, useTeamStore } from '@/features/agent-team/store/teamStore';
import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { activeWorkspaceSession, useWorkspaceStore } from '@/shared/store/workspaceStore';
import type { Tab } from '@/shared/types/tab';
import { leaderTerminalTabTitle, teamBoardTabTitle } from '@/shared/utils/teamTabTitles';
import type { ProjectId } from '@/shared/utils/workspaceRef';
import {
  createMemberStatus,
  createProject,
  createTeam,
  createTeamList,
  createTeamSnapshot,
  createTeamSummary,
} from '@/testing/factories';
import { invoke } from '@/testing/tauriCore';

import { TeamPanelWrapper } from '../TeamPanelWrapper';

/**
 * 生产接线级验收：**花名册上按「打开终端」真的会把成员 PTY 接进 dock**。
 *
 * 这一层此前根本不存在 —— `TeamPanel` 只有「建队后自动打开队长终端」一个入口，
 * 用户反馈因此是「只能看到队长的会话，各 worker 的 CLI 会话看不到」。
 *
 * 面板级测试只证明「回调被调用」，而用户要的是「终端 tab 被打开」：两者之间还有
 * `openExistingTerminalTab(projectId, terminalId, title)` 这一步接线。这条接线断掉时，
 * 面板测试、回调断言、单元测试**全绿**，只有用户看不到东西。
 *
 * # projectId 必须是**这个团队的**
 *
 * 终端 tab 按 `(projectId, 工作区)` 落键。曾经这里取的是 `activeProjectId`，于是：
 * 用户切到另一个项目 / 另一个工作树之后再点成员终端，进程接得上、输出也有，但 tab 被登记在
 * **另一棵树**下面（关闭 / 恢复 / 分屏时才显形）。权威是团队行上的 `team.projectId`。
 */
const mockInvoke = vi.mocked(invoke);
const PROJECT_ID = 'p1' as ProjectId;

const SNAPSHOT = createTeamSnapshot({
  members: [
    createMemberStatus({
      memberId: 'lead@tm_1',
      name: 'lead',
      role: 'lead',
      session: { live: true, terminalId: 'term-lead' },
    }),
    createMemberStatus({
      memberId: 'w1@tm_1',
      name: 'frontend',
      session: { live: true, terminalId: 'term-w1' },
      agentId: 'qoder',
    }),
    createMemberStatus({
      memberId: 'w2@tm_1',
      name: 'backend',
      session: { live: false, terminalId: null },
    }),
  ],
});

/** 花名册一行（按可访问名定位，不抓 DOM 结构）。 */
function rowOf(name: string): HTMLElement {
  return within(screen.getByRole('region', { name: 'Member roster' })).getByRole('group', {
    name: `Member ${name}`,
  });
}

describe('TeamPanelWrapper — 成员终端接线', () => {
  beforeEach(() => {
    openExistingTerminalTab.mockReset();
    mockInvoke.mockReset();
    __resetTeamGenerationForTests();
    useTeamStore.setState({
      teamId: 'tm_1',
      snapshot: SNAPSHOT,
      detail: null,
      loading: false,
      error: null,
      lastRev: 0,
    });
    useProjectStore.setState({
      activeProjectId: PROJECT_ID,
      activeProject: createProject({ id: PROJECT_ID, path: '/repo/main' }),
    });
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === 'team_list') return createTeamList({ teams: [] });
      if (cmd === 'team_snapshot') return SNAPSHOT;
      return undefined;
    });
  });

  it('点成员的「打开终端」→ openExistingTerminalTab(激活项目, 成员 terminalId, 成员名)', () => {
    render(<TeamPanelWrapper />);

    fireEvent.click(
      within(rowOf('frontend')).getByRole('button', { name: 'Open session: frontend' }),
    );

    expect(openExistingTerminalTab).toHaveBeenCalledTimes(1);
    expect(openExistingTerminalTab).toHaveBeenCalledWith(
      PROJECT_ID,
      'term-w1',
      'frontend',
      'qoder',
    );
  });

  it('队长行走同一条接线（拿的是它自己的 terminalId，不是「队长特供」的另一条路）', () => {
    render(<TeamPanelWrapper />);

    fireEvent.click(within(rowOf('lead')).getByRole('button', { name: 'Open session: lead' }));

    expect(openExistingTerminalTab).toHaveBeenCalledWith(PROJECT_ID, 'term-lead', 'lead', 'pi');
  });

  it('切到另一个项目后打开成员终端：仍然用**这个团队的** projectId（F3 判据）', () => {
    // 团队建在 p1 上，用户现在切到了 p2
    useProjectStore.setState({
      activeProjectId: 'p2' as ProjectId,
      activeProject: createProject({ id: 'p2' as ProjectId, path: '/repo/other' }),
    });
    render(<TeamPanelWrapper />);

    fireEvent.click(
      within(rowOf('frontend')).getByRole('button', { name: 'Open session: frontend' }),
    );

    expect(openExistingTerminalTab).toHaveBeenCalledWith(
      PROJECT_ID,
      'term-w1',
      'frontend',
      'qoder',
    );
    expect(openExistingTerminalTab).not.toHaveBeenCalledWith(
      'p2',
      expect.anything(),
      expect.anything(),
    );
  });

  it('没有激活项目时也能开：团队的 projectId 才是权威', () => {
    useProjectStore.setState({ activeProjectId: null, activeProject: null });
    render(<TeamPanelWrapper />);

    fireEvent.click(
      within(rowOf('frontend')).getByRole('button', { name: 'Open session: frontend' }),
    );

    expect(openExistingTerminalTab).toHaveBeenCalledWith(
      PROJECT_ID,
      'term-w1',
      'frontend',
      'qoder',
    );
  });

  it('v16 之前的行（`projectId` 为空）才回落到激活项目（历史行的兜底，不猜就什么都不做）', () => {
    const legacy = createTeamSnapshot({
      team: createTeam({ projectId: '' as ProjectId }),
      members: SNAPSHOT.members,
    });
    useTeamStore.setState({ snapshot: legacy });
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === 'team_list') return createTeamList({ teams: [] });
      if (cmd === 'team_snapshot') return legacy;
      return undefined;
    });
    render(<TeamPanelWrapper />);

    fireEvent.click(
      within(rowOf('frontend')).getByRole('button', { name: 'Open session: frontend' }),
    );

    expect(openExistingTerminalTab).toHaveBeenCalledWith(
      PROJECT_ID,
      'term-w1',
      'frontend',
      'qoder',
    );
  });

  it('无进程的成员在这里也不会被开（判据在花名册，不在这里重复判）', () => {
    render(<TeamPanelWrapper />);
    const button = within(rowOf('backend')).getByRole('button', { name: 'Open session: backend' });

    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(openExistingTerminalTab).not.toHaveBeenCalled();
  });
});

/**
 * 改名之后**已打开的 tab** 标题要跟上（生产接线级）。
 *
 * 这一层正是「面板测试绿、用户仍看到旧名字」的缺口：`useTeamRename` 只改后端那一行，
 * 而 tab 标题是它在**另一个域**的投影 —— 接线漏了，两个域就各说各话。
 *
 * 两种 tab 各自靠什么认人（`teamRenameTabs` 的三条判据）：
 *
 * | tab | 靠什么 |
 * | --- | --- |
 * | 队长终端 | `ptySessionId` 相等（**不是**标题字符串：标题就是要被重写的东西）|
 * | 看板 | `data.teamId`（同一台机器上有多个队）|
 */
describe('TeamPanelWrapper — 改名同步 tab 标题', () => {
  beforeEach(() => {
    openExistingTerminalTab.mockReset();
    mockInvoke.mockReset();
    __resetTeamGenerationForTests();
    useEditorStore.setState({ tabs: {}, editorLayout: {} });
    useWorkspaceStore.setState({ byProject: {} });
    useTeamStore.setState({
      teamId: 'tm_1',
      snapshot: SNAPSHOT,
      detail: null,
      loading: false,
      error: null,
      lastRev: 0,
    });
    useProjectStore.setState({
      activeProjectId: PROJECT_ID,
      activeProject: createProject({ id: PROJECT_ID, path: '/repo/main' }),
    });
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === 'team_list') return createTeamList({ teams: [] });
      if (cmd === 'team_snapshot') return SNAPSHOT;
      if (cmd === 'team_rename') return undefined;
      return undefined;
    });
  });

  function addTab(tab: Tab): void {
    useEditorStore.getState().addTab(tab);
  }

  function tabTitle(id: string): string | undefined {
    const key = activeWorkspaceSession(PROJECT_ID).key;
    return useEditorStore.getState().tabs[key]?.tabs.find((tab) => tab.id === id)?.title;
  }

  it('队长终端 + 看板 tab 的标题都换成新队名（别的队 / 别的终端一个字节都不动）', async () => {
    const scope = { kind: 'workspace' as const, session: activeWorkspaceSession(PROJECT_ID) };
    addTab({
      id: 't-lead',
      scope,
      title: leaderTerminalTabTitle('refactor'),
      data: { kind: 'terminal', agentId: 'pi', ptySessionId: 'term-lead' },
    });
    addTab({
      id: 't-other',
      scope,
      title: 'npm test',
      data: { kind: 'terminal', agentId: null, ptySessionId: 'term-other' },
    });
    addTab({
      id: 'team-board_tm_1',
      scope,
      title: teamBoardTabTitle('refactor'),
      data: { kind: 'team-board', teamId: 'tm_1', teamName: 'refactor', view: 'board' },
    });

    render(<TeamPanelWrapper />);

    // 改名的第二入口在 `⋯` 菜单里（R1）；它走的仍是同一个 `handleStartRename`
    fireEvent.pointerDown(await screen.findByRole('button', { name: 'Team actions: refactor' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    // 编辑态在菜单卸载之后才开（焦点陷阱会抢走输入框焦点）
    const input = await screen.findByRole('textbox');
    fireEvent.change(input, { target: { value: '新队名' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(tabTitle('t-lead')).toBe(leaderTerminalTabTitle('新队名')));
    expect(tabTitle('team-board_tm_1')).toBe(teamBoardTabTitle('新队名'));
    expect(tabTitle('t-other')).toBe('npm test');
  });

  /**
   * 列表态改**另一支队**的名：不能拿「当前打开过的那支队」的队长句柄去投影。
   *
   * 这是这条接线上最容易写错的一处：`store.snapshot` 在列表态仍指着上一个打开过的队
   * （返回列表只改面板的局部导航态）。用它找队长句柄的话，A 的队长 tab 会被改成 B 的新名字，
   * 而 B 自己的终端一个都不会变 —— 两条都是错的，而且面板测试 / 单测全绿。
   */
  it('在列表里改**另一个队**的名 ⇒ 不碰当前打开的那支队的队长终端', async () => {
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === 'team_list') {
        return createTeamList({
          teams: [createTeamSummary({ teamId: 'tm_2', name: '另一个队' })],
        });
      }
      // 快照仍属于**上一次打开过的 tm_1**（列表态不换队）—— 这正是本条要防的前提。
      if (cmd === 'team_snapshot') return SNAPSHOT;
      if (cmd === 'team_rename') return undefined;
      return undefined;
    });

    const scope = { kind: 'workspace' as const, session: activeWorkspaceSession(PROJECT_ID) };
    addTab({
      id: 't-lead',
      scope,
      title: leaderTerminalTabTitle('refactor'),
      data: { kind: 'terminal', agentId: 'pi', ptySessionId: 'term-lead' },
    });
    addTab({
      id: 'team-board_tm_2',
      scope,
      title: teamBoardTabTitle('另一个队'),
      data: { kind: 'team-board', teamId: 'tm_2', teamName: '另一个队', view: 'board' },
    });

    render(<TeamPanelWrapper />);

    // 返回列表（store 里那支 tm_1 仍是「当前队」，返回列表只是面板的局部导航态）。
    fireEvent.click(await screen.findByRole('button', { name: 'Back to list' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Rename team 另一个队' }));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '新名字' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('team_rename', {
        teamId: 'tm_2',
        name: '新名字',
      }),
    );
    // tm_2 的看板 tab 跟上（它按 `data.teamId` 认人，与快照无关）
    await waitFor(() => expect(tabTitle('team-board_tm_2')).toBe(teamBoardTabTitle('新名字')));
    // tm_1 的队长终端**不能**被改名：它不属于被改名的那支队
    expect(tabTitle('t-lead')).toBe(leaderTerminalTabTitle('refactor'));
  });
});
