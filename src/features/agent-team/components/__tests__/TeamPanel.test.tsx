import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAgentStore } from '@/shared/store/agentStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorkspaceStore } from '@/shared/store/workspaceStore';
import type { ProjectId } from '@/shared/utils/workspaceRef';
import {
  createAgent,
  createLaunchableAgent,
  createMemberStatus,
  createProject,
  createTaskCard,
  createTaskDetail,
  createTeam,
  createTeamList,
  createTeamOptions,
  createTeamSession,
  createTeamSnapshot,
} from '@/testing/factories';
import { invoke } from '@/testing/tauriCore';

import { __resetTeamGenerationForTests, useTeamStore } from '../../store/teamStore';
import TeamPanel from '../TeamPanel';

/**
 * 团队面板（`prototype-agent-team.html` 视图 ①）。
 *
 * 覆盖四条判据：
 * 1. 空态是**队长入口**（不是一个空板），启动参数里的 `projectPath` 必须是**激活单元的工作树根**；
 * 2. 花名册按快照原样渲染（六态文案 / 租约三态）；
 * 3. **AC2**：`idle` + `unverified` 与 `idle` + `verified` 的可访问文本不同；
 * 4. **红线 4**：初始渲染不拉任务正文，点开卡片才拉。
 */

const mockInvoke = vi.mocked(invoke);

const PROJECT_PATH = '/repo/main';
const WORKTREE_PATH = '/repo/wt-a';

function setActiveProject(path = PROJECT_PATH): void {
  const project = createProject({ id: 'p1' as ProjectId, path });
  useProjectStore.setState({ activeProjectId: project.id, activeProject: project });
}

/** 每个用例都从「干净的三个 store」开始，否则上一个用例的团队/项目会串进来。 */
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
  useProjectStore.setState({ activeProjectId: null, activeProject: null });
  useWorkspaceStore.setState({ byProject: {} });
  useAgentStore.setState({
    agents: [
      createAgent({ id: 'claude-code', name: 'Claude Code', command: 'claude' }),
      createAgent({ id: 'codex', name: 'Codex', command: 'codex' }),
      createAgent({ id: 'mock', name: 'Disabled Agent', command: 'mock', enabled: false }),
    ],
    loading: false,
  });
}

function region(name: string): HTMLElement {
  return screen.getByRole('region', { name });
}

describe('TeamPanel — 空态队长入口', () => {
  beforeEach(() => {
    resetStores();
    mockInvoke.mockReset();
  });

  it('空态显示 CTA；点击后带上「激活单元的工作树根」启动队长会话', async () => {
    setActiveProject();
    // worktree 激活：团队根必须是该工作树，而不是 project.path
    useWorkspaceStore.getState().setActiveWorkspace('p1' as ProjectId, WORKTREE_PATH, 'feat-a');

    const session = createTeamSession();
    const snapshot = createTeamSnapshot();
    mockInvoke.mockImplementation(async (cmd) => {
      // 面板空态 = 队长入口 + **已有团队**列表（`team_list`）；这里没有历史团队。
      if (cmd === 'team_list') return createTeamList({ teams: [] });
      // 候选清单由后端给（`team_launchable_agents`）—— 面板不再自己筛 agent 配置。
      if (cmd === 'team_launchable_agents')
        return [
          createLaunchableAgent({ agentId: 'claude-code' }),
          createLaunchableAgent({ agentId: 'codex' }),
        ];
      // 团队配置的默认值同理只能来自后端（缺了它面板不允许建队）。
      if (cmd === 'team_options')
        return createTeamOptions({
          members: [
            createLaunchableAgent({ agentId: 'claude-code' }),
            createLaunchableAgent({ agentId: 'codex' }),
          ],
        });
      if (cmd === 'start_team_session') return session;
      if (cmd === 'team_snapshot') return snapshot;
      return undefined;
    });

    const onShowToast = vi.fn();
    const onOpenLeaderTerminal = vi.fn();
    render(<TeamPanel onShowToast={onShowToast} onOpenLeaderTerminal={onOpenLeaderTerminal} />);

    // 候选只来自后端清单：`agentStore` 里那个禁用且不在清单里的 agent 不会出现在面板上。
    await screen.findByRole('button', { name: /Claude Code/ });
    expect(screen.queryByRole('button', { name: /Disabled Agent/ })).not.toBeInTheDocument();
    expect(screen.getByText(WORKTREE_PATH)).toBeInTheDocument();

    // 选第二个候选：证明 agentId 来自用户选择，而不是硬编码第一个
    const codexRow = await screen.findByRole('button', { name: /Codex/ });
    fireEvent.click(codexRow);
    await waitFor(() => expect(codexRow).toHaveAttribute('aria-pressed', 'true'));
    fireEvent.click(screen.getByRole('button', { name: '以队长身份开会话' }));

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('start_team_session', {
        // 项目 = 激活项目；路径 = 激活单元的**工作树根**。两者不是同一件事。
        projectId: 'p1',
        agentId: 'codex',
        projectPath: WORKTREE_PATH,
        name: null,
        // 默认值一个字都没改 ⇒ 没有任何覆盖项。
        config: {},
      }),
    );
    // 派生自 workspaceRootOf（不是裸 projectPath）
    expect(WORKTREE_PATH).not.toBe(PROJECT_PATH);

    // 成功后：拉快照 + 用后端给的 terminalId 接管队长终端（标题用快照里的队名）
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('team_snapshot', { teamId: 'tm_1' }),
    );
    await waitFor(() =>
      expect(onOpenLeaderTerminal).toHaveBeenCalledWith(session, '队长 · refactor'),
    );
    expect(onShowToast).toHaveBeenCalled();
    expect(await screen.findByText('refactor')).toBeInTheDocument();
  });

  it('失败时显示后端拒绝原因原文（不改写、不吞掉）', async () => {
    setActiveProject();
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === 'team_list') return createTeamList({ teams: [] });
      if (cmd === 'team_launchable_agents') return [createLaunchableAgent({ agentId: 'gemini' })];
      if (cmd === 'team_options')
        return createTeamOptions({ members: [createLaunchableAgent({ agentId: 'gemini' })] });
      // 准入在 `start_team_session` 里才判（清单说能起，也可能连不上工具面）。
      if (cmd === 'start_team_session')
        throw 'Unsupported: agent `gemini` cannot reach the team tool surface';
      return undefined;
    });

    render(<TeamPanel />);
    await screen.findByRole('button', { name: /Gemini|gemini/ });
    fireEvent.click(screen.getByRole('button', { name: '以队长身份开会话' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'Unsupported: agent `gemini` cannot reach the team tool surface',
    );
    // 失败后仍停在空态（没有团队可显示）
    expect(screen.getByRole('button', { name: '以队长身份开会话' })).toBeInTheDocument();
  });
});

