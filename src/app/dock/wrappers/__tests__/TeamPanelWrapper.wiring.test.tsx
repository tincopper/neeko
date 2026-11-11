import { fireEvent, render, screen, within } from '@testing-library/react';
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
import { useProjectStore } from '@/shared/store/projectStore';
import type { ProjectId } from '@/shared/utils/workspaceRef';
import {
  createMemberStatus,
  createProject,
  createTeam,
  createTeamList,
  createTeamSnapshot,
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
      terminalId: 'term-lead',
    }),
    createMemberStatus({
      memberId: 'w1@tm_1',
      name: 'frontend',
      terminalId: 'term-w1',
      agentId: 'qoder',
    }),
    createMemberStatus({
      memberId: 'w2@tm_1',
      name: 'backend',
      terminalId: null,
    }),
  ],
});

/** 花名册一行（按可访问名定位，不抓 DOM 结构）。 */
function rowOf(name: string): HTMLElement {
  return within(screen.getByRole('region', { name: '成员花名册' })).getByRole('group', {
    name: `成员 ${name}`,
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

    fireEvent.click(within(rowOf('frontend')).getByRole('button', { name: '打开会话：frontend' }));

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

    fireEvent.click(within(rowOf('lead')).getByRole('button', { name: '打开会话：lead' }));

    expect(openExistingTerminalTab).toHaveBeenCalledWith(PROJECT_ID, 'term-lead', 'lead', 'pi');
  });

  it('切到另一个项目后打开成员终端：仍然用**这个团队的** projectId（F3 判据）', () => {
    // 团队建在 p1 上，用户现在切到了 p2
    useProjectStore.setState({
      activeProjectId: 'p2' as ProjectId,
      activeProject: createProject({ id: 'p2' as ProjectId, path: '/repo/other' }),
    });
    render(<TeamPanelWrapper />);

    fireEvent.click(within(rowOf('frontend')).getByRole('button', { name: '打开会话：frontend' }));

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

    fireEvent.click(within(rowOf('frontend')).getByRole('button', { name: '打开会话：frontend' }));

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

    fireEvent.click(within(rowOf('frontend')).getByRole('button', { name: '打开会话：frontend' }));

    expect(openExistingTerminalTab).toHaveBeenCalledWith(
      PROJECT_ID,
      'term-w1',
      'frontend',
      'qoder',
    );
  });

  it('无进程的成员在这里也不会被开（判据在花名册，不在这里重复判）', () => {
    render(<TeamPanelWrapper />);
    const button = within(rowOf('backend')).getByRole('button', { name: '打开会话：backend' });

    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(openExistingTerminalTab).not.toHaveBeenCalled();
  });
});
