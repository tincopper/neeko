import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetTeamRosterStoreForTests,
  useTeamRosterStore,
} from '@/features/agent-team/store/teamRosterStore';
import { useTeamStore } from '@/features/agent-team/store/teamStore';
import { useEditorStore } from '@/shared/store/editorStore';
import { useLiveSessionsStore } from '@/shared/store/liveSessionsStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorkspaceStore } from '@/shared/store/workspaceStore';
import type { SessionView } from '@/shared/types/liveSessions';
import type { Tab } from '@/shared/types/tab';
import type { TeamSnapshot, TeamSummary } from '@/shared/types/team';
import { WorkspaceSession, type ProjectId } from '@/shared/utils/workspaceRef';
import { createMemberStatus, createTeamSnapshot, createTeamSummary } from '@/testing/factories';
import { invoke } from '@/testing/tauriCore';

import ProjectTeamList from '../ProjectTeamList';

/**
 * 侧栏**项目层团队容器**（`project → { units…, teams… }`）。
 *
 * 这一层要钉住的是容器模型的承重契约：
 *
 * | 契约 | 少了它会怎样 |
 * | --- | --- |
 * | 团队行与单元行**同构**（`SessionRow kind="team"`）| 它会被读成第三个层级（用户反馈「把 team 和 local、worktree 并齐」）|
 * | 折叠态**零**花名册请求（AC2）| 每个折叠的团队行挂载就去拉 ≤200 张任务卡片 |
 * | 展开一次、折叠再展开不重拉（AC3）| 展开/收起变成轮询 |
 * | 展开不碰 `teamStore.teamId`（AC4）| 侧栏看一眼成员就把面板切走 |
 * | 队长排第一 + `Lead` 标记 | 单行化之后「谁是队长」在别处都看不见 |
 * | 成员会话按 `attribution` 求交（AC5）| 成员跑在别的树里时侧栏一个人都看不见 |
 * | 无会话的成员行不可点 + **可见**理由 | 用户点到一条必然失败的路径（`disabled` 不可聚焦，`title` 拿不到）|
 *
 * 动作的**接线**（先切单元再接管）在 `useTeamEntryActions` 的测试里 —— 这里只证明分派到
 * 哪个回调、带的是哪条会话。
 */

/** 夹具团队的 `projectId`（`createTeamSummary` 的默认值）—— 团队选中的项目分量。 */
const PROJECT_ID = 'p1' as ProjectId;

const TEAM_WT = '/repo/wt';
const MEMBER_WT = '/repo/other-wt';

const mockInvoke = vi.mocked(invoke);

function team(overrides: Partial<TeamSummary> = {}): TeamSummary {
  return createTeamSummary({ teamId: 'tm_1', ...overrides });
}

/** 没有成员行的队（`memberCount` 不含队长 ⇒ 队长行也不存在）：首帧折叠，零请求。 */
function emptyTeam(overrides: Partial<TeamSummary> = {}): TeamSummary {
  return team({ memberCount: 0, leadMemberId: null, ...overrides });
}

function session(overrides: Partial<SessionView> = {}): SessionView {
  return {
    sessionId: 'pty-lead',
    kind: 'terminal',
    attribution: { kind: 'teamMember', teamId: 'tm_1', memberId: 'lead@tm_1' },
    agentId: 'claude-code',
    workspaceKey: WorkspaceSession.of('p1', TEAM_WT).key,
    title: '把任务板接上',
    titleSource: 'native',
    state: 'running',
    startedAt: '2026-11-02T10:00:00.000Z',
    updatedAt: '2026-11-02T10:00:00.000Z',
    turnCount: 1,
    hasUserInput: true,
    ...overrides,
  };
}

function seedSessions(...sessions: SessionView[]): void {
  useLiveSessionsStore.setState({ version: 1, sessions, hydratedAt: Date.now() });
}

/** 团队行（按「这一行里有这个名字」定位，不抓 DOM 结构）。 */
function teamRow(name: string): HTMLElement {
  const list = screen.getByRole('list', { name: 'Teams' });
  const row = within(list)
    .getAllByRole('listitem')
    .find((item) => within(item).queryByText(name) !== null);
  if (row === undefined) throw new Error(`team row ${name} not rendered`);
  return row;
}

