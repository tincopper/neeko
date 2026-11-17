import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useProjectStore } from '@/shared/store/projectStore';
import {
  createMemberStatus,
  createProject,
  createTaskCard,
  createTeam,
  createTeamSnapshot,
} from '@/testing/factories';
import { invoke } from '@/testing/tauriCore';

import { __resetTeamGenerationForTests, useTeamStore } from '../../store/teamStore';
import TeamPanel from '../TeamPanel';

/**
 * 花名册的**信息与动作**（用户反馈：「只能看到队长的会话」+「设计很丑」）。
 *
 * 两条判据：
 *
 * 1. **每个成员都能被看见地打开**：`session.live` → 一行一个「打开会话」，
 *    回调参数精确等于**这一行**的 id 与名字；`null` → 置灰 + 可见理由 + **零调用**。
 * 2. **一眼能回答三件事**：这是谁（agentId / 档位）、它在哪干活（工作区）、它在等什么
 *    （六态 + 租约 / 未声明）。头像色按 `memberId` 派生，重排不漂移。
 */
const mockInvoke = vi.mocked(invoke);

const MEMBERS = [
  createMemberStatus({
    memberId: 'lead@tm_1',
    name: 'lead',
    role: 'lead',
    state: 'running',
    session: { live: true, terminalId: 'term-lead' },
    // 无官方品牌图标的 CLI：头像走「首字母 + 派生色」回退路径（品牌图标的判据单独钉）。
    agentId: 'omp',
    leaseRemainingSecs: 1374,
  }),
  createMemberStatus({
    memberId: 'w1@tm_1',
    name: 'frontend',
    state: 'idle',
    verification: 'unverified',
    session: { live: true, terminalId: 'term-w1' },
    agentId: 'qoder',
    workspace: { worktree: { path: '/repo/worktrees/feat-auth-ui' } },
    leaseRemainingSecs: 0,
  }),
  createMemberStatus({
    memberId: 'w2@tm_1',
    name: 'backend',
    state: 'awaiting',
    session: { live: false, terminalId: null },
    agentId: 'qoder',
    workspace: 'read_only',
    tier: 'c',
    leaseRemainingSecs: null,
  }),
];

function resetStores(): void {
  __resetTeamGenerationForTests();
  useTeamStore.setState({
    teamId: null,
    snapshot: null,
    detail: null,
    loading: false,
    error: null,
    lastRev: 0,
  });
  useProjectStore.setState({
    activeProjectId: null,
    activeProject: createProject({ path: '/repo/main' }),
  });
}

function renderWithSnapshot(snapshot = createTeamSnapshot({ members: MEMBERS })) {
  useTeamStore.setState({ teamId: 'tm_1', snapshot });
  mockInvoke.mockResolvedValue(snapshot);
  const onOpenTerminal = vi.fn();
  const onOpenHistory = vi.fn();
  const view = render(<TeamPanel onOpenTerminal={onOpenTerminal} onOpenHistory={onOpenHistory} />);
  return { ...view, onOpenTerminal, onOpenHistory };
}

function roster(): HTMLElement {
  return screen.getByRole('region', { name: '成员花名册' });
}

/**
 * 花名册一行。
 *
 * 用**可访问名**定位（`role=group` + `aria-label="成员 <名字>"`），不抓 DOM 结构：
 * 读屏用户听到的与测试要找的是同一个东西，布局改版也不会让断言失效。
 */
function rowOf(name: string): HTMLElement {
  return within(screen.getByRole('region', { name: '成员花名册' })).getByRole('group', {
    name: `成员 ${name}`,
  });
}

