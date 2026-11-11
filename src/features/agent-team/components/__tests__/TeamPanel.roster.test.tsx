import { act, fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useProjectStore } from '@/shared/store/projectStore';
import {
  createMemberStatus,
  createProject,
  createTaskCard,
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
 * 1. **每个成员都能被看见地打开**：`terminalId != null` → 一行一个「打开会话」，
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
    terminalId: 'term-lead',
    // 无官方品牌图标的 CLI：头像走「首字母 + 派生色」回退路径（品牌图标的判据单独钉）。
    agentId: 'omp',
    leaseRemainingSecs: 1374,
  }),
  createMemberStatus({
    memberId: 'w1@tm_1',
    name: 'frontend',
    state: 'idle',
    verification: 'unverified',
    terminalId: 'term-w1',
    agentId: 'qoder',
    workspace: { worktree: { path: '/repo/worktrees/feat-auth-ui' } },
    leaseRemainingSecs: 0,
  }),
  createMemberStatus({
    memberId: 'w2@tm_1',
    name: 'backend',
    state: 'awaiting',
    terminalId: null,
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

  it('已退出但有原生会话 id：按钮可点，走历史记录（不是 PTY 接管）', () => {
    const { onOpenTerminal, onOpenHistory } = renderWithSnapshot(
      createTeamSnapshot({
        members: [
          createMemberStatus({
            memberId: 'gone@tm_1',
            name: 'gone',
            state: 'dead',
            terminalId: null, // 归档时清空（不给死进程一个死按钮）
            agentSessionId: 'native-gone', // 但会话记录还在磁盘上
            agentId: 'pi',
          }),
        ],
      }),
    );
    // 按钮文案区分「活进程」与「历史记录」：后者叫「查看记录」。
    fireEvent.click(within(rowOf('gone')).getByRole('button', { name: /查看记录/ }));

    // 分派到历史路径（agentId, nativeId, 名字, 团队 projectId），**不**碰 PTY 接管。
    // 第四个参数与「打开会话」同口径：历史会话 tab 也按团队自己的项目落键。
    expect(onOpenHistory).toHaveBeenCalledWith('pi', 'native-gone', 'gone', 'p1');
    expect(onOpenTerminal).not.toHaveBeenCalled();
  });

  it('terminalId 为 null：按钮置灰 + 可见理由「暂无会话」+ **零调用**', () => {
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