/** 行主按钮（行上第一个按钮 = 点击区；第二个是展开箭头）。 */
function mainButton(row: HTMLElement): HTMLElement {
  const [first] = within(row).getAllByRole('button');
  return first;
}

/** 行尾展开箭头（与单元行同一枚：标签由 `childrenLabel` 给出）。 */
function expandButton(row: HTMLElement): HTMLElement {
  return within(row).getByRole('button', { name: /^(Expand|Collapse) team members$/ });
}

/** 成员行（展开后的子列表）。 */
function memberRow(name: string): HTMLElement {
  const list = screen.getByRole('list', { name: 'Team members' });
  const row = within(list)
    .getAllByRole('listitem')
    .find((item) => within(item).queryByText(name) !== null);
  if (row === undefined) throw new Error(`member row ${name} not rendered`);
  return row;
}

function renderList(
  teams: readonly TeamSummary[],
  options: { worktreePaths?: readonly string[] } = {},
) {
  const handlers = {
    onOpenLead: vi.fn(),
    onOpenTeamPanel: vi.fn(),
    onOpenMember: vi.fn(),
  };
  // 用例里按**路径**写更可读；组件收的是**身份**（红线 12 的同一份 mint），转换只在这里做。
  const worktreeKeys = new Set(
    (options.worktreePaths ?? []).map((path) => WorkspaceSession.of(PROJECT_ID, path).key),
  );
  const view = render(<ProjectTeamList teams={teams} worktreeKeys={worktreeKeys} {...handlers} />);
  return { ...handlers, view };
}

/**
 * 展开某个队并等**花名册落地**（成功路径的信号：成员列表出现）。
 *
 * 幂等：重复调用不会来回切（先读 `aria-expanded` 再决定要不要点）。团队行**首帧不展开**：
 * 它的子项要发一次花名册请求，而单元行的子项就在内存里（见 `SessionRow.defaultExpanded`）。
 *
 * 不用 `act` 包 `fireEvent`：`fireEvent` 自己就在 act 里，额外包一层只会让异步结算
 * 被藏起来（失败路径的信号是 `role="alert"`，由用例自己等）。
 */
async function expand(row: HTMLElement): Promise<void> {
  const button = expandButton(row);
  if (button.getAttribute('aria-expanded') === 'false') fireEvent.click(button);
  await waitFor(() => {
    expect(screen.getByRole('list', { name: 'Team members' })).toBeInTheDocument();
  });
}

async function collapse(row: HTMLElement): Promise<void> {
  const button = expandButton(row);
  if (button.getAttribute('aria-expanded') === 'true') fireEvent.click(button);
  await waitFor(() => {
    expect(screen.queryByRole('list', { name: 'Team members' })).not.toBeInTheDocument();
  });
}

const snapshotInvocations = () => mockInvoke.mock.calls.filter(([cmd]) => cmd === 'team_snapshot');

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  mockInvoke.mockReset();
  mockInvoke.mockImplementation(async (cmd) => {
    if (cmd === 'team_snapshot') return createTeamSnapshot();
    return undefined;
  });
  __resetTeamRosterStoreForTests();
  useTeamStore.setState({ teamId: null, snapshot: null, loading: false, error: null, lastRev: 0 });
  useEditorStore.setState({ tabs: {}, editorLayout: {} });
  // `activeTeam` 也要重置：漏了会让上一个用例的选中漏进下一个（假绿）。
  useWorkspaceStore.setState({ byProject: {}, activeTeam: null });
  useProjectStore.setState({ activeProjectId: null });
  useLiveSessionsStore.setState({ version: 0, sessions: [], hydratedAt: null });
});