describe('花名册 — 打开成员终端', () => {
  beforeEach(() => {
    resetStores();
    mockInvoke.mockReset();
  });

  it('点行内按钮 → 回调拿到**这一行**的 terminalId 与名字（标题用成员名）', () => {
    const { onOpenTerminal } = renderWithSnapshot();

    fireEvent.click(within(rowOf('frontend')).getByRole('button', { name: '打开会话：frontend' }));

    expect(onOpenTerminal).toHaveBeenCalledTimes(1);
    // 第三个参数是**这个团队的** projectId（`snapshot.team.projectId`）：宿主据此落终端
    // tab，用激活项目顶替会在切换项目后把 tab 登记到另一棵树下面（F3）。
    expect(onOpenTerminal).toHaveBeenCalledWith('term-w1', 'frontend', 'qoder', 'p1');
  });

  it('队长行同样能开（role: lead 不特殊对待 —— 它的进程也在自己的 PTY 里）', () => {
    const { onOpenTerminal } = renderWithSnapshot();

    fireEvent.click(within(rowOf('lead')).getByRole('button', { name: '打开会话：lead' }));

    expect(onOpenTerminal).toHaveBeenCalledWith('term-lead', 'lead', 'omp', 'p1');
  });

  it('两个成员各开各的（参数不许串行 / 不许落到别人身上）', () => {
    const { onOpenTerminal } = renderWithSnapshot();

    fireEvent.click(within(rowOf('frontend')).getByRole('button', { name: '打开会话：frontend' }));
    fireEvent.click(within(rowOf('lead')).getByRole('button', { name: '打开会话：lead' }));

    expect(onOpenTerminal.mock.calls).toEqual([
      ['term-w1', 'frontend', 'qoder', 'p1'],
      ['term-lead', 'lead', 'omp', 'p1'],
    ]);
  });

  it('已退出、有原生 id、但该 CLI 不能续接：按钮是「查看记录」（真实能力差异，不是错误）', () => {
    const { onOpenTerminal, onOpenHistory } = renderWithSnapshot(
      createTeamSnapshot({
        members: [
          createMemberStatus({
            memberId: 'gone@tm_1',
            name: 'gone',
            state: 'offline',
            session: { live: false, terminalId: null }, // 归档时不再有活会话
            agentSessionId: 'native-gone', // 会话记录还在磁盘上
            // qoder 有原生 id，但它的续接只在 `--print` 下有效 ⇒ 后端判不可恢复。
            // 这不是错误，所以**不**置灰：记录照看。
            resumable: false,
            agentId: 'qoder',
          }),
        ],
      }),
    );
    // 按钮文案区分「能接回来」与「只能看」：后者叫「查看记录」。
    fireEvent.click(within(rowOf('gone')).getByRole('button', { name: /查看记录/ }));

    // 分派到历史路径（agentId, nativeId, 名字, 团队 projectId），**不**碰 PTY 接管。
    // 第四个参数与「打开会话」同口径：历史会话 tab 也按团队自己的项目落键。
    expect(onOpenHistory).toHaveBeenCalledWith('qoder', 'native-gone', 'gone', 'p1');
    expect(onOpenTerminal).not.toHaveBeenCalled();
    // 不可恢复的成员**不许**被当成可恢复的（那会让 UI 宣传一个后端会拒绝的动作）
    expect(mockInvoke).not.toHaveBeenCalledWith('team_resume', expect.anything());
  });

  it('没有活会话：按钮置灰 + 可见理由「暂无会话」+ **零调用**', () => {
    const { onOpenTerminal } = renderWithSnapshot();
    const button = within(rowOf('backend')).getByRole('button', { name: '打开会话：backend' });

    expect(button).toBeDisabled();
    // 理由必须是**可见文字**，不能只进 title（disabled 元素不可聚焦，等于没有理由）
    expect(within(rowOf('backend')).getByText('暂无会话')).toBeInTheDocument();

    fireEvent.click(button);
    expect(onOpenTerminal).not.toHaveBeenCalled();
  });
});

