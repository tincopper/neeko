/**
 * `WorkItemRunsSection`：执行区的**Actions**与**跳转**（`run-single` 落地的两块）。
 *
 * 这里**不 mock 终端端口**：整条链路的要点就是「点击 → 真的在 store 里多一个 terminal tab →
 * 记录指向它 → 点 Open 能切回去"。把 `createTaskTerminal` mock 掉，就只剩「我们调用了自己写的
 * 函数"，而 tab 空间键写错（自己拼 `projectId` 而不是 `activeWorkspaceSession().key`）这类
 * 缺陷会安静通过 —— 恰恰是这条链最容易错的地方。
 *
 * 只 mock 三个真 IPC 入口：agent 列表 / agent 配置 / 工作项 api。
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  listWorkItemRuns: vi.fn(),
  recordWorkItemRun: vi.fn(),
}));
const agentApi = vi.hoisted(() => ({ listAgents: vi.fn(), getAgent: vi.fn() }));

vi.mock('../../api/workItemsApi', () => api);
vi.mock('../../../agent/api/agentApi', () => agentApi);

import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { activeWorkspaceSession } from '@/shared/store/workspaceStore';
import type { ProjectId } from '@/shared/utils/workspaceRef';
import { createAgent, createProject } from '@/testing/factories';

import type { WorkItem, WorkItemRun } from '../../types';
import WorkItemRunsSection from '../WorkItemRunsSection';

const PROJECT_ID = 'p1';
const SPACE = activeWorkspaceSession(PROJECT_ID as ProjectId).key;

function item(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: 'wi_1',
    projectId: PROJECT_ID,
    title: '修复登录态过期',
    body: '令牌过期后没有跳登录',
    stage: 'Ready',
    priority: 'p1',
    labels: ['bug'],
    assignee: 'tincopper',
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

function run(overrides: Partial<WorkItemRun> = {}): WorkItemRun {
  return {
    id: 'run_1',
    workItemId: 'wi_1',
    mode: 'single',
    ref: { kind: 'session', id: 'tab_1', sub: null },
    snapshot: { state: 'running', label: 'OpenCode', capturedAt: 1_700_000_000_000 },
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

function tabsInSpace() {
  return useEditorStore.getState().tabs[SPACE]?.tabs ?? [];
}

function mountSection(showToast = vi.fn(), projectId: string | null = PROJECT_ID) {
  render(<WorkItemRunsSection item={item()} projectId={projectId} showToast={showToast} />);
  return showToast;
}

beforeEach(() => {
  useEditorStore.setState({ tabs: {}, editorLayout: {} });
  api.listWorkItemRuns.mockReset();
  api.recordWorkItemRun.mockReset();
  agentApi.listAgents.mockReset();
  agentApi.getAgent.mockReset();

  api.listWorkItemRuns.mockResolvedValue([]);
  api.recordWorkItemRun.mockImplementation((params: { refId: string }) =>
    Promise.resolve(run({ ref: { kind: 'session', id: params.refId, sub: null } })),
  );
  agentApi.listAgents.mockResolvedValue([
    createAgent({ id: 'opencode', name: 'OpenCode', command: 'opencode' }),
    // 没有命令的 agent column进下拉等于给用户一个「点了才知道不行"的选项。
    createAgent({ id: 'mockAgent', name: 'Mock', command: '' }),
  ]);
  agentApi.getAgent.mockResolvedValue(createAgent({ id: 'opencode', name: 'OpenCode' }));

  const project = createProject({
    id: PROJECT_ID as ProjectId,
    selected_agents: ['opencode'],
  });
  useProjectStore.setState({
    projects: [project],
    activeProjectId: PROJECT_ID as ProjectId,
    activeProject: project,
  });
});

describe('WorkItemRunsSection — agent 下拉', () => {
  it('只列有 command 的 agent，缺省选项目 selected_agents[0]', async () => {
    mountSection();

    const select = screen.getByRole('combobox', { name: 'Select agent' });
    await waitFor(() => expect(within(select).getAllByRole('option')).toHaveLength(1));
    expect(within(select).getByRole('option', { name: 'OpenCode' })).toBeInTheDocument();
    expect(within(select).queryByRole('option', { name: 'Mock' })).not.toBeInTheDocument();
    expect(select).toHaveValue('opencode');
  });

  it('缺省 agent 不在候选列表里时补成选项（否则 select 的 value 是空的）', async () => {
    useProjectStore.setState({
      projects: [createProject({ id: PROJECT_ID as ProjectId, selected_agents: ['custom'] })],
    });
    mountSection();

    const select = screen.getByRole('combobox', { name: 'Select agent' });
    await waitFor(() => expect(select).toHaveValue('custom'));
    expect(within(select).getByRole('option', { name: 'custom' })).toBeInTheDocument();
  });

  it('agent 列表拉不到：只有缺省项，但按钮**不禁用**（列表失败不等于功能不可用）', async () => {
    agentApi.listAgents.mockRejectedValue(new Error('ipc down'));
    mountSection();

    const select = screen.getByRole('combobox', { name: 'Select agent' });
    await waitFor(() => expect(within(select).getAllByRole('option')).toHaveLength(1));
    expect(screen.getByRole('button', { name: 'Run with agent' })).toBeEnabled();
  });

  it('换一个 agent 就跑那一个（下拉的选择不被子组件的缺省值覆盖）', async () => {
    const user = userEvent.setup();
    agentApi.listAgents.mockResolvedValue([
      createAgent({ id: 'opencode', name: 'OpenCode', command: 'opencode' }),
      createAgent({ id: 'claude', name: 'Claude Code', command: 'claude' }),
    ]);
    agentApi.getAgent.mockResolvedValue(
      createAgent({ id: 'claude', name: 'Claude Code', command: 'claude' }),
    );
    mountSection();

    const select = screen.getByRole('combobox', { name: 'Select agent' });
    await waitFor(() => expect(within(select).getAllByRole('option')).toHaveLength(2));
    await user.selectOptions(select, 'claude');
    await user.click(screen.getByRole('button', { name: 'Run with agent' }));

    await waitFor(() => expect(agentApi.getAgent).toHaveBeenCalledWith('claude'));
  });

  it('没有绑定项目：Run 置灰并说明原因（没有 tab 空间可落）', () => {
    mountSection(vi.fn(), null);

    const run = screen.getByRole('button', { name: 'Run with agent' });
    expect(run).toBeDisabled();
    expect(run).toHaveAttribute('title', 'No active project');
  });
});

describe('WorkItemRunsSection — Run with agent 全链路', () => {
  it('点一下：终端起来 → 写一条记录 → 列表刷新出这条记录', async () => {
    const user = userEvent.setup();
    mountSection();

    await user.click(screen.getByRole('button', { name: 'Run with agent' }));

    // 1) 终端真的建起来了，且命令里带着工作项的标题（指令前置）。
    await waitFor(() => expect(tabsInSpace()).toHaveLength(1));
    const [tab] = tabsInSpace();
    expect(tab.data.kind).toBe('terminal');
    if (tab.data.kind === 'terminal') {
      expect(tab.data.taskCommand).toContain('修复登录态过期');
      expect(tab.data.agentId).toBe('opencode');
    }

    // 2) 记录的指针就是这个 tab（terminal tab id，不是 PTY session id）。
    await waitFor(() => expect(api.recordWorkItemRun).toHaveBeenCalledTimes(1));
    expect(api.recordWorkItemRun).toHaveBeenCalledWith(
      expect.objectContaining({
        workItemId: 'wi_1',
        mode: 'single',
        refKind: 'session',
        refId: tab.id,
        runState: 'running',
      }),
    );

    // 3) 列表重读一次，新记录出现在 UI 上。
    await waitFor(() => expect(api.listWorkItemRuns).toHaveBeenCalledTimes(2));
    api.listWorkItemRuns.mockResolvedValue([
      run({ ref: { kind: 'session', id: tab.id, sub: null } }),
    ]);
    await user.click(screen.getByRole('button', { name: 'Refresh runs' }));

    const list = await screen.findByRole('list', { name: 'Runs' });
    expect(within(list).getByText('OpenCode')).toBeInTheDocument();

    // 4) 记录指向的 tab 还在 ⇒ Open 可点（跳转本身由下面那条用例钉住）。
    expect(within(list).getByRole('button', { name: 'Open' })).toBeEnabled();
  });

  it('记录失败：toast 报原文、终端**不回滚**，并且仍然刷新记录列表', async () => {
    const user = userEvent.setup();
    api.recordWorkItemRun.mockRejectedValue(new Error('Invalid input: only single'));
    const showToast = mountSection();

    await user.click(screen.getByRole('button', { name: 'Run with agent' }));

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        'Run started, but recording failed: Invalid input: only single',
        'error',
      ),
    );
    // 终端还在（关掉一个人的会话比没记上账更糟）。
    expect(tabsInSpace()).toHaveLength(1);
    // 刷新仍然发生：用户要能看到库里到底有没有。
    await waitFor(() => expect(api.listWorkItemRuns).toHaveBeenCalledTimes(2));
  });

  it('agent 缺命令：toast + 不建终端 + 不刷新记录', async () => {
    const user = userEvent.setup();
    agentApi.getAgent.mockResolvedValue(
      createAgent({ id: 'opencode', name: 'OpenCode', command: '' }),
    );
    const showToast = mountSection();

    await user.click(screen.getByRole('button', { name: 'Run with agent' }));

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        'That agent is not installed or has no command',
        'error',
      ),
    );
    expect(tabsInSpace()).toHaveLength(0);
    expect(api.listWorkItemRuns).toHaveBeenCalledTimes(1);
  });
});

describe('WorkItemRunsSection — 跳转按钮', () => {
  it('tab 已关闭：Open 置灰并说明「该会话已关闭」（不给一个点了没反应的按钮）', async () => {
    api.listWorkItemRuns.mockResolvedValue([run()]);
    mountSection();

    const list = await screen.findByRole('list', { name: 'Runs' });
    const open = within(list).getByRole('button', { name: 'Open' });
    expect(open).toBeDisabled();
    expect(open).toHaveAttribute('title', 'That session is closed');
  });

  it('tab 还在：Open 可点，点击切到那个 tab（tabKey 走 activeWorkspaceSession）', async () => {
    const user = userEvent.setup();
    api.listWorkItemRuns.mockResolvedValue([
      run({ ref: { kind: 'session', id: 'tab_a', sub: null } }),
    ]);
    // 先手工建两个 tab：`tab_a` 不是当前激活的那个，激活按钮才有可观测的效果。
    useEditorStore.getState().addTab({
      id: 'tab_a',
      scope: { kind: 'workspace', session: activeWorkspaceSession(PROJECT_ID as ProjectId) },
      title: 'A',
      data: { kind: 'terminal', agentId: 'opencode', status: 'Running', taskCommand: 'opencode' },
    });
    useEditorStore.getState().addTab({
      id: 'tab_b',
      scope: { kind: 'workspace', session: activeWorkspaceSession(PROJECT_ID as ProjectId) },
      title: 'B',
      data: { kind: 'terminal', agentId: 'opencode', status: 'Running', taskCommand: 'opencode' },
    });

    mountSection();

    const list = await screen.findByRole('list', { name: 'Runs' });
    const open = within(list).getByRole('button', { name: 'Open' });
    expect(open).toBeEnabled();
    await user.click(open);

    const layout = useEditorStore.getState().editorLayout[SPACE];
    expect(layout.groups[layout.activeGroupId].activeTabId).toBe('tab_a');
  });

  it('team / flow 记录没有 Open（今天没有可跳的目标，不做假按钮）', async () => {
    api.listWorkItemRuns.mockResolvedValue([
      run({ id: 'run_team', mode: 'team', ref: { kind: 'team', id: 'team_1', sub: null } }),
      run({ id: 'run_flow', mode: 'flow', ref: { kind: 'flow', id: 'flow_1', sub: null } }),
    ]);
    mountSection();

    const list = await screen.findByRole('list', { name: 'Runs' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(within(list).queryByRole('button', { name: 'Open' })).not.toBeInTheDocument();
  });
});