describe('ProjectTeamList — 行形状与单元行同构（R1 第二轮）', () => {
  it('单行：行首 `Users` 图标 + 队名 + 未终结/总数，没有 `⟦team⟧`、没有 `Lead ·`、没有状态文字', async () => {
    seedSessions(session());
    renderList([team({ state: 'closing', taskOpen: 2, taskTotal: 5, memberCount: 3 })]);
    await expand(teamRow('refactor'));

    const row = teamRow('refactor');
    // eslint-disable-next-line testing-library/no-node-access -- 断言「行首图标是哪一个」：图标没有可访问名（无 role / label），只能按 lucide 的 class 断言（同 DiagnosticsPanel 的写法）
    expect(row.querySelector('svg.lucide-users')).not.toBeNull();
    expect(within(row).getByText('refactor')).toBeInTheDocument();
    expect(within(row).getByText('2/5')).toBeInTheDocument();

    // **没有状态文字**（用户裁决：「特别这种文字的状态显示，很占用空间」）。
    // 判据钉的是「所有三态的文案都不出现」，否则删掉 `open` 忘了 `closing` 会静默通过。
    for (const label of ['Open', 'Closing', 'Sealed']) {
      expect(within(row).queryByText(label)).not.toBeInTheDocument();
    }

    // 标记与副文案整体删除：队长信息只在成员子行里（排第一 + `Lead`）
    expect(within(row).queryByText(/⟦team⟧/)).not.toBeInTheDocument();
    expect(within(row).queryByText(/Lead ·/)).not.toBeInTheDocument();
  });

  it('行尾是 `SessionRow` 的展开箭头（`aria-expanded` 说了算），不是自绘的两行结构', async () => {
    renderList([emptyTeam()]);
    const row = teamRow('refactor');

    const button = expandButton(row);
    expect(button).toHaveAttribute('aria-expanded', 'false');

    await expand(row);
    expect(expandButton(row)).toHaveAttribute('aria-expanded', 'true');
  });

  /**
   * 与单元行的**唯一**差别：首帧不展开。
   *
   * 单元行的子项来自内存里的会话快照（展开是纯渲染），团队行的子项要发一次
   * `team_snapshot`。跟着「有子项就展开」会让侧栏每次挂载为每个队各拉一次花名册，而用户可能
   * 整场都不看任何一个队。行几何仍然同构 —— 差别只在这一次请求上。
   */
  it('有成员的队**首帧不展开** ⇒ 挂载零请求；展开才拉一次', async () => {
    renderList([team({ memberCount: 3 })]);
    const row = teamRow('refactor');

    expect(expandButton(row)).toHaveAttribute('aria-expanded', 'false');
    expect(snapshotInvocations()).toHaveLength(0);
    // 行上仍然报人数（memberCount 不含队长 ⇒ 成员行数 = 3 + 1）
    expect(within(row).getByText('2/5')).toBeInTheDocument();

    await expand(row);
    expect(snapshotInvocations()).toHaveLength(1);
  });
});

describe('ProjectTeamList — 折叠态（AC2）', () => {
  it('折叠 ⇒ **零**花名册请求（子块整块不挂载）', async () => {
    const { onOpenTeamPanel } = renderList([emptyTeam()]);
    const row = teamRow('refactor');

    expect(expandButton(row)).toHaveAttribute('aria-expanded', 'false');
    expect(snapshotInvocations()).toHaveLength(0);
    expect(screen.queryByRole('list', { name: 'Team members' })).not.toBeInTheDocument();

    // 折叠态点击行 = 进队（不是展开）：不顺手拉花名册
    fireEvent.click(within(row).getByText('refactor'));
    expect(onOpenTeamPanel).toHaveBeenCalledTimes(1);
    expect(snapshotInvocations()).toHaveLength(0);
  });

  it('队长未运行 / 没有队长行 ⇒ 折叠行不猜「为什么开不了」（交回面板）', () => {
    seedSessions(session({ sessionId: 'pty-stopped', state: 'stopped' }));
    const { onOpenTeamPanel, onOpenLead } = renderList([
      emptyTeam({ teamId: 'tm_1', name: 'stopped crew' }),
      emptyTeam({ teamId: 'tm_2', name: 'no lead row', leadMemberId: null }),
    ]);

    fireEvent.click(within(teamRow('stopped crew')).getByText('stopped crew'));
    fireEvent.click(within(teamRow('no lead row')).getByText('no lead row'));

    expect(onOpenTeamPanel).toHaveBeenCalledTimes(2);
    expect(onOpenLead).not.toHaveBeenCalled();
  });
});