describe('花名册 — 信息密度（谁 / 在哪 / 在等什么）', () => {
  beforeEach(() => {
    resetStores();
    mockInvoke.mockReset();
  });

  it('每行都有 身份 / 通道 / 工作区 / 档位 四枚 chip', () => {
    renderWithSnapshot();
    const row = within(rowOf('frontend'));

    expect(row.getByText('qoder')).toBeInTheDocument();
    expect(row.getByText('CLI · PTY')).toBeInTheDocument();
    // worktree 只显示末段路径
    expect(row.getByText('worktree feat-auth-ui')).toBeInTheDocument();
    expect(row.getByText('A 档')).toBeInTheDocument();
  });

  it('C 档带上可见的「sentinel only」警告，且面板把这句为什么说清楚', () => {
    renderWithSnapshot();
    const row = within(rowOf('backend'));

    expect(row.getByText('C 档 · sentinel only')).toBeInTheDocument();
    expect(row.getByText('只读')).toBeInTheDocument();
    // 红线 14：C 档「卡住永远不可知」必须在面板上说一次，而不是只留在 chip 的 title 里
    expect(within(roster()).getByRole('note')).toHaveTextContent('卡住永远不可知');
  });

  it('六态与租约三态都还在（新布局不许把判据挤掉）', () => {
    renderWithSnapshot();

    expect(within(rowOf('lead')).getByText('运行中')).toBeInTheDocument();
    expect(within(rowOf('lead')).getByText('租约剩 22:54')).toBeInTheDocument();
    expect(within(rowOf('frontend')).getByText('空闲 ⚠ 未声明')).toBeInTheDocument();
    expect(within(rowOf('frontend')).getByText('租约已超时')).toBeInTheDocument();
    expect(within(rowOf('backend')).getByText('待批准')).toBeInTheDocument();
    expect(within(rowOf('backend')).getByText('无在飞任务')).toBeInTheDocument();
  });

  it('头像色按 memberId 派生：重排后同一个人还是同一个颜色', () => {
    renderWithSnapshot();

    // 头像 = 首字母 + 派生色；两个都读，才证明「颜色跟着人走」而不是「颜色跟着位置走」
    const tintOf = (member: (typeof MEMBERS)[number]): string => {
      const avatar = within(rowOf(member.name)).getByText(member.name[0].toUpperCase());
      return avatar.getAttribute('data-tint') ?? '';
    };

    const before = new Map(MEMBERS.map((member) => [member.memberId, tintOf(member)]));
    // 三个色必须真的不一样，否则「保持不变」可能只是「全都很像」
    expect(new Set(before.values()).size).toBeGreaterThan(1);

    // 后端换了顺序（增删成员后按 id 重排就是这种效果）
    const reordered = [MEMBERS[2], MEMBERS[0], MEMBERS[1]];
    act(() => {
      useTeamStore.setState({ snapshot: createTeamSnapshot({ members: reordered }) });
    });

    for (const member of reordered) {
      expect(tintOf(member)).toBe(before.get(member.memberId));
    }
  });

  it('成员头像显示对应 agent 的品牌图标（claude-code → Claude 官方路径）；无品牌的回退首字母', () => {
    renderWithSnapshot(
      createTeamSnapshot({
        members: [
          createMemberStatus({
            memberId: 'b1@tm_1',
            name: 'brand',
            agentId: 'claude-code',
            state: 'running',
          }),
          createMemberStatus({
            memberId: 'b2@tm_1',
            name: 'plain',
            agentId: 'omp',
            state: 'idle',
          }),
        ],
      }),
    );

    // 品牌路径：图标带可访问名（读屏听到「哪个 agent」），不再是首字母文本
    const brandRow = rowOf('brand');
    expect(within(brandRow).getByRole('img', { name: 'claude-code' })).toBeInTheDocument();
    expect(within(brandRow).queryByText('B')).not.toBeInTheDocument();
    // 无品牌的 CLI 走「首字母 + 派生色」回退（没有 img 角色）
    const plainRow = rowOf('plain');
    expect(within(plainRow).queryByRole('img', { name: 'omp' })).not.toBeInTheDocument();
    // 回退字形来自**名字**首字母（memberInitial），不是 agentId
    expect(within(plainRow).getByText('P')).toBeInTheDocument();
  });
});