describe('TeamPanel — 花名册', () => {
  beforeEach(() => {
    resetStores();
    mockInvoke.mockReset();
  });

  const snapshot = createTeamSnapshot({
    members: [
      createMemberStatus({
        memberId: 'lead@tm_1',
        name: 'lead',
        role: 'lead',
        state: 'running',
        verification: 'verified',
        leaseRemainingSecs: null,
      }),
      createMemberStatus({
        memberId: 'w1@tm_1',
        name: 'frontend',
        state: 'idle',
        verification: 'unverified',
        leaseRemainingSecs: 0,
      }),
      createMemberStatus({
        memberId: 'w2@tm_1',
        name: 'backend',
        state: 'awaiting',
        verification: 'unverified',
        leaseRemainingSecs: 120,
      }),
      createMemberStatus({
        memberId: 'w3@tm_1',
        name: 'researcher',
        state: 'idle',
        verification: 'verified',
        leaseRemainingSecs: null,
      }),
    ],
  });

  it('按快照渲染行数、六态文案与租约三态', async () => {
    useTeamStore.setState({ teamId: 'tm_1', snapshot });
    mockInvoke.mockResolvedValue(snapshot);

    render(<TeamPanel />);
    const rows = within(region('成员花名册')).getAllByRole('listitem');
    expect(rows).toHaveLength(4);

    expect(within(rows[0]).getByText('运行中')).toBeInTheDocument();
    expect(within(rows[0]).getByText('无在飞任务')).toBeInTheDocument();
    expect(within(rows[0]).getByText('队长')).toBeInTheDocument();

    // 空闲 + 未声明（AC2）
    expect(within(rows[1]).getByText('空闲 ⚠ 未声明')).toBeInTheDocument();
    // leaseRemainingSecs === 0 ⇒ 已超时（不是「无在飞任务」），文案与卡片 / 抽屉同一份
    expect(within(rows[1]).getByText('租约已超时')).toBeInTheDocument();

    expect(within(rows[2]).getByText('待批准')).toBeInTheDocument();
    expect(within(rows[2]).getByText('租约剩 2:00')).toBeInTheDocument();

    expect(within(rows[3]).getByText('空闲 ✓ 已声明')).toBeInTheDocument();
  });

  it('AC2：idle+unverified 与 idle+verified 的可访问文本不同（视觉可区分）', () => {
    useTeamStore.setState({ teamId: 'tm_1', snapshot });
    mockInvoke.mockResolvedValue(snapshot);

    render(<TeamPanel />);
    const roster = region('成员花名册');

    // 两行的可访问文本不同 —— AC2 的判据（读屏 / tooltip / 灰度截图都能区分）。
    const unverified = within(roster).getByTitle(/未声明/);
    const verified = within(roster).getByTitle(/已声明/);

    // 文案不同
    expect(unverified).toHaveTextContent('空闲 ⚠ 未声明');
    expect(verified).toHaveTextContent('空闲 ✓ 已声明');
    // 可访问文本不同（且与 title 同源，鼠标悬停能拿到同一句「为什么」）
    expect(unverified.getAttribute('aria-label')).not.toBe(verified.getAttribute('aria-label'));
    expect(unverified).toHaveAttribute('title', unverified.getAttribute('aria-label'));
    expect(unverified).toHaveAttribute('aria-label', expect.stringContaining('任务仍在进行中'));
  });
});

