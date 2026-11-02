import { listen } from '@tauri-apps/api/event';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAgentStore } from '@/shared/store/agentStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorkspaceStore } from '@/shared/store/workspaceStore';
import type { ProjectId } from '@/shared/utils/workspaceRef';
import {
  createClosedReply,
  createLaunchableAgent,
  createMemberStatus,
  createProject,
  createTeam,
  createTeamList,
  createTeamOptions,
  createTeamSnapshot,
  createTeamSummary,
} from '@/testing/factories';
import { invoke } from '@/testing/tauriCore';

import {
  __resetTeamGenerationForTests,
  __resetTeamPulseForTests,
  useTeamStore,
} from '../../store/teamStore';
import TeamPanel from '../TeamPanel';

/**
 * 团队列表 + 关闭团队（`team_list` / `team_close` 的面板面）。
 *
 * 覆盖的判据：
 * 1. 三种状态徽标**互不相同**（`closing` 与 `active` 可区分 —— 关到一半不是「运行中」）；
 * 2. 行数据全部来自载荷（成员数 / 任务 open/total / 截断提示）；
 * 3. 「打开」= `openTeam(teamId)`（随后 `team_snapshot` 用的就是这个 id）；
 * 4. 「关闭」= 二次确认 → `team_close({ teamId, memberId: null })`；
 * 5. **成功**才清 store；**失败不清**（团队停在 `closing` 是可查询的事实）；
 * 6. `closed` 行没有「关闭」按钮（只读快照没有可关的东西）；
 * 7. `state === 'closing'` 的快照 → 横幅 + 「重试关闭」；
 * 8. 空列表 / 加载失败 + 重试 / 加载中不显示空态（加载中闪空态 = 谎称团队都没了）；
 * 9. **列表态也有失效源**（F1）：脉冲 → `team_list` 重取；外加一个随时可用的「刷新」；
 * 10. 同一个队的成员数在列表行与面板头**同一个数**（后端口径：不含队长）。
 */

const mockInvoke = vi.mocked(invoke);

/** 每行按钮的可访问名（行内文案太短，名字里必须带队名才能被单独点到）。 */
const openLabel = (name: string): string => `打开团队 ${name}`;
const viewLabel = (name: string): string => `查看团队 ${name}`;
const closeLabel = (name: string): string => `关闭团队 ${name}`;

function setActiveProject(path = '/repo/main'): void {
  const project = createProject({ id: 'p1' as ProjectId, path });
  useProjectStore.setState({ activeProjectId: project.id, activeProject: project });
}

type ListenCb = (event: { payload: unknown }) => void;

const mockListen = vi.mocked(listen);

/** 团队事件的全部监听者（store 是唯一订阅者，所以这里通常只有一条回调）。 */
let handlers: ListenCb[] = [];

/** 推一条脉冲（等价于后端某个写路径调了 `emit`）。 */
function emitPulse(rev: number): void {
  act(() => {
    for (const handler of handlers) handler({ payload: { rev } });
  });
}

/** 每个用例都从「干净的 store + 清空的 mock」开始。 */
function resetStores(): void {
  __resetTeamGenerationForTests();
  __resetTeamPulseForTests();
  handlers = [];
  useTeamStore.setState({
    teamId: null,
    snapshot: null,
    detail: null,
    loading: false,
    error: null,
    lastRev: 0,
  });
  useProjectStore.setState({ activeProjectId: null, activeProject: null });
  useWorkspaceStore.setState({ byProject: {} });
  useAgentStore.setState({
    agents: [],
    loading: false,
  });
  mockListen.mockReset();
  mockListen.mockImplementation((async (_event: string, cb: ListenCb) => {
    handlers.push(cb);
    return () => {};
  }) as unknown as typeof listen);
}

/** 团队列表区域的 region（标题与列表项都挂在它下面）。 */
function listRegion(): HTMLElement {
  return screen.getByRole('region', { name: '已有团队' });
}

/** 某一行的 DOM（`data-team-id` 是稳定钩子：文案会变，id 不会）。 */
function rowOf(teamId: string): HTMLElement {
  const rows = within(listRegion()).getAllByRole('listitem');
  const row = rows.find((item) => item.getAttribute('data-team-id') === teamId);
  if (!row) throw new Error(`team row ${teamId} is not rendered`);
  return row;
}