describe('面板头 — 人数与待批', () => {
  beforeEach(() => {
    resetStores();
    mockInvoke.mockReset();
  });

  it('显示成员数与排队等人动手的任务数', () => {
    renderWithSnapshot(
      createTeamSnapshot({
        // 后端口径的成员数（`members` 含队长，所以这个数不等于花名册行数）。
        memberCount: 2,
        members: MEMBERS,
        tasks: [
          createTaskCard({ id: 't1', state: 'awaiting_approval' }),
          createTaskCard({ id: 't2', state: 'awaiting_approval' }),
          createTaskCard({ id: 't3', state: 'in_progress' }),
        ],
      }),
    );

    // **后端口径**（不含队长）：MEMBERS = 队长 + 2 个 worker ⇒ 2 成员。
    // 修之前这里是 `members.length`（含队长 ⇒ 3），于是同一个队在列表行上「成员 2」、
    // 点进面板「3 成员」—— 两个都看起来对。
    expect(screen.getByText('2 成员')).toBeInTheDocument();
    expect(screen.getByText('2 待批')).toBeInTheDocument();
  });

  it('没有待批时不显示「0 待批」（永远亮着的提示等于没有提示）', () => {
    renderWithSnapshot(
      createTeamSnapshot({ members: MEMBERS, tasks: [createTaskCard({ id: 't1' })] }),
    );

    // 只认头部的那个 pill（不是花名册的「待批准」徽标，也不是任务板的「待批准」列）
    expect(screen.queryByText(/^\d+ 待批$/)).not.toBeInTheDocument();
  });
});

describe('任务板 — 列计数与持有者状态', () => {
  beforeEach(() => {
    resetStores();
    mockInvoke.mockReset();
  });

  const tasks = [
    createTaskCard({ id: 't1', title: '没人认领', state: 'pending' }),
    createTaskCard({
      id: 't2',
      title: '前端在做',
      state: 'in_progress',
      owner: 'w1@tm_1',
      claimedAt: 1_700_000_000_000,
    }),
    createTaskCard({ id: 't3', title: '后端在做', state: 'in_progress', owner: 'w2@tm_1' }),
    createTaskCard({ id: 't4', title: '做完了', state: 'done' }),
    createTaskCard({ id: 't5', title: '也做完了', state: 'done' }),
    createTaskCard({ id: 't6', title: '阻塞了', state: 'blocked' }),
  ];

  /** 某一列上显示的计数（`data-count` 是机器钩子，文案会变）。 */
  const countOf = (label: string): number => {
    const column = within(screen.getByRole('region', { name: '共享任务板' })).getByRole('group', {
      name: label,
    });
    return Number(within(column).getByText(/^\d+$/, { selector: '[data-count]' }).textContent);
  };

  it('每列计数等于这一列的**行数**（不是常量，也不是全板总数）', () => {
    renderWithSnapshot(createTeamSnapshot({ members: MEMBERS, tasks }));

    expect(countOf('待认领')).toBe(1);
    expect(countOf('进行中')).toBe(2);
    expect(countOf('待批准')).toBe(0);
    expect(countOf('已完成')).toBe(2);
    expect(countOf('阻塞')).toBe(1);
  });

  it('「成员已空闲但没人认可完成」在卡片上看得出来（任务仍留在进行中列）', () => {
    renderWithSnapshot(createTeamSnapshot({ members: MEMBERS, tasks }));

    const inProgress = within(screen.getByRole('region', { name: '共享任务板' })).getByRole(
      'group',
      { name: '进行中' },
    );
    // w1 是 idle + unverified：卡片上要显示这句，而不是「它空闲了所以应该做完了」
    expect(within(inProgress).getByText('空闲 ⚠ 未声明')).toBeInTheDocument();
    // 持有者名字是 chip，不是 member id
    expect(within(inProgress).getByText('frontend')).toBeInTheDocument();
  });
});

/**
 * 第三态「恢复会话」—— 用户报障的核心（app 重启 / 进程退出后团队回不来）。
 *
 * 三条判据：
 *
 * 1. **可恢复的离线成员拿到「恢复会话」**：点击走 `team_resume`（成员级），**不**新开一个
 *    裸终端、也**不**跳到只读历史 —— 那两者都会让用户以为对话续上了。
 * 2. **封存的成员只给「查看记录」**：封存是用户的决定，恢复到进程等于撤销它（后端也拒绝）。
 * 3. **头部的「恢复团队」只在成立时出现**（`open` + 有可恢复成员），点击是**整队**恢复
 *    （`memberId: null`）—— 与成员级是同一个命令的两个范围。
 */