describe('ProjectTeamList — 团队空间缺失（AC7b）', () => {
  it('团队记的工作树已不在 git worktree list 里 ⇒ 仍渲染并标注', () => {
    const { onOpenTeamPanel } = renderList([emptyTeam({ workspaceWorktree: TEAM_WT })], {
      worktreePaths: ['/repo/something-else'],
    });

    const row = teamRow('refactor');
    // 用图标而不是那句话（那句话在 260px 的行里要吃掉 100px 以上）；句子进可访问名。
    expect(within(row).getByTestId('team-workspace-missing')).toBeInTheDocument();
    expect(
      within(row).getByLabelText(
        'The worktree this team was started in is no longer in git worktree list',
      ),
    ).toBeInTheDocument();
    // 容器不依赖那棵树：行仍在，点击照样进面板（有活队长时仍能接管）
    fireEvent.click(within(row).getByText('refactor'));
    expect(onOpenTeamPanel).toHaveBeenCalledTimes(1);
  });

  it('工作树还在 ⇒ 不标注', () => {
    renderList([emptyTeam({ workspaceWorktree: TEAM_WT })], { worktreePaths: [TEAM_WT] });
    expect(
      within(teamRow('refactor')).queryByTestId('team-workspace-missing'),
    ).not.toBeInTheDocument();
  });

  it('主 checkout 的团队不因「不在 worktree 列表里」被标成缺失', () => {
    renderList([emptyTeam({ workspaceWorktree: null })], { worktreePaths: [] });
    expect(
      within(teamRow('refactor')).queryByTestId('team-workspace-missing'),
    ).not.toBeInTheDocument();
  });
});