/** `team_list` 之外的两条空态命令（队长入口挂载即拉；用例不关心它们的内容）。 */
function emptyLaunchSurface(cmd: string): unknown {
  if (cmd === 'team_launchable_agents') return [createLaunchableAgent({ agentId: 'claude-code' })];
  if (cmd === 'team_options') return createTeamOptions();
  return undefined;
}

function countCalls(cmd: string): number {
  return mockInvoke.mock.calls.filter(([name]) => name === cmd).length;
}

describe('TeamPanel — 团队列表', () => {
  beforeEach(() => {
    resetStores();
    mockInvoke.mockReset();
    setActiveProject();
  });

  it('三种状态的徽标文案互不相同（closing 不可并进 active）', async () => {
    const list = createTeamList({
      teams: [
        createTeamSummary({ teamId: 'tm_active', name: 'running-team' }),
        createTeamSummary({ teamId: 'tm_closing', name: 'halfway-team', state: 'closing' }),
        createTeamSummary({ teamId: 'tm_closed', name: 'done-team', state: 'closed' }),
      ],
    });
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === 'team_list') return list;
      return emptyLaunchSurface(cmd);
    });

    render(<TeamPanel />);

    await screen.findByText('running-team');
    const activeBadge = within(rowOf('tm_active')).getByText('运行中');
    const closingBadge = within(rowOf('tm_closing')).getByText('正在关闭');
    const closedBadge = within(rowOf('tm_closed')).getByText('已关闭');

    // 文案三者互不相同
    expect(activeBadge).not.toBe(closingBadge);
    expect(closingBadge).not.toHaveTextContent(activeBadge.textContent);
    expect(closedBadge).not.toHaveTextContent(activeBadge.textContent);
    expect(closingBadge).not.toHaveTextContent(closedBadge.textContent);

    // 「关到一半」的行里不许出现「运行中」这种说法
    expect(within(rowOf('tm_closing')).queryByText('运行中')).not.toBeInTheDocument();

    // 可访问文本也不同（灰度 / 读屏下颜色不可用）
    expect(closingBadge.getAttribute('aria-label')).not.toBe(
      activeBadge.getAttribute('aria-label'),
    );
    expect(activeBadge).toHaveAttribute('aria-label', expect.stringContaining('运行中'));
    expect(closingBadge).toHaveAttribute('aria-label', expect.stringContaining('还有成员没关掉'));
  });

  it('行上的成员数 / 任务 open-total / 项目根末段 / 创建时间来自载荷', async () => {
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === 'team_list')
        return createTeamList({
          teams: [
            createTeamSummary({
              teamId: 'tm_1',
              name: 'refactor',
              memberCount: 7,
              taskOpen: 3,
              taskTotal: 11,
              taskDone: 8,
              projectPath: '/repo/worktrees/feat-a',
              createdAt: Date.UTC(2024, 0, 2, 3, 4),
            }),
          ],
        });
      return emptyLaunchSurface(cmd);
    });

    render(<TeamPanel />);
    await screen.findByText('refactor');
    const row = rowOf('tm_1');

    // 数字来自载荷（不是前端数的：列表里没有花名册与任务行）
    expect(within(row).getByText('成员 7')).toBeInTheDocument();
    expect(within(row).getByText('任务 3/11')).toBeInTheDocument();
    // 窄面板只摆末段，完整路径进 title（信息没丢，只是默认不挤）
    const tail = within(row).getByText('feat-a');
    expect(tail).toHaveAttribute('title', '/repo/worktrees/feat-a');
    // 创建时间可见
    expect(within(row).getByText(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)).toBeInTheDocument();
  });

  it('truncated → 列表底部说明只显示了最近 50 个', async () => {
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === 'team_list')
        return createTeamList({ teams: [createTeamSummary({ teamId: 'tm_1' })], truncated: true });
      return emptyLaunchSurface(cmd);
    });

    render(<TeamPanel />);
    await screen.findByText('refactor');

    expect(within(listRegion()).getByText('只显示最近 50 个团队')).toBeInTheDocument();
  });

  it('未截断时不显示截断提示（否则提示永远亮着，等于没有提示）', async () => {
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === 'team_list') return createTeamList({ truncated: false });
      return emptyLaunchSurface(cmd);
    });

    render(<TeamPanel />);
    await screen.findByText('refactor');

    expect(within(listRegion()).queryByText(/只显示最近/)).not.toBeInTheDocument();
  });

  it('「打开」= openTeam(teamId)：随后的 team_snapshot 用的就是这个 id', async () => {
    const snapshot = createTeamSnapshot({ team: createTeam({ id: 'tm_2', name: 'beta' }) });
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === 'team_list')
        return createTeamList({
          teams: [
            createTeamSummary({ teamId: 'tm_1', name: 'alpha' }),
            createTeamSummary({ teamId: 'tm_2', name: 'beta' }),
          ],
        });
      if (cmd === 'team_snapshot') return snapshot;
      return emptyLaunchSurface(cmd);
    });

    render(<TeamPanel />);
    await screen.findByText('beta');
    fireEvent.click(screen.getByRole('button', { name: openLabel('beta') }));

    await waitFor(() => expect(useTeamStore.getState().teamId).toBe('tm_2'));
    // 打开的是**那一行**的 id（不是列表里的第一行）
    expect(mockInvoke).toHaveBeenCalledWith('team_snapshot', { teamId: 'tm_2' });
    expect(mockInvoke).not.toHaveBeenCalledWith('team_snapshot', { teamId: 'tm_1' });
    // 视图切到那个队（花名册出现了，列表收起来了）
    expect(await screen.findByRole('region', { name: '成员花名册' })).toBeInTheDocument();
  });

  it('closed 行只读：没有「关闭」按钮，只有「查看」', async () => {
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === 'team_list')
        return createTeamList({
          teams: [
            createTeamSummary({ teamId: 'tm_open', name: 'still-open' }),
            createTeamSummary({
              teamId: 'tm_closed',
              name: 'finished',
              state: 'closed',
              closedAt: 1_700_000_100_000,
            }),
          ],
        });
      return emptyLaunchSurface(cmd);
    });

    render(<TeamPanel />);
    await screen.findByText('finished');

    const closedRow = rowOf('tm_closed');
    expect(
      within(closedRow).getByRole('button', { name: viewLabel('finished') }),
    ).toBeInTheDocument();
    expect(
      within(closedRow).queryByRole('button', { name: closeLabel('finished') }),
    ).not.toBeInTheDocument();

    // 反证：active 行有「关闭」（否则上一条断言是空转的）
    expect(
      within(rowOf('tm_open')).getByRole('button', { name: closeLabel('still-open') }),
    ).toBeInTheDocument();
  });
});