describe('花名册 — 恢复会话（第三态）', () => {
  beforeEach(() => {
    resetStores();
    mockInvoke.mockReset();
  });

  /** 一个离线、有原生 id、可恢复的成员（后端 `resumable` 派生的典型现场）。 */
  const RESUMABLE = createMemberStatus({
    memberId: 'w1@tm_1',
    name: 'backend',
    state: 'offline',
    session: { live: false, terminalId: null },
    agentSessionId: 'native-w1',
    resumable: true,
  });

  const EMPTY_REPORT = {
    teamId: 'tm_1',
    resumed: ['w1@tm_1'],
    skippedAlreadyLive: [],
    cold: [],
    failed: [],
  };

  it('离线 + 可恢复：按钮是「恢复会话」，点击 ⇒ team_resume(teamId, memberId)', async () => {
    const snapshot = createTeamSnapshot({ members: [RESUMABLE] });
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === 'team_resume') return EMPTY_REPORT;
      return snapshot;
    });

    useTeamStore.setState({ teamId: 'tm_1', snapshot });
    const onOpenTerminal = vi.fn();
    const onOpenHistory = vi.fn();
    const onShowToast = vi.fn();
    render(
      <TeamPanel
        onShowToast={onShowToast}
        onOpenTerminal={onOpenTerminal}
        onOpenHistory={onOpenHistory}
      />,
    );

    fireEvent.click(within(rowOf('backend')).getByRole('button', { name: '恢复会话：backend' }));

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('team_resume', {
        teamId: 'tm_1',
        memberId: 'w1@tm_1',
      }),
    );
    // 恢复**不**接管一个不存在的 PTY，也**不**降级成只读历史（这里重取的快照仍没有进程：
    // 后端还没在成员行上写 terminalId ⇒ 没有可接管的东西）。
    expect(onOpenTerminal).not.toHaveBeenCalled();
    expect(onOpenHistory).not.toHaveBeenCalled();
    // 结果必须被说出来（四个桶的一句话；这里是「恢复了 1 个」）。
    await waitFor(() => expect(onShowToast).toHaveBeenCalledWith('恢复 1 个成员', 'info'));
  });

  /**
   * 「恢复会话就是打开会话」—— 用户报障：点了恢复，进程起来了，按钮变成「打开会话」，
   * 但屏幕上什么都没变（还得再点一次）。
   *
   * 判据：一次点击落到**那个成员自己的**新 PTY 上（句柄来自重取后的快照，不是旧的那一个）。
   * 恢复只对**成员级**这一个动作成立；整队恢复不这么做（见下一个 describe —— 一次弹 N 个
   * tab 会盖住用户正在看的东西）。
   */
  it('成员级恢复成功 ⇒ 刷新后自动接管它**新起**的那个 PTY（不用再点一次）', async () => {
    const liveAfter = createMemberStatus({
      memberId: 'w1@tm_1',
      name: 'backend',
      state: 'idle',
      session: { live: true, terminalId: 'term-w1-new' },
      agentId: 'qoder',
      agentSessionId: 'native-w1',
      resumable: true,
    });
    const before = createTeamSnapshot({ members: [RESUMABLE] });
    const after = createTeamSnapshot({ members: [liveAfter] });
    // 首拉给离线快照（按钮就是「恢复会话」），恢复后的那次重取才给活进程。
    let snapshotPulls = 0;
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === 'team_resume') return EMPTY_REPORT;
      snapshotPulls += 1;
      return snapshotPulls === 1 ? before : after;
    });

    useTeamStore.setState({ teamId: 'tm_1', snapshot: before });
    const onOpenTerminal = vi.fn();
    render(<TeamPanel onOpenTerminal={onOpenTerminal} />);

    fireEvent.click(within(rowOf('backend')).getByRole('button', { name: '恢复会话：backend' }));

    // 句柄是**新铸的**（`term-w1-new`）：拿旧 id 去接管会得到用户报的「会话 id 找不到」。
    await waitFor(() =>
      expect(onOpenTerminal).toHaveBeenCalledWith('term-w1-new', 'backend', 'qoder', 'p1'),
    );
    expect(onOpenTerminal).toHaveBeenCalledTimes(1);
  });

  /**
   * 面板头也能改名（同一个 `team_rename`，同一份提交判据）。
   *
   * 列表行与头部是**两条入口、一条动作**：在队里发现名字起错了，不该先「返回列表」再改。
   */
  it('头部「改名」→ 行内编辑 → Enter ⇒ team_rename(当前 teamId, 新名)', async () => {
    const snapshot = createTeamSnapshot({ members: [RESUMABLE] });
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === 'team_rename') return undefined;
      return snapshot;
    });
    useTeamStore.setState({ teamId: 'tm_1', snapshot });

    render(<TeamPanel onShowToast={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: '重命名团队 refactor' }));

    // 编辑态：输入框预填当前名字
    const input = screen.getByRole('textbox');
    expect(input).toHaveValue('refactor');
    fireEvent.change(input, { target: { value: '  新队名  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('team_rename', {
        teamId: 'tm_1',
        name: '新队名',
      }),
    );
  });

  it('封存 + 有原生 id：只有「查看记录」，没有「恢复会话」（意图不许被撤销）', () => {
    const snapshot = createTeamSnapshot({
      members: [
        createMemberStatus({
          memberId: 'w1@tm_1',
          name: 'backend',
          state: 'offline',
          session: { live: false, terminalId: null },
          agentSessionId: 'native-w1',
          resumable: true,
          sealed: true,
        }),
      ],
    });
    mockInvoke.mockResolvedValue(snapshot);
    useTeamStore.setState({ teamId: 'tm_1', snapshot });

    const onOpenHistory = vi.fn();
    render(<TeamPanel onOpenHistory={onOpenHistory} />);

    // 一条都不给 `恢复会话`（两个入口都不许出现）
    expect(
      within(rowOf('backend')).queryByRole('button', { name: /恢复会话/ }),
    ).not.toBeInTheDocument();

    fireEvent.click(within(rowOf('backend')).getByRole('button', { name: /查看记录/ }));
    expect(onOpenHistory).toHaveBeenCalledWith('pi', 'native-w1', 'backend', 'p1');
    expect(mockInvoke).not.toHaveBeenCalledWith('team_resume', expect.anything());
  });
});