describe('ProjectTeamList — 展开成员（AC3 / AC4）', () => {
  it('展开 ⇒ 恰好一次 `team_snapshot(teamId)`，列出全部成员（含没有会话的）', async () => {
    mockInvoke.mockResolvedValue(
      createTeamSnapshot({
        members: [
          createMemberStatus({ memberId: 'lead@tm_1', name: 'lead', role: 'lead' }),
          createMemberStatus({ memberId: 'w1@tm_1', name: 'w1' }),
          // 进程不在的成员照样在花名册里（六态是面板的事，侧栏只列人）
          createMemberStatus({
            memberId: 'w2@tm_1',
            name: 'w2',
            session: { live: false, terminalId: null },
          }),
        ],
        memberCount: 2,
      }),
    );
    const { onOpenTeamPanel } = renderList([emptyTeam()]);

    await expand(teamRow('refactor'));

    expect(snapshotInvocations()).toHaveLength(1);
    expect(snapshotInvocations()[0]).toEqual(['team_snapshot', { teamId: 'tm_1' }]);
    const members = within(screen.getByRole('list', { name: 'Team members' })).getAllByRole(
      'listitem',
    );
    expect(members).toHaveLength(3);
    expect(within(memberRow('w2')).getByText(/No session/)).toBeInTheDocument();
    // 展开**不是**打开团队（点击行才是）：不该顺手切面板
    expect(onOpenTeamPanel).not.toHaveBeenCalled();
  });

  it('折叠再展开不重复拉（结果按队缓存）', async () => {
    renderList([emptyTeam()]);

    await expand(teamRow('refactor'));
    await collapse(teamRow('refactor'));
    await expand(teamRow('refactor'));

    expect(snapshotInvocations()).toHaveLength(1);
    // 重挂载后成员仍在（缓存来自 store，不是组件 state）
    expect(screen.getByRole('list', { name: 'Team members' })).toBeInTheDocument();
  });

  it('队长排第一并带 `Lead` 标记，其余保持花名册顺序', async () => {
    mockInvoke.mockResolvedValue(
      createTeamSnapshot({
        members: [
          createMemberStatus({ memberId: 'worker-a@tm_1', name: 'worker-a' }),
          createMemberStatus({ memberId: 'boss@tm_1', name: 'boss', role: 'lead' }),
          createMemberStatus({ memberId: 'worker-b@tm_1', name: 'worker-b' }),
        ],
      }),
    );
    renderList([emptyTeam()]);

    await expand(teamRow('refactor'));

    const rows = within(screen.getByRole('list', { name: 'Team members' })).getAllByRole(
      'listitem',
    );
    expect(rows.map((row) => row.getAttribute('data-member-id'))).toEqual([
      'boss@tm_1',
      'worker-a@tm_1',
      'worker-b@tm_1',
    ]);
    expect(within(rows[0]).getByText('Lead')).toBeInTheDocument();
    // 队员不带标记（否则「谁是指挥」就退化成一枚人人有的徽标）
    expect(within(memberRow('worker-a')).queryByText('Lead')).not.toBeInTheDocument();
  });

  it('展开 A 队不改变 `teamStore.teamId`（面板没有被侧栏切走，AC4）', async () => {
    useTeamStore.setState({ teamId: 'tm_panel' });
    renderList([emptyTeam()]);

    await expand(teamRow('refactor'));

    expect(useTeamStore.getState().teamId).toBe('tm_panel');
  });

  it('脉冲打断在飞请求 ⇒ 丢弃陈旧响应后**自动重取**（界面不会停在脉冲前那一版）', async () => {
    const hold = deferred<TeamSnapshot>();
    mockInvoke.mockReturnValueOnce(hold.promise);
    mockInvoke.mockResolvedValue(
      createTeamSnapshot({ members: [createMemberStatus({ memberId: 'w1@tm_1', name: 'w1' })] }),
    );
    renderList([emptyTeam()]);

    // 第一次请求在飞（展开已发出，响应还没落地）
    fireEvent.click(expandButton(teamRow('refactor')));
    expect(snapshotInvocations()).toHaveLength(1);

    // 脉冲落在请求在飞期间：那份响应属于上一代，会被丢弃并重新标脏
    act(() => {
      useTeamRosterStore.getState().invalidateAll();
    });
    await act(async () => {
      hold.resolve(
        createTeamSnapshot({
          members: [createMemberStatus({ memberId: 'old@tm_1', name: 'old' })],
        }),
      );
    });

    // 标脏之后必须有东西再去拉它 —— 否则界面永远停在脉冲前那一版（只有折叠/展开才自愈）
    await waitFor(() => expect(snapshotInvocations()).toHaveLength(2));
    expect(memberRow('w1')).toBeInTheDocument();
    expect(screen.queryByText('old')).not.toBeInTheDocument();
  });

  it('花名册拉取失败 ⇒ 可见错误，不是空白', async () => {
    mockInvoke.mockRejectedValue(new Error('endpoint down'));
    renderList([emptyTeam()]);

    fireEvent.click(expandButton(teamRow('refactor')));

    expect(await screen.findByRole('alert')).toHaveTextContent('endpoint down');
  });

  it('成员行显示「成员名 · 会话标题」，同一队的两个成员会话跨单元也各自对得上', async () => {
    mockInvoke.mockResolvedValue(
      createTeamSnapshot({
        members: [
          createMemberStatus({ memberId: 'lead@tm_1', name: 'lead', role: 'lead' }),
          createMemberStatus({ memberId: 'w1@tm_1', name: 'w1' }),
        ],
      }),
    );
    seedSessions(
      // 队长在团队的树里，w1 在**另一棵**树里 —— 容器跨单元的全部意义
      session({ sessionId: 'pty-lead' }),
      session({
        sessionId: 'pty-w1',
        attribution: { kind: 'teamMember', teamId: 'tm_1', memberId: 'w1@tm_1' },
        workspaceKey: WorkspaceSession.of('p1', MEMBER_WT).key,
        title: '修登录竞态',
      }),
    );
    renderList([emptyTeam({ workspaceWorktree: TEAM_WT })]);

    await expand(teamRow('refactor'));

    expect(within(memberRow('lead')).getByText('把任务板接上')).toBeInTheDocument();
    expect(within(memberRow('w1')).getByText('修登录竞态')).toBeInTheDocument();
  });
});