describe('TeamPanel — 共享任务板', () => {
  beforeEach(() => {
    resetStores();
    mockInvoke.mockReset();
  });

  const tasks = [
    createTaskCard({ id: 't1', title: '待认领的活', state: 'pending' }),
    createTaskCard({ id: 't2', title: '刚认领的活', state: 'claimed', owner: 'w1@tm_1' }),
    createTaskCard({ id: 't3', title: '进行中的活', state: 'in_progress', owner: 'w2@tm_1' }),
    createTaskCard({
      id: 't4',
      title: '等批准的活',
      state: 'awaiting_approval',
      dependsOn: ['t2', 't3'],
    }),
    createTaskCard({ id: 't5', title: '做完的活', state: 'done' }),
    createTaskCard({
      id: 't6',
      title: '反复失败的活',
      state: 'failed',
      reclaimCount: 2,
      summaryTruncated: true,
    }),
  ];

  it('按状态分列（claimed 留在进行中）、显示截断提示与卡片标记', async () => {
    useTeamStore.setState({
      teamId: 'tm_1',
      snapshot: createTeamSnapshot({ tasks, tasksTruncated: true }),
    });
    mockInvoke.mockResolvedValue(createTeamSnapshot({ tasks, tasksTruncated: true }));

    render(<TeamPanel />);
    const board = region('共享任务板');
    const column = (name: string): HTMLElement => within(board).getByRole('group', { name });

    expect(within(column('待认领')).getByText('待认领的活')).toBeInTheDocument();
    // 刚认领的任务不许从板上消失
    expect(within(column('进行中')).getByText('刚认领的活')).toBeInTheDocument();
    expect(within(column('进行中')).getByText('进行中的活')).toBeInTheDocument();
    expect(within(column('待批准')).getByText('等批准的活')).toBeInTheDocument();
    expect(within(column('已完成')).getByText('做完的活')).toBeInTheDocument();
    expect(within(column('阻塞')).getByText('反复失败的活')).toBeInTheDocument();

    // 依赖数 + 回收次数 + 摘要截断都必须在卡片上说清楚
    expect(within(column('待批准')).getByText('依赖 2')).toBeInTheDocument();
    expect(within(column('阻塞')).getByText('被回收 2 次')).toBeInTheDocument();
    expect(within(column('阻塞')).getByText('摘要已截断')).toBeInTheDocument();

    expect(within(board).getByText('只显示前 200 条')).toBeInTheDocument();
  });

  it('未截断时不显示「只显示前 N 条」（否则提示永远亮着，等于没有提示）', async () => {
    const snapshot = createTeamSnapshot({ tasks: [tasks[0]], tasksTruncated: false });
    useTeamStore.setState({ teamId: 'tm_1', snapshot });
    mockInvoke.mockResolvedValue(snapshot);

    render(<TeamPanel />);
    expect(within(region('共享任务板')).queryByText(/只显示前/)).not.toBeInTheDocument();
  });
});

describe('TeamPanel — 任务详情（红线 4：点开才拉）', () => {
  beforeEach(() => {
    resetStores();
    mockInvoke.mockReset();
  });

  it('初始渲染不调 team_task_detail；点卡片才拉正文', async () => {
    const snapshot = createTeamSnapshot({
      tasks: [
        createTaskCard({ id: 't1', teamId: 'tm_1', title: '登录页骨架', state: 'in_progress' }),
      ],
      team: createTeam({ id: 'tm_1' }),
    });
    const detail = createTaskDetail({
      id: 't1',
      title: '登录页骨架',
      body: '派活正文：独占这一段',
    });
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === 'team_snapshot') return snapshot;
      if (cmd === 'team_task_detail') return detail;
      return undefined;
    });

    useTeamStore.setState({ teamId: 'tm_1', snapshot });
    render(<TeamPanel />);

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('team_snapshot', { teamId: 'tm_1' }),
    );
    // 初始渲染**不得**拉正文
    expect(mockInvoke.mock.calls.some(([cmd]) => cmd === 'team_task_detail')).toBe(false);
    expect(screen.queryByText('派活正文：独占这一段')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /打开任务 t1/ }));
    // **判据 6**：请求必须带上 `(teamId, taskId)` 两个值 —— 任务 id 只在队内唯一，
    // 只传 `taskId` 时本断言变红（后端也无从判断点的是哪个队的 `t1`）。
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('team_task_detail', {
        teamId: 'tm_1',
        taskId: 't1',
      }),
    );
    expect(await screen.findByText('派活正文：独占这一段')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '关闭任务详情' }));
    expect(screen.queryByText('派活正文：独占这一段')).not.toBeInTheDocument();
  });
});