describe('面板头 — 恢复团队', () => {
  beforeEach(() => {
    resetStores();
    mockInvoke.mockReset();
  });

  const resumableMember = createMemberStatus({
    memberId: 'w1@tm_1',
    name: 'backend',
    state: 'offline',
    session: { live: false, terminalId: null },
    agentSessionId: 'native-w1',
    resumable: true,
  });

  it('open + 有可恢复的离线成员 ⇒ 出现「恢复团队」；点击是**整队**恢复（memberId: null）', async () => {
    const snapshot = createTeamSnapshot({ members: [resumableMember] });
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === 'team_resume') {
        return {
          teamId: 'tm_1',
          resumed: ['w1@tm_1'],
          skippedAlreadyLive: [],
          cold: [],
          failed: [],
        };
      }
      return snapshot;
    });
    useTeamStore.setState({ teamId: 'tm_1', snapshot });

    render(<TeamPanel />);

    // 可访问名点名团队：同一个屏幕上的「恢复会话」是成员级的，两者不能混淆。
    fireEvent.click(screen.getByRole('button', { name: '恢复团队 refactor' }));

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('team_resume', {
        teamId: 'tm_1',
        memberId: null,
      }),
    );
  });

  /**
   * 整队恢复**不**自动接管任何终端 —— 与成员级刻意不同。
   *
   * 一个 4 人队会同时起 4 个进程；再自动开 4 个 tab，用户面前那一屏就被换掉了（他刚才在看
   * 什么已经不重要了）。整队恢复只回答「几个回来了」，具体开哪个由用户自己按 「打开会话」
   * —— 那时那些行已经是可点的。
   */
  it('整队恢复即使成员都回来了也不弹 tab（开哪个由用户自己按）', async () => {
    const liveAfter = createMemberStatus({
      memberId: 'w1@tm_1',
      name: 'backend',
      session: { live: true, terminalId: 'term-w1-new' },
      agentSessionId: 'native-w1',
      resumable: true,
    });
    const before = createTeamSnapshot({ members: [resumableMember] });
    const after = createTeamSnapshot({ members: [liveAfter] });
    let snapshotPulls = 0;
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === 'team_resume') {
        return {
          teamId: 'tm_1',
          resumed: ['w1@tm_1'],
          skippedAlreadyLive: [],
          cold: [],
          failed: [],
        };
      }
      snapshotPulls += 1;
      return snapshotPulls === 1 ? before : after;
    });
    useTeamStore.setState({ teamId: 'tm_1', snapshot: before });

    const onOpenTerminal = vi.fn();
    render(<TeamPanel onOpenTerminal={onOpenTerminal} />);

    fireEvent.click(screen.getByRole('button', { name: '恢复团队 refactor' }));

    // 等这次恢复整个落地（花名册已按新快照重画成可点），再断言一个 tab 都没开。
    await waitFor(() =>
      expect(
        within(rowOf('backend')).getByRole('button', { name: '打开会话：backend' }),
      ).toBeInTheDocument(),
    );
    expect(onOpenTerminal).not.toHaveBeenCalled();
  });

  it('封存的团队没有这个入口（只读快照，恢复会撤销用户的决定）', () => {
    const snapshot = createTeamSnapshot({
      team: createTeam({ state: 'sealed', sealedAt: 1_700_000_000_000 }),
      members: [resumableMember],
    });
    mockInvoke.mockResolvedValue(snapshot);
    useTeamStore.setState({ teamId: 'tm_1', snapshot });

    render(<TeamPanel />);

    expect(screen.queryByRole('button', { name: /恢复团队/ })).not.toBeInTheDocument();
  });

  it('没有可恢复的成员（全在跑）⇒ 不渲染一个「恢复 0 个成员」的按钮', () => {
    const snapshot = createTeamSnapshot({
      members: [
        createMemberStatus({
          memberId: 'w1@tm_1',
          name: 'backend',
          session: { live: true, terminalId: 'term-w1' },
        }),
      ],
    });
    mockInvoke.mockResolvedValue(snapshot);
    useTeamStore.setState({ teamId: 'tm_1', snapshot });

    render(<TeamPanel />);

    expect(screen.queryByRole('button', { name: /恢复团队/ })).not.toBeInTheDocument();
  });
});