describe('ProjectTeamList — 成员行分派（AC5）', () => {
  function seedRoster(): void {
    mockInvoke.mockResolvedValue(
      createTeamSnapshot({
        members: [
          createMemberStatus({ memberId: 'lead@tm_1', name: 'lead', role: 'lead' }),
          createMemberStatus({
            memberId: 'w1@tm_1',
            name: 'w1',
            session: { live: false, terminalId: null },
          }),
          createMemberStatus({
            memberId: 'w2@tm_1',
            name: 'w2',
            session: { live: false, terminalId: null },
          }),
        ],
      }),
    );
  }

  it('有活会话的成员行 ⇒ `onOpenMember(那条会话)`（不新建进程；单元由宿主按会话切）', async () => {
    seedRoster();
    const memberSession = session({
      sessionId: 'pty-w1',
      attribution: { kind: 'teamMember', teamId: 'tm_1', memberId: 'w1@tm_1' },
      workspaceKey: WorkspaceSession.of('p1', MEMBER_WT).key,
      title: '修登录竞态',
    });
    seedSessions(memberSession);
    const { onOpenMember } = renderList([emptyTeam()]);

    await expand(teamRow('refactor'));
    fireEvent.click(within(memberRow('w1')).getByText('w1'));

    expect(onOpenMember).toHaveBeenCalledTimes(1);
    expect(onOpenMember).toHaveBeenCalledWith(memberSession);
  });

  it('没有会话的成员 ⇒ 不可点，且理由**可见**（不是只进 title）', async () => {
    seedRoster();
    const { onOpenMember } = renderList([emptyTeam()]);

    await expand(teamRow('refactor'));
    const row = memberRow('w2');
    // 没有按钮 = 没有可点区（置灰的 button 仍可聚焦，用 div 表达「这条动作此刻不成立」）
    expect(within(row).queryByRole('button')).not.toBeInTheDocument();
    expect(within(row).getByText('No session yet')).toBeInTheDocument();
    expect(within(row).getByText('No session yet')).toBeVisible();
    fireEvent.click(within(row).getByText('w2'));
    expect(onOpenMember).not.toHaveBeenCalled();
  });
});