describe('TeamPanel — 列表的失效源（F1）', () => {
  beforeEach(() => {
    resetStores();
    mockInvoke.mockReset();
    setActiveProject();
  });

  it('列表态（没有打开的队）收到脉冲 → team_list 被重取；返列表看到的是最新清单', async () => {
    let teams = [createTeamSummary({ teamId: 'tm_1', name: 'alpha' })];
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === 'team_list') return createTeamList({ teams });
      return emptyLaunchSurface(cmd);
    });

    render(<TeamPanel />);
    await screen.findByText('alpha');
    expect(countCalls('team_list')).toBe(1);
    // 列表态的前提：没有打开任何队（这正是修之前订阅被关掉的那一态）
    expect(useTeamStore.getState().teamId).toBeNull();

    // 建了一个新队（队长经 MCP / 另一窗口）：后端只推一条失效脉冲
    teams = [
      createTeamSummary({ teamId: 'tm_2', name: 'beta' }),
      createTeamSummary({ teamId: 'tm_1', name: 'alpha' }),
    ];
    emitPulse(1);

    expect(await screen.findByText('beta')).toBeInTheDocument();
    expect(countCalls('team_list')).toBe(2);
  });

  it('列表页有明确的「刷新」按钮（不只在出错时才有）', async () => {
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === 'team_list') return createTeamList({ teams: [] });
      return emptyLaunchSurface(cmd);
    });

    render(<TeamPanel />);
    await screen.findByText('还没有团队，先以队长身份开一个');
    expect(countCalls('team_list')).toBe(1);

    // 没有错误也要有刷新入口：事件订阅断了 / 用户就是想确认一眼时，这是唯一的手动路径
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重新拉取团队列表' }));

    await waitFor(() => expect(countCalls('team_list')).toBe(2));
  });

  it('同一个队的成员数：列表行与面板头是同一个数（后端口径，不含队长）', async () => {
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === 'team_list') {
        return createTeamList({
          teams: [createTeamSummary({ teamId: 'tm_1', name: 'refactor', memberCount: 2 })],
        });
      }
      if (cmd === 'team_snapshot') {
        // 花名册有 3 行（队长 + 2 个 worker），后端口径仍是 2
        return createTeamSnapshot({
          team: createTeam({ id: 'tm_1' }),
          memberCount: 2,
          members: [
            createMemberStatus({ memberId: 'lead@tm_1', name: 'lead', role: 'lead' }),
            createMemberStatus({ memberId: 'w1@tm_1', name: 'w1' }),
            createMemberStatus({ memberId: 'w2@tm_1', name: 'w2' }),
          ],
        });
      }
      return emptyLaunchSurface(cmd);
    });

    render(<TeamPanel />);
    await screen.findByText('refactor');
    expect(within(rowOf('tm_1')).getByText('成员 2')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: openLabel('refactor') }));
    await screen.findByRole('region', { name: '成员花名册' });

    // 修之前这里是「3 成员」（`members.length` 含队长）—— 同一个队两个成员数
    expect(screen.getByText('2 成员')).toBeInTheDocument();
    expect(screen.queryByText('3 成员')).not.toBeInTheDocument();
  });
});