describe('恢复失败 — 后端原文必须看得见', () => {
  beforeEach(() => {
    resetStores();
    mockInvoke.mockReset();
  });

  it('team_resume 拒绝（sealed）⇒ 原文渲染 + 重取快照（事实可能已经变了）', async () => {
    const snapshot = createTeamSnapshot({
      members: [
        createMemberStatus({
          memberId: 'w1@tm_1',
          name: 'backend',
          state: 'offline',
          session: { live: false, terminalId: null },
          agentSessionId: 'native-w1',
          resumable: true,
        }),
      ],
    });
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === 'team_resume') {
        throw 'Conflict: team `tm_1` is sealed; a sealed team cannot be resumed';
      }
      return snapshot;
    });
    useTeamStore.setState({ teamId: 'tm_1', snapshot });

    const onShowToast = vi.fn();
    render(<TeamPanel onShowToast={onShowToast} />);

    const before = mockInvoke.mock.calls.filter(([cmd]) => cmd === 'team_snapshot').length;

    fireEvent.click(within(rowOf('backend')).getByRole('button', { name: '恢复会话：backend' }));

    // 原文照抄（不是一句「操作失败」）：它说的是「封存了，去建新队」。
    expect(
      await screen.findByText(/is sealed; a sealed team cannot be resumed/),
    ).toBeInTheDocument();
    expect(onShowToast).toHaveBeenCalledWith(
      'Conflict: team `tm_1` is sealed; a sealed team cannot be resumed',
      'error',
    );

    // onSettled ⇒ 快照重取（失败也可能已经改了别的成员；按钮的可用性只能由快照回答）。
    await waitFor(() =>
      expect(
        mockInvoke.mock.calls.filter(([cmd]) => cmd === 'team_snapshot').length,
      ).toBeGreaterThan(before),
    );
  });
});