describe('ProjectTeamList — 行主体分派（R1）', () => {
  it('有活队长 ⇒ 点击调 `onOpenLead(团队, 那条会话)`，不打开面板', () => {
    const lead = session({ state: 'ready' });
    seedSessions(lead);
    const { onOpenLead, onOpenTeamPanel } = renderList([team()]);

    fireEvent.click(within(teamRow('refactor')).getByText('refactor'));

    expect(onOpenLead).toHaveBeenCalledTimes(1);
    expect(onOpenLead).toHaveBeenCalledWith(expect.objectContaining({ teamId: 'tm_1' }), lead);
    expect(onOpenTeamPanel).not.toHaveBeenCalled();
  });

  it('没有活队长 ⇒ 点击交回团队面板（侧栏不猜「为什么开不了」）', () => {
    seedSessions(session({ state: 'failed' }));
    const { onOpenLead, onOpenTeamPanel } = renderList([team()]);

    fireEvent.click(within(teamRow('refactor')).getByText('refactor'));

    expect(onOpenTeamPanel).toHaveBeenCalledWith(expect.objectContaining({ teamId: 'tm_1' }));
    expect(onOpenLead).not.toHaveBeenCalled();
  });

  it('前台是队长的会话 ⇒ 团队行标「当前」（与单元行同一个 aria-current 与填充）', () => {
    seedSessions(session());
    const workspace = WorkspaceSession.of('p1', TEAM_WT);
    const tab: Tab = {
      id: 'tab-lead',
      scope: { kind: 'workspace', session: workspace },
      title: 'lead',
      data: { kind: 'terminal', agentId: 'claude-code', ptySessionId: 'pty-lead' },
    };
    useEditorStore.getState().addTab(tab);
    useWorkspaceStore
      .getState()
      .setActiveWorkspace(workspace.projectId, workspace.worktreePath, 'dev');
    useProjectStore.setState({ activeProjectId: workspace.projectId });

    renderList([team({ workspaceWorktree: TEAM_WT })]);

    const row = teamRow('refactor');
    expect(mainButton(row)).toHaveAttribute('aria-current', 'true');
    expect(row).toHaveAttribute('data-current', 'true');
    expect(within(row).getByTestId('unit-row')).toHaveClass('bg-bg-selected');
  });

  /**
   * **点过这一行**也算「当前」，哪怕队长没在跑（那一刻没有任何会话成为前台）。
   *
   * 用户反馈：「选择团队选项时高亮状态也需要进行切换」。只认前台会话时，点一个队长不在跑的
   * 队 → 打开面板 → 侧栏一点变化都没有（原来亮着的 `local` 还亮着）。
   */
  it('`activeTeam` 是这一队 ⇒ 团队行标「当前」（队长不在跑也亮）', () => {
    renderList([team({ workspaceWorktree: TEAM_WT })]);
    act(() => {
      useWorkspaceStore.getState().selectTeam(PROJECT_ID, 'tm_1');
    });

    const row = teamRow('refactor');
    expect(mainButton(row)).toHaveAttribute('aria-current', 'true');
    expect(row).toHaveAttribute('data-current', 'true');
  });

  it('`activeTeam` 是**别的**队 ⇒ 本行不亮（选中是单数）', () => {
    renderList([
      team({ teamId: 'tm_1', name: 'refactor' }),
      team({ teamId: 'tm_2', name: 'other crew' }),
    ]);
    act(() => {
      useWorkspaceStore.getState().selectTeam(PROJECT_ID, 'tm_2');
    });

    expect(teamRow('refactor')).not.toHaveAttribute('data-current');
    expect(teamRow('other crew')).toHaveAttribute('data-current', 'true');
  });

  it('单元被激活 ⇒ 团队的选中作废（高亮交给单元行）', () => {
    renderList([team({ workspaceWorktree: TEAM_WT })]);
    act(() => {
      useWorkspaceStore.getState().selectTeam(PROJECT_ID, 'tm_1');
    });
    expect(teamRow('refactor')).toHaveAttribute('data-current', 'true');

    act(() => {
      // 用户去点了某个单元（点会话行 / 切工作树都是这条 mutator）
      useWorkspaceStore.getState().setActiveWorkspace(PROJECT_ID, null, 'main');
    });
    expect(teamRow('refactor')).not.toHaveAttribute('data-current');
  });
});

/**
 * 花名册缓存跨行共享：两个队同时展开时，各自的条目互不覆盖（按 `teamId` 键控）。
 *
 * 这里顺带钉住「展开只拉自己那个队」—— 两条团队行同时存在时不重拉别人。
 */
describe('ProjectTeamList — 多队', () => {
  it('两个队各自展开一次，各自只拉自己', async () => {
    mockInvoke.mockImplementation(async (_cmd, args) => {
      const teamId = (args as { teamId: string }).teamId;
      return createTeamSnapshot({
        members: [createMemberStatus({ memberId: `${teamId}-lead`, name: `${teamId} lead` })],
      });
    });
    renderList([
      emptyTeam({ teamId: 'tm_a', name: 'alpha' }),
      emptyTeam({ teamId: 'tm_b', name: 'beta' }),
    ]);

    await expand(teamRow('alpha'));
    await expand(teamRow('beta'));

    expect(snapshotInvocations().map(([, args]) => args)).toEqual([
      { teamId: 'tm_a' },
      { teamId: 'tm_b' },
    ]);
    expect(useTeamRosterStore.getState().rosters['tm_a']?.members[0].memberId).toBe('tm_a-lead');
    expect(useTeamRosterStore.getState().rosters['tm_b']?.members[0].memberId).toBe('tm_b-lead');
  });
});
