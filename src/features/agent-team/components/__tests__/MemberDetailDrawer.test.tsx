import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useProjectStore } from '@/shared/store/projectStore';
import {
  createMemberDetail,
  createMemberEvent,
  createMemberStatus,
  createProject,
  createTaskCard,
  createTeamList,
  createTeamSnapshot,
} from '@/testing/factories';
import { invoke } from '@/testing/tauriCore';

import { __resetTeamListStoreForTests } from '../../store/teamListStore';
import { __resetTeamGenerationForTests, useTeamStore } from '../../store/teamStore';
import { LEASE_TICK_MS } from '../MemberDetailDrawer';
import TeamPanel from '../TeamPanel';

/**
 * 成员详情抽屉 —— 用户反馈「点开一个成员什么都没有」的落点，同时是 AC5 待批队列的家。
 *
 * 六条判据：
 *
 * 1. 点行 → `team_member_detail` **带该成员 id**（不是列表里第一个，也不是别的谁）；
 * 2. 关闭抽屉 → 不再请求（抽屉关掉就没有读路径，这是红线 4 的时间维度）；
 * 3. 待批块：**有 `awaitingApproval` 才出现**，且文案明确「不代批」；
 * 4. `eventsTruncated` 正反例（永远亮着的提示等于没有提示）；
 * 5. **租约走动**：假时钟推进 1s → 文案变化（不开真实 sleep）；
 * 6. 请求失败 → 错误**可见**且**不清**已有数据。
 */

const mockInvoke = vi.mocked(invoke);

const MEMBERS = [
  createMemberStatus({
    memberId: 'lead@tm_1',
    name: 'lead',
    role: 'lead',
    state: 'running',
    session: { live: true, terminalId: 'term-lead' },
    agentId: 'claude-code',
  }),
  createMemberStatus({
    memberId: 'w1@tm_1',
    name: 'frontend',
    state: 'awaiting',
    session: { live: true, terminalId: 'term-w1' },
    agentId: 'qoder',
  }),
];

