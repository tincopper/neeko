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
      if (cmd === 'team_role_list') return { roles: [], truncated: false }; // 角色库（v19）：面板挂载时拉一次
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

    // 列表态是主面；创建流由「新建团队」按钮推入（导航重排，2026-11-08）。
    fireEvent.click(screen.getByRole('button', { name: 'New team' }));

    // 候选只来自后端清单：`agentStore` 里那个禁用且不在清单里的 agent 不会出现在面板上。
    await screen.findByRole('button', { name: /Claude Code/ });
    expect(screen.queryByRole('button', { name: /Disabled Agent/ })).not.toBeInTheDocument();
    expect(screen.getByText(WORKTREE_PATH)).toBeInTheDocument();

    // 选第二个候选：证明 agentId 来自用户选择，而不是硬编码第一个
    const codexRow = await screen.findByRole('button', { name: /Codex/ });
    fireEvent.click(codexRow);
    await waitFor(() => expect(codexRow).toHaveAttribute('aria-pressed', 'true'));
    fireEvent.click(screen.getByRole('button', { name: 'Start session as lead' }));

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('start_team_session', {
        // 项目 = 激活项目；路径 = 激活单元的**工作树根**。两者不是同一件事。
        projectId: 'p1',
        agentId: 'codex',
        projectPath: WORKTREE_PATH,
        // 同一个激活单元的**身份**维度：根是执行落点，worktree 是 Workspace 身份。
        workspaceWorktree: WORKTREE_PATH,
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
      // 队长 tab 的图标来源：随建队响应回来的 `leadAgentId`（不从快照里找）。
      expect(onOpenLeaderTerminal).toHaveBeenCalledWith(session, 'Lead · refactor', 'claude-code'),
    );
    expect(onShowToast).toHaveBeenCalled();
    expect(await screen.findByText('refactor')).toBeInTheDocument();
  });

  it('失败时显示后端拒绝原因原文（不改写、不吞掉）', async () => {
    setActiveProject();
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === 'team_role_list') return { roles: [], truncated: false }; // 角色库（v19）：面板挂载时拉一次
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
    // 创建流在推入视图里：先按「新建团队」（导航重排，2026-11-08）。
    fireEvent.click(screen.getByRole('button', { name: 'New team' }));
    await screen.findByRole('button', { name: /Gemini|gemini/ });
    fireEvent.click(screen.getByRole('button', { name: 'Start session as lead' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'Unsupported: agent `gemini` cannot reach the team tool surface',
    );
    // 失败后仍停在空态（没有团队可显示）
    expect(screen.getByRole('button', { name: 'Start session as lead' })).toBeInTheDocument();
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
    const rows = within(region('Member roster')).getAllByRole('listitem');
    expect(rows).toHaveLength(4);

    expect(within(rows[0]).getByText('Running')).toBeInTheDocument();
    // `leaseRemainingSecs === null` ⇒ 行内**没有**任何租约文字（R3：不恒亮一个「无在飞任务」）
    expect(within(rows[0]).queryByText(/Lease|No task in flight/)).not.toBeInTheDocument();
    expect(within(rows[0]).getByText('Lead')).toBeInTheDocument();

    // 空闲 + 未声明（AC2）
    expect(within(rows[1]).getByText('Idle ⚠ unverified')).toBeInTheDocument();
    // leaseRemainingSecs === 0 ⇒ 已超时（不是「无在飞任务」），文案与卡片 / 抽屉同一份
    expect(within(rows[1]).getByText('Lease expired')).toBeInTheDocument();

    expect(within(rows[2]).getByText('Awaiting approval')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Lease 2:00')).toBeInTheDocument();

    expect(within(rows[3]).getByText('Idle ✓ verified')).toBeInTheDocument();
  });

  it('AC2：idle+unverified 与 idle+verified 的可访问文本不同（视觉可区分）', () => {
    useTeamStore.setState({ teamId: 'tm_1', snapshot });
    mockInvoke.mockResolvedValue(snapshot);

    render(<TeamPanel />);
    const roster = region('Member roster');

    // 两行的可访问文本不同 —— AC2 的判据（读屏 / tooltip / 灰度截图都能区分）。
    const unverified = within(roster).getByTitle(/Idle ⚠ unverified/);
    const verified = within(roster).getByTitle(/Idle ✓ verified/);

    // 文案不同
    expect(unverified).toHaveTextContent('Idle ⚠ unverified');
    expect(verified).toHaveTextContent('Idle ✓ verified');
    // 可访问文本不同（且与 title 同源，鼠标悬停能拿到同一句「为什么」）
    expect(unverified.getAttribute('aria-label')).not.toBe(verified.getAttribute('aria-label'));
    expect(unverified).toHaveAttribute('title', unverified.getAttribute('aria-label'));
    expect(unverified).toHaveAttribute(
      'aria-label',
      expect.stringContaining('the task is still in progress'),
    );
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
    const board = region('Shared task board');
    const column = (name: string): HTMLElement => within(board).getByRole('group', { name });

    expect(within(column('Unclaimed')).getByText('待认领的活')).toBeInTheDocument();
    // 刚认领的任务不许从板上消失
    expect(within(column('In progress')).getByText('刚认领的活')).toBeInTheDocument();
    expect(within(column('In progress')).getByText('进行中的活')).toBeInTheDocument();
    expect(within(column('Awaiting approval')).getByText('等批准的活')).toBeInTheDocument();
    expect(within(column('Done')).getByText('做完的活')).toBeInTheDocument();
    expect(within(column('Blocked')).getByText('反复失败的活')).toBeInTheDocument();

    // 依赖数 / id 属于详情（卡片只留「这张卡是什么、归谁」）
    expect(within(column('Awaiting approval')).queryByText('依赖 2')).not.toBeInTheDocument();
    expect(within(column('Blocked')).getByText('Reclaimed 2 times')).toBeInTheDocument();
    expect(within(column('Blocked')).getByText('Summary truncated')).toBeInTheDocument();

    expect(within(board).getByText('Showing first 200')).toBeInTheDocument();
  });

  it('未截断时不显示「只显示前 N 条」（否则提示永远亮着，等于没有提示）', async () => {
    const snapshot = createTeamSnapshot({ tasks: [tasks[0]], tasksTruncated: false });
    useTeamStore.setState({ teamId: 'tm_1', snapshot });
    mockInvoke.mockResolvedValue(snapshot);

    render(<TeamPanel />);
    expect(
      within(region('Shared task board')).queryByText(/Showing first/),
    ).not.toBeInTheDocument();
  });
});