describe('TeamPanel — 空态 / 加载 / 失败', () => {
  beforeEach(() => {
    resetStores();
    mockInvoke.mockReset();
    setActiveProject();
  });

  it('空列表：说明「还没有团队，先以队长身份开一个」', async () => {
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === 'team_list') return createTeamList({ teams: [] });
      return emptyLaunchSurface(cmd);
    });

    render(<TeamPanel />);

    expect(await screen.findByText('还没有团队，先以队长身份开一个')).toBeInTheDocument();
  });

  it('加载中不显示空态（「还没问到」不是「一个都没有」）', async () => {
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === 'team_list') return new Promise(() => undefined);
      return emptyLaunchSurface(cmd);
    });

    render(<TeamPanel />);

    await waitFor(() => expect(countCalls('team_list')).toBe(1));
    expect(screen.getByText('正在读取团队列表…')).toBeInTheDocument();
    expect(screen.queryByText('还没有团队，先以队长身份开一个')).not.toBeInTheDocument();
  });

  it('加载失败：显示后端原文 + 重试能重新拉取成功', async () => {
    let failing = true;
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === 'team_list') {
        if (failing) throw 'Failed to open the team database';
        return createTeamList({ teams: [createTeamSummary({ teamId: 'tm_1', name: 'refactor' })] });
      }
      return emptyLaunchSurface(cmd);
    });

    render(<TeamPanel />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Failed to open the team database');
    expect(screen.queryByText('还没有团队，先以队长身份开一个')).not.toBeInTheDocument();

    failing = false;
    fireEvent.click(screen.getByRole('button', { name: '重试' }));

    expect(await screen.findByText('refactor')).toBeInTheDocument();
    expect(countCalls('team_list')).toBe(2);
  });
});