function resetStores(): void {
  __resetTeamGenerationForTests();
  __resetTeamListStoreForTests();
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

function countCalls(cmd: string): number {
  return mockInvoke.mock.calls.filter(([name]) => name === cmd).length;
}

/**
 * 渲染一个已经打开 `tm_1` 的面板，并让 `team_member_detail` 走给定实现。
 *
 * 其余命令一律回快照：本文件只关心成员的读路径，别的载荷只要不炸就行。
 */
function renderPanel(
  detail: () => Promise<unknown>,
  onOpenTerminal: (id: string, title: string) => void = vi.fn(),
) {
  const snapshot = createTeamSnapshot({ members: MEMBERS });
  useTeamStore.setState({ teamId: 'tm_1', snapshot });
  mockInvoke.mockImplementation(async (cmd) => {
    if (cmd === 'team_member_detail') return detail();
    if (cmd === 'team_list') return createTeamList({ teams: [] });
    return snapshot;
  });
  return render(<TeamPanel onOpenTerminal={onOpenTerminal} />);
}

/** 花名册一行里那块「点行看详情」的按钮（可访问名是稳定钩子，不抓 DOM 结构）。 */
function openDetailButton(name: string): HTMLElement {
  return within(screen.getByRole('region', { name: 'Member roster' })).getByRole('button', {
    name: `View member ${name} details`,
  });
}

/** 抽屉本体（`role="dialog"` + `aria-modal` ⇒ 一层对话框，见 `useDrawerFocus`）。 */
function drawer(): HTMLElement {
  return screen.getByRole('dialog', { name: 'Member details: frontend' });
}

describe('成员详情抽屉 — 打开与关闭', () => {
  beforeEach(() => {
    resetStores();
    mockInvoke.mockReset();
  });

  it('点行 → team_member_detail 带**这一行**的 id（不是别的成员）', async () => {
    renderPanel(async () => createMemberDetail());

    fireEvent.click(openDetailButton('frontend'));

    await waitFor(() => expect(countCalls('team_member_detail')).toBe(1));
    const call = mockInvoke.mock.calls.find(([name]) => name === 'team_member_detail');
    expect(call?.[1]).toEqual({ memberId: 'w1@tm_1' });
    expect(await screen.findByRole('dialog', { name: 'Member details: frontend' })).toBeVisible();
  });

  it('抽屉头部的「打开会话」递的是成员自己的 terminalId，且点行**不**开终端', async () => {
    const onOpenTerminal = vi.fn();
    renderPanel(async () => createMemberDetail(), onOpenTerminal);

    fireEvent.click(openDetailButton('frontend'));
    await screen.findByRole('dialog', { name: 'Member details: frontend' });
    // 两个动作不合并：点行只看详情
    expect(onOpenTerminal).not.toHaveBeenCalled();

    fireEvent.click(within(drawer()).getByRole('button', { name: 'Open session: frontend' }));
    expect(onOpenTerminal).toHaveBeenCalledWith('term-w1', 'frontend', 'pi', 'p1');
  });

  it('成员没有进程时抽屉里的按钮置灰，理由以**可见文字**给出且零调用', async () => {
    const onOpenTerminal = vi.fn();
    renderPanel(
      async () =>
        createMemberDetail({
          member: createMemberStatus({
            memberId: 'w1@tm_1',
            name: 'frontend',
            session: { live: false, terminalId: null },
          }),
        }),
      onOpenTerminal,
    );

    fireEvent.click(openDetailButton('frontend'));
    await screen.findByRole('dialog', { name: 'Member details: frontend' });

    const button = within(drawer()).getByRole('button', { name: 'Open session: frontend' });
    expect(button).toBeDisabled();
    // `disabled` 元素不可聚焦 ⇒ 理由不能只进 title
    expect(within(drawer()).getByText('No session yet')).toBeInTheDocument();
    fireEvent.click(button);
    expect(onOpenTerminal).not.toHaveBeenCalled();
  });

  it('关闭抽屉后不再请求（关掉就没有读路径）', async () => {
    renderPanel(async () => createMemberDetail());
    fireEvent.click(openDetailButton('frontend'));
    await waitFor(() => expect(countCalls('team_member_detail')).toBe(1));

    fireEvent.click(within(drawer()).getByRole('button', { name: 'Close member details' }));

    expect(
      screen.queryByRole('dialog', { name: 'Member details: frontend' }),
    ).not.toBeInTheDocument();
    // 让在飞/排队中的微任务都落地，再确认没有任何新的读请求
    await act(async () => {
      await Promise.resolve();
    });
    expect(countCalls('team_member_detail')).toBe(1);
  });
});

describe('成员详情抽屉 — AC5 待批队列', () => {
  beforeEach(() => {
    resetStores();
    mockInvoke.mockReset();
  });

  it('有 awaitingApproval 才出现，并写明「Neeko 不代批」', async () => {
    renderPanel(async () =>
      createMemberDetail({
        awaitingApproval: [
          createTaskCard({
            id: 't9',
            title: '跑一次迁移',
            state: 'awaiting_approval',
            owner: 'w1@tm_1',
          }),
        ],
      }),
    );

    fireEvent.click(openDetailButton('frontend'));

    const queue = await screen.findByRole('region', { name: 'Approval queue' });
    expect(within(queue).getByText('跑一次迁移')).toBeInTheDocument();
    // 这句话是本块的全部价值：不写它，用户会在面板上找一个不存在的「批准」按钮
    expect(within(queue).getByText(/does not approve on your behalf/)).toBeInTheDocument();
    expect(
      within(queue).getByRole('button', {
        name: /Handle the task awaiting approval in the terminal/,
      }),
    ).toBeInTheDocument();
  });

  it('awaitingApproval 为空时整块不渲染（永远亮着的提示等于没有提示）', async () => {
    renderPanel(async () => createMemberDetail({ awaitingApproval: [] }));

    fireEvent.click(openDetailButton('frontend'));
    await screen.findByRole('dialog', { name: 'Member details: frontend' });

    expect(screen.queryByRole('region', { name: 'Approval queue' })).not.toBeInTheDocument();
  });
});

describe('成员详情抽屉 — 事件与截断', () => {
  beforeEach(() => {
    resetStores();
    mockInvoke.mockReset();
  });

  it('事件显示时间 + 类别文案 + 一行摘要；长 detail 截断且全文进 title', async () => {
    const long = `${'很长的上下文'.repeat(20)}`;
    renderPanel(async () =>
      createMemberDetail({
        events: [createMemberEvent({ kind: 'close_member', detail: long })],
      }),
    );

    fireEvent.click(openDetailButton('frontend'));
    const list = await screen.findByRole('region', { name: 'Member recent events' });

    expect(within(list).getByText('Member archived')).toBeInTheDocument();
    const summary = within(list).getByText(/很长的上下文/);
    // 视觉文案被截断，但全文必须在 title / aria-label 上（砍信息 ≠ 收信息）
    expect(summary.textContent?.endsWith('…')).toBe(true);
    expect(summary).toHaveAttribute('title', long);
  });

  it('eventsTruncated 为真 → 「只显示最近 50 条」', async () => {
    renderPanel(async () =>
      createMemberDetail({ eventsTruncated: true, events: [createMemberEvent()] }),
    );
    fireEvent.click(openDetailButton('frontend'));
    expect(await screen.findByText(/Showing the latest 50 events/)).toBeInTheDocument();
  });

  it('eventsTruncated 为假 → 那句话必须消失（永远亮着的提示等于没有提示）', async () => {
    renderPanel(async () =>
      createMemberDetail({ eventsTruncated: false, events: [createMemberEvent()] }),
    );
    fireEvent.click(openDetailButton('frontend'));
    await screen.findByRole('region', { name: 'Member recent events' });
    expect(screen.queryByText(/Showing the latest 50 events/)).not.toBeInTheDocument();
  });
});

describe('成员详情抽屉 — 租约走动', () => {
  beforeEach(() => {
    resetStores();
    mockInvoke.mockReset();
  });

  it('假时钟推进 1s → 租约文案变化（只在抽屉打开期间走）', async () => {
    const base = 1_700_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(base);

    renderPanel(async () =>
      createMemberDetail({
        tasks: [
          createTaskCard({
            id: 't1',
            title: '在飞的活',
            state: 'in_progress',
            owner: 'w1@tm_1',
            // 已过去 60s，租约 1800s ⇒ 剩 1740s（29:00）
            claimedAt: base - 60_000,
            leaseTtl: 1800,
          }),
        ],
      }),
    );

    fireEvent.click(openDetailButton('frontend'));
    // 假时钟下 `waitFor` 不可用（它自己也靠定时器）：手动落地一次 invoke 的微任务。
    await act(async () => {
      await Promise.resolve();
    });

    expect(within(drawer()).getByText('Lease 29:00')).toBeInTheDocument();

    // 推进 1s：定时器只驱动抽屉自己重渲染，租约因此走一步
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(within(drawer()).getByText('Lease 28:59')).toBeInTheDocument();
  });

  it('关闭抽屉时清掉 1s 定时器（不许留成一个常驻计时器）', async () => {
    const setSpy = vi.spyOn(globalThis, 'setInterval');
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');
    try {
      renderPanel(async () => createMemberDetail());
      fireEvent.click(openDetailButton('frontend'));
      await screen.findByRole('dialog', { name: 'Member details: frontend' });

      // 找那个 1s 的（其它地方的定时器不许冒充它）
      const tick = setSpy.mock.calls.findIndex(([, delay]) => delay === LEASE_TICK_MS);
      expect(tick).toBeGreaterThan(-1);
      const timerId = setSpy.mock.results[tick]?.value;

      fireEvent.click(within(drawer()).getByRole('button', { name: 'Close member details' }));

      // 这只在**卸载/改坏**时才能看出来：不清就会让整块面板每秒白白重渲染
      expect(clearSpy).toHaveBeenCalledWith(timerId);
    } finally {
      setSpy.mockRestore();
      clearSpy.mockRestore();
    }
  });
});

describe('成员详情抽屉 — 失败面', () => {
  beforeEach(() => {
    resetStores();
    mockInvoke.mockReset();
  });

  it('重取失败：错误可见，且不清掉已有数据', async () => {
    let fail = false;
    renderPanel(async () => {
      if (fail) throw new Error('member `w1@tm_1` is not loaded');
      return createMemberDetail({
        tasks: [createTaskCard({ id: 't1', title: '在飞的活', owner: 'w1@tm_1' })],
      });
    });

    fireEvent.click(openDetailButton('frontend'));
    await screen.findByText('在飞的活');

    // 一次脉冲（`lastRev` 变化）触发重取，而这次失败
    fail = true;
    await act(async () => {
      useTeamStore.setState({ lastRev: 7 });
      await Promise.resolve();
    });

    expect(await within(drawer()).findByRole('alert')).toHaveTextContent('is not loaded');
    // 闪空比旧数据更糟：失败时上一次的任务仍在
    expect(within(drawer()).getByText('在飞的活')).toBeInTheDocument();
  });
});

/**
 * 抽屉与花名册**同一份判据**（`openTerminalAction` 的五态）。
 *
 * 两条判据：恢复态必须派发 `team_resume`（而不是什么都没发生 —— 抽屉曾经只认识「活进程」
 * 与「历史」两条路，恢复态落进去就是静默的空点击），不可恢复的成员必须派发历史（而不是
 * 静默地什么都不做）。
 */
describe('成员详情抽屉 — 五态里的恢复与历史（含待批队列的去处）', () => {
  beforeEach(() => {
    resetStores();
    mockInvoke.mockReset();
  });

  /** 让 `team_member_detail` 返回给定成员，其余命令回快照（`team_resume` 回一份报告）。 */
  function renderDrawerFor(
    member: ReturnType<typeof createMemberStatus>,
    host: { onOpenTerminal?: ReturnType<typeof vi.fn>; onOpenHistory?: ReturnType<typeof vi.fn> },
  ) {
    const snapshot = createTeamSnapshot({ members: MEMBERS });
    useTeamStore.setState({ teamId: 'tm_1', snapshot });
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === 'team_member_detail') return createMemberDetail({ member });
      if (cmd === 'team_resume') {
        return {
          teamId: 'tm_1',
          resumed: [member.memberId],
          skippedAlreadyLive: [],
          cold: [],
          failed: [],
        };
      }
      if (cmd === 'team_list') return createTeamList({ teams: [] });
      return snapshot;
    });
    render(<TeamPanel onOpenTerminal={host.onOpenTerminal} onOpenHistory={host.onOpenHistory} />);
  }

  it('离线 + 可恢复：按钮是「恢复会话」，点击 ⇒ team_resume（与花名册同一个动作）', async () => {
    renderDrawerFor(
      createMemberStatus({
        memberId: 'w1@tm_1',
        name: 'frontend',
        state: 'offline',
        session: { live: false, terminalId: null },
        agentSessionId: 'native-w1',
        resumable: true,
      }),
      { onOpenTerminal: vi.fn() },
    );

    fireEvent.click(openDetailButton('frontend'));
    await screen.findByRole('dialog', { name: 'Member details: frontend' });

    fireEvent.click(within(drawer()).getByRole('button', { name: 'Resume session: frontend' }));

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('team_resume', {
        teamId: 'tm_1',
        memberId: 'w1@tm_1',
      }),
    );
  });

  it('待批队列：可恢复的成员 ⇒ 点「去终端处理」先 team_resume（审批框在它自己的终端里）', async () => {
    const snapshot = createTeamSnapshot({ members: MEMBERS });
    useTeamStore.setState({ teamId: 'tm_1', snapshot });
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === 'team_member_detail') {
        return createMemberDetail({
          member: createMemberStatus({
            memberId: 'w1@tm_1',
            name: 'frontend',
            state: 'offline',
            session: { live: false, terminalId: null },
            agentSessionId: 'native-w1',
            resumable: true,
          }),
          awaitingApproval: [
            createTaskCard({ id: 't9', title: '跑一次迁移', state: 'awaiting_approval' }),
          ],
        });
      }
      if (cmd === 'team_resume') {
        return {
          teamId: 'tm_1',
          resumed: ['w1@tm_1'],
          skippedAlreadyLive: [],
          cold: [],
          failed: [],
        };
      }
      if (cmd === 'team_list') return createTeamList({ teams: [] });
      return snapshot;
    });
    render(<TeamPanel onOpenTerminal={vi.fn()} />);

    fireEvent.click(openDetailButton('frontend'));
    const queue = await screen.findByRole('region', { name: 'Approval queue' });
    fireEvent.click(
      within(queue).getByRole('button', {
        name: /Handle the task awaiting approval in the terminal/,
      }),
    );

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('team_resume', {
        teamId: 'tm_1',
        memberId: 'w1@tm_1',
      }),
    );
  });

  it('待批队列：只能看记录的成员 ⇒ 按钮置灰 + 可见理由（历史里没有审批框）', async () => {
    const snapshot = createTeamSnapshot({ members: MEMBERS });
    useTeamStore.setState({ teamId: 'tm_1', snapshot });
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === 'team_member_detail') {
        return createMemberDetail({
          member: createMemberStatus({
            memberId: 'w1@tm_1',
            name: 'frontend',
            state: 'offline',
            session: { live: false, terminalId: null },
            agentSessionId: 'native-w1',
            resumable: false,
          }),
          awaitingApproval: [
            createTaskCard({ id: 't9', title: '跑一次迁移', state: 'awaiting_approval' }),
          ],
        });
      }
      if (cmd === 'team_list') return createTeamList({ teams: [] });
      return snapshot;
    });
    const onOpenTerminal = vi.fn();
    render(<TeamPanel onOpenTerminal={onOpenTerminal} />);

    fireEvent.click(openDetailButton('frontend'));
    const queue = await screen.findByRole('region', { name: 'Approval queue' });
    const button = within(queue).getByRole('button', {
      name: /Handle the task awaiting approval in the terminal/,
    });

    expect(button).toBeDisabled();
    // 理由必须是可见文字（`disabled` 元素不可聚焦）
    expect(within(queue).getByText(/Process exited; view it in history only/)).toBeInTheDocument();
    fireEvent.click(button);
    expect(onOpenTerminal).not.toHaveBeenCalled();
    expect(mockInvoke).not.toHaveBeenCalledWith('team_resume', expect.anything());
  });

  it('离线 + 不可恢复：按钮是「查看记录」，点击打开历史（不是一次静默的空点击）', async () => {
    const onOpenHistory = vi.fn();
    renderDrawerFor(
      createMemberStatus({
        memberId: 'w1@tm_1',
        name: 'frontend',
        state: 'offline',
        session: { live: false, terminalId: null },
        agentSessionId: 'native-w1',
        resumable: false,
      }),
      { onOpenHistory },
    );

    fireEvent.click(openDetailButton('frontend'));
    await screen.findByRole('dialog', { name: 'Member details: frontend' });

    fireEvent.click(within(drawer()).getByRole('button', { name: 'View history: frontend' }));

    expect(onOpenHistory).toHaveBeenCalledWith('pi', 'native-w1', 'frontend', 'p1');
    expect(mockInvoke).not.toHaveBeenCalledWith('team_resume', expect.anything());
  });
});