describe('TeamPanel — 任务详情（红线 4：点开才拉）', () => {
  beforeEach(() => {
    resetStores();
    mockInvoke.mockReset();
  });

  it('初始渲染不调 team_task_detail；点卡片 → onOpenTaskTab（中央 tab，点 tab 才拉）', async () => {
    const snapshot = createTeamSnapshot({
      tasks: [
        createTaskCard({ id: 't1', teamId: 'tm_1', title: '登录页骨架', state: 'in_progress' }),
      ],
      team: createTeam({ id: 'tm_1' }),
    });
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === 'team_snapshot') return snapshot;
      return undefined;
    });

    useTeamStore.setState({ teamId: 'tm_1', snapshot });
    const onOpenTaskTab = vi.fn();
    render(<TeamPanel onOpenTaskTab={onOpenTaskTab} />);

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('team_snapshot', { teamId: 'tm_1' }),
    );
    // 面板**不发** team_task_detail：详情的读取移进了中央 tab（挂载时才拉）。
    expect(mockInvoke.mock.calls.some(([cmd]) => cmd === 'team_task_detail')).toBe(false);

    // 点卡片 → 打开中央 tab：三参（teamId, taskId, title）+ projectId 落键。
    fireEvent.click(screen.getByRole('button', { name: /Open task t1/ }));
    expect(onOpenTaskTab).toHaveBeenCalledWith('tm_1', 't1', '登录页骨架', 'p1');
  });
});