describe('TeamPanel — 关闭团队', () => {
  beforeEach(() => {
    resetStores();
    mockInvoke.mockReset();
    setActiveProject();
  });

  const OPEN_TEAM_LIST = createTeamList({
    teams: [createTeamSummary({ teamId: 'tm_1', name: 'refactor' })],
  });

  /** 打开 tm_1（列表 → 「打开」），返回后 store 里 teamId 已是 tm_1。 */
  async function openFirstTeam(): Promise<void> {
    render(<TeamPanel />);
    await screen.findByText('refactor');
    fireEvent.click(screen.getByRole('button', { name: openLabel('refactor') }));
    await waitFor(() => expect(useTeamStore.getState().teamId).toBe('tm_1'));
  }

  it('二次确认后才调 team_close；成功后清空 store 并重取列表', async () => {
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === 'team_list') return OPEN_TEAM_LIST;
      if (cmd === 'team_snapshot') return createTeamSnapshot();
      if (cmd === 'team_close') return createClosedReply();
      return emptyLaunchSurface(cmd);
    });

    await openFirstTeam();
    const listCallsBefore = countCalls('team_list');

    fireEvent.click(screen.getByRole('button', { name: '关闭团队' }));

    // 二次确认：后果在按下去之前就写清楚（不靠关闭成功后的 notes 才揭示）
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('关闭团队「refactor」？')).toBeInTheDocument();
    expect(within(dialog).getByText(/graceful`? ?本期未兑现/)).toBeInTheDocument();
    expect(within(dialog).getByText(/worktree 一个都不会删/)).toBeInTheDocument();
    expect(within(dialog).getByText(/队长自己的终端/)).toBeInTheDocument();
    // 还没确认 ⇒ 一个关闭请求都没发
    expect(countCalls('team_close')).toBe(0);

    fireEvent.click(within(dialog).getByRole('button', { name: '确认关闭' }));

    // 整队关闭：memberId 显式 null（`Option<String>` 的「没给」由后端一步判定）
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('team_close', { teamId: 'tm_1', memberId: null }),
    );
    // 成功 ⇒ 面板回到列表
    await waitFor(() => expect(useTeamStore.getState().teamId).toBeNull());
    await waitFor(() => expect(countCalls('team_list')).toBeGreaterThan(listCallsBefore));
    expect(await screen.findByRole('region', { name: '已有团队' })).toBeInTheDocument();
  });

  it('关闭失败：不清 store（团队仍在 closing），显示后端原文，并重取快照 + 列表', async () => {
    const closingSnapshot = createTeamSnapshot({
      team: createTeam({ id: 'tm_1', state: 'closing' }),
    });
    let closeFailing = true;
    let snapshot = createTeamSnapshot();
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === 'team_list') return OPEN_TEAM_LIST;
      if (cmd === 'team_snapshot') return snapshot;
      if (cmd === 'team_close') {
        if (closeFailing)
          throw 'Conflict: team `tm_1` is still closing; `w1@tm_1`: the pty did not exit';
        return createClosedReply();
      }
      return emptyLaunchSurface(cmd);
    });

    await openFirstTeam();
    const listCallsBefore = countCalls('team_list');
    const snapshotCallsBefore = countCalls('team_snapshot');

    // 关闭失败后重取的快照会变成 closing（后端的真实状态）
    snapshot = closingSnapshot;

    fireEvent.click(screen.getByRole('button', { name: '关闭团队' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认关闭' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'Conflict: team `tm_1` is still closing; `w1@tm_1`: the pty did not exit',
    );

    // 失败不清 store：团队还是那个队（停在 closing），不是空面板
    expect(useTeamStore.getState().teamId).toBe('tm_1');
    // 快照与列表都重取过（closing 必须看得见）
    await waitFor(() => expect(countCalls('team_snapshot')).toBeGreaterThan(snapshotCallsBefore));
    await waitFor(() => expect(countCalls('team_list')).toBeGreaterThan(listCallsBefore));

    // 重取回来的确实是 closing：横幅 + 重试入口
    expect(await screen.findByText('团队正在关闭，还有成员没关掉')).toBeInTheDocument();

    // 重试走同一条关闭路径（不再弹第二次确认之外的分支）
    closeFailing = false;
    fireEvent.click(screen.getByRole('button', { name: '重试关闭' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认关闭' }));
    await waitFor(() => expect(useTeamStore.getState().teamId).toBeNull());
  });

  it('closing 快照：顶部横幅 + 「重试关闭」', async () => {
    useTeamStore.setState({
      teamId: 'tm_1',
      snapshot: createTeamSnapshot({ team: createTeam({ id: 'tm_1', state: 'closing' }) }),
    });
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === 'team_list') return OPEN_TEAM_LIST;
      if (cmd === 'team_snapshot')
        return createTeamSnapshot({ team: createTeam({ id: 'tm_1', state: 'closing' }) });
      return emptyLaunchSurface(cmd);
    });

    render(<TeamPanel />);

    expect(await screen.findByText('团队正在关闭，还有成员没关掉')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重试关闭' })).toBeInTheDocument();
  });

  it('active 快照没有 closing 横幅（否则横幅等于永久装饰）', async () => {
    useTeamStore.setState({ teamId: 'tm_1', snapshot: createTeamSnapshot() });
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === 'team_list') return OPEN_TEAM_LIST;
      if (cmd === 'team_snapshot') return createTeamSnapshot();
      return emptyLaunchSurface(cmd);
    });

    render(<TeamPanel />);
    const roster = await screen.findByRole('region', { name: '成员花名册' });
    expect(roster).toBeInTheDocument();
    expect(screen.queryByText('团队正在关闭，还有成员没关掉')).not.toBeInTheDocument();
  });

  it('「返回列表」不清 store：只切回列表视图', async () => {
    useTeamStore.setState({
      teamId: 'tm_1',
      snapshot: createTeamSnapshot({
        members: [createMemberStatus({ memberId: 'lead@tm_1', name: 'lead', role: 'lead' })],
      }),
    });
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === 'team_list') return OPEN_TEAM_LIST;
      if (cmd === 'team_snapshot') return createTeamSnapshot();
      return emptyLaunchSurface(cmd);
    });

    render(<TeamPanel />);
    await screen.findByRole('region', { name: '成员花名册' });

    fireEvent.click(screen.getByRole('button', { name: '返回列表' }));

    expect(await screen.findByRole('region', { name: '已有团队' })).toBeInTheDocument();
    // 团队还是打开着的那个（返回列表是导航，不是关闭）
    expect(useTeamStore.getState().teamId).toBe('tm_1');
    expect(useTeamStore.getState().snapshot).not.toBeNull();
  });
});
describe('TeamPanel — 列表页的上下分栏（队长入口 | 已有团队）', () => {
  beforeEach(() => {
    resetStores();
    mockInvoke.mockReset();
    setActiveProject();
  });

  it('两区之间有可拖的分隔条（而不是一个把列表顶出去的滚动容器）', async () => {
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === 'team_list') return createTeamList({ teams: [] });
      return emptyLaunchSurface(cmd);
    });

    render(<TeamPanel />);
    await screen.findByRole('region', { name: '已有团队' });

    // 分隔条是 react-resizable-panels 的 Separator（role=separator）：用户可拖、可键盘调。
    // 修之前没有它 —— 列表页只有一个 overflow-auto，入口块把「已有团队」顶到下面看不见。
    expect(screen.getByRole('separator')).toBeInTheDocument();

    // 两区各自挂稳定的面板 id（尺寸持久化与布局锚点；拼错会直接破坏布局）。
    expect(screen.getByTestId('team-launch')).toBeInTheDocument();
    expect(screen.getByTestId('team-list')).toBeInTheDocument();

    // 两个 region 同时可见（上下并存），不是「滚到下面才看得见第二个」
    expect(screen.getByRole('region', { name: '队长入口' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '已有团队' })).toBeInTheDocument();
  });

  it('列表区自己滚动：标题与刷新按钮留在原地（行区才是滚动容器）', async () => {
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === 'team_list')
        return createTeamList({
          teams: Array.from({ length: 12 }, (_, i) =>
            createTeamSummary({ teamId: `tm_${i}`, name: `team-${i}` }),
          ),
        });
      return emptyLaunchSurface(cmd);
    });

    render(<TeamPanel />);
    await screen.findByText('team-0');

    const list = listRegion();
    // 行区是唯一的滚动容器（`data-testid` 是稳定钩子：类名会随样式调整而变）。
    const scroller = within(list).getByTestId('team-list-scroller');
    expect(scroller).toBeInTheDocument();
    expect(scroller).toHaveClass('overflow-auto');
    // 行都在滚动容器里；标题与刷新按钮在它**外面**（否则滚到底就看不见刷新入口了）。
    expect(within(scroller).getByRole('list', { name: '团队列表' })).toBeInTheDocument();
    expect(
      within(scroller).queryByRole('button', { name: '重新拉取团队列表' }),
    ).not.toBeInTheDocument();
    expect(within(list).getByRole('button', { name: '重新拉取团队列表' })).toBeInTheDocument();
  });
});

/**
 * 错误的**归属**：每条错误都要显示在「它的动作能从哪里发起」的那一屏。
 *
 * 这一组钉的是一次真实回归：两个 hook 各有 `error`，曾经被合成一个「按当前视图二选一」的
 * 槽位（`showingTeamId !== null ? closeError : deleteError`）。而「关闭」在**列表行**上也能
 * 发起 —— 于是从列表行关闭失败时，后端逐个点名关不掉成员的那句话一个字都不显示，用户只看到
 * 徽标变成「正在关闭」，不知道原因，也不知道能重试。
 */