/**
 * R8 的「去处」：花名册行内删掉的 agent / 通道 / 档位 / 工作区必须在抽屉里仍可见 ——
 * 否则「去噪」就会悄悄变成「丢信息」。
 *
 * 行内断言在 `TeamPanel.roster.test.tsx`（断言这些 chip **不在**行内）；这里补反面：
 * 同一批事实在抽屉里**在**。`C 档 · sentinel only` 尤其重要：行内只剩 `⚠ C` 之后，
 * 完整语义（完成能报、卡住永远不可知）的可见文字承载就在这一排 chip 与抽屉的 warn 块。
 */
describe('成员详情抽屉 — 身份 chip 排（R8 行内去噪的去处）', () => {
  beforeEach(() => {
    resetStores();
    mockInvoke.mockReset();
  });

  it('agent / 通道 / 档位 / 工作区 在抽屉里；C 档仍是完整的可见文字', async () => {
    const sentinel = createMemberStatus({
      memberId: 'w2@tm_1',
      name: 'researcher',
      agentId: 'gemini',
      channel: 'pty',
      tier: 'c',
      workspace: 'shared',
      state: 'running',
    });
    const snapshot = createTeamSnapshot({ members: [sentinel] });
    useTeamStore.setState({ teamId: 'tm_1', snapshot });
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === 'team_member_detail') return createMemberDetail({ member: sentinel });
      if (cmd === 'team_list') return createTeamList({ teams: [] });
      return snapshot;
    });
    render(<TeamPanel onOpenTerminal={vi.fn()} />);

    fireEvent.click(openDetailButton('researcher'));
    const panel = await screen.findByRole('dialog', { name: 'Member details: researcher' });

    expect(within(panel).getByText('gemini')).toBeInTheDocument();
    expect(within(panel).getByText('CLI · PTY')).toBeInTheDocument();
    // 行内只剩 `⚠ C`；完整语义（sentinel only）在这里仍是可见文字，不是只进 title
    expect(within(panel).getByText('Tier C · sentinel only')).toBeInTheDocument();
    // `shared` 只在**行内**是噪音（缺省值）；抽屉是完整信息面，照常写出来
    expect(within(panel).getByText('Shared workspace')).toBeInTheDocument();
  });
});
