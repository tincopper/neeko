/**
 * `useRunSingleWorkItem`：`Run with agent` 的动作面。
 *
 * 只 mock **三个端口**（agent 配置 / terminal 端口 / work items api），不 mock 项目 store：
 * 「缺省 agent 从哪来」正是本 hook 的一条判据，mock 掉它就只能测到「我们调用了自己写的函数」。
 *
 * 这里钉住的几件事都无法从别处推出：
 * 1. `refId` 用的是**我们自己 mint 的 tabId**（不是 create 端口内部生成的 id）—— 记录指向的
 *    终端必须就是刚建的那一个；
 * 2. 记录失败**不回滚终端**，且仍然回报「已发起」（调用方据此刷新记录，用户才知道账到底记没记上）；
 * 3. 连点只开一个终端（同一 tick 的两次点击，`setState` 还没生效）。
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const agentApi = vi.hoisted(() => ({ getAgent: vi.fn() }));
const terminalApi = vi.hoisted(() => ({ createTaskTerminal: vi.fn() }));
const workItemsApi = vi.hoisted(() => ({ recordWorkItemRun: vi.fn() }));

vi.mock('../../../agent/api/agentApi', () => agentApi);
vi.mock('../../../terminal/api/taskTerminal', () => terminalApi);
vi.mock('../../api/workItemsApi', () => workItemsApi);

import { useProjectStore } from '@/shared/store/projectStore';
import type { ProjectId } from '@/shared/utils/workspaceRef';
import { createAgent, createProject } from '@/testing/factories';

import type { WorkItem } from '../../types';
import { defaultAgentIdForProject, useRunSingleWorkItem } from '../useRunSingleWorkItem';

const PROJECT_ID = 'p1';

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

function bindProject(selectedAgents: string[]): void {
  const project = createProject({
    id: PROJECT_ID as ProjectId,
    selected_agents: selectedAgents,
  });
  useProjectStore.setState({
    projects: [project],
    activeProjectId: PROJECT_ID as ProjectId,
    activeProject: project,
  });
}

beforeEach(() => {
  agentApi.getAgent.mockReset();
  terminalApi.createTaskTerminal.mockReset();
  workItemsApi.recordWorkItemRun.mockReset();
  useProjectStore.setState({ projects: [], activeProjectId: null, activeProject: null });

  bindProject(['opencode']);
  agentApi.getAgent.mockResolvedValue(createAgent({ id: 'opencode', name: 'OpenCode' }));
  // 端口返回的新 tab id 就是执行记录的 `ref.id`（它不再是本 hook 自己 mint 的）。
  terminalApi.createTaskTerminal.mockReturnValue('tab_minted');
  workItemsApi.recordWorkItemRun.mockResolvedValue({ id: 'run_1' });
});

describe('useRunSingleWorkItem — 成功链路', () => {
  it('开终端 → 写一条 single 记录，记录里的 refId 就是刚建的那个 tab', async () => {
    const { result } = renderHook(() => useRunSingleWorkItem(PROJECT_ID, () => {}));

    let launched: boolean | undefined;
    await act(async () => {
      launched = await result.current.run(item());
    });

    expect(launched).toBe(true);
    // 缺省 agent 来自项目的 selected_agents[0]。
    expect(agentApi.getAgent).toHaveBeenCalledWith('opencode');
    // 终端：命令是「CLI + 指令」；端口把新 tab 的 id 交回来，记录就用它。
    const [, options] = terminalApi.createTaskTerminal.mock.calls[0];
    expect(terminalApi.createTaskTerminal.mock.calls[0][0]).toBe(PROJECT_ID);
    expect(options).toMatchObject({ agentId: 'opencode', agentName: 'OpenCode' });
    expect(options.taskCommand).toContain("'");
    expect(options.taskCommand).toContain('修复登录态过期');

    expect(workItemsApi.recordWorkItemRun).toHaveBeenCalledExactlyOnceWith({
      workItemId: 'wi_1',
      mode: 'single',
      refKind: 'session',
      refId: 'tab_minted',
      runState: 'running',
      label: 'OpenCode',
    });
  });

  it('入参 agentId 覆盖项目缺省', async () => {
    agentApi.getAgent.mockResolvedValue(createAgent({ id: 'claude', name: 'Claude Code' }));
    const { result } = renderHook(() => useRunSingleWorkItem(PROJECT_ID, () => {}));

    await act(async () => {
      await result.current.run(item(), 'claude');
    });

    expect(agentApi.getAgent).toHaveBeenCalledWith('claude');
    expect(workItemsApi.recordWorkItemRun).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'Claude Code' }),
    );
  });

  it('agent 没有名字：终端标题交给端口回落，记录 label 用 agent id（不能是一条空摘要）', async () => {
    agentApi.getAgent.mockResolvedValue(createAgent({ id: 'opencode', name: '' }));
    const { result } = renderHook(() => useRunSingleWorkItem(PROJECT_ID, () => {}));

    await act(async () => {
      await result.current.run(item());
    });

    const [, options] = terminalApi.createTaskTerminal.mock.calls[0];
    expect(options.agentName).toBeUndefined();
    expect(workItemsApi.recordWorkItemRun).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'opencode' }),
    );
  });

  it('launching 在期间为 true、结束后归 false（按钮据此禁用）', async () => {
    let release: (value: unknown) => void = () => {};
    agentApi.getAgent.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const { result } = renderHook(() => useRunSingleWorkItem(PROJECT_ID, () => {}));

    let pending: Promise<boolean> | undefined;
    act(() => {
      pending = result.current.run(item());
    });
    await waitFor(() => expect(result.current.launching).toBe(true));

    await act(async () => {
      release(createAgent({ id: 'opencode', name: 'OpenCode' }));
      await pending;
    });
    expect(result.current.launching).toBe(false);
  });
});

describe('useRunSingleWorkItem — 失败链路', () => {
  it('No active project：toast 一次并返回 false（不建终端、不写记录）', async () => {
    const showToast = vi.fn();
    const { result } = renderHook(() => useRunSingleWorkItem(null, showToast));

    let launched: boolean | undefined;
    await act(async () => {
      launched = await result.current.run(item());
    });

    expect(launched).toBe(false);
    expect(showToast).toHaveBeenCalledExactlyOnceWith(
      'No active project; cannot start a run',
      'error',
    );
    expect(terminalApi.createTaskTerminal).not.toHaveBeenCalled();
    expect(workItemsApi.recordWorkItemRun).not.toHaveBeenCalled();
  });

  it('agent 没有命令（或未安装）：toast 并返回 false', async () => {
    const showToast = vi.fn();
    agentApi.getAgent.mockResolvedValue(createAgent({ id: 'mockAgent', command: '  ' }));
    const { result } = renderHook(() => useRunSingleWorkItem(PROJECT_ID, showToast));

    let launched: boolean | undefined;
    await act(async () => {
      launched = await result.current.run(item());
    });

    expect(launched).toBe(false);
    expect(showToast).toHaveBeenCalledExactlyOnceWith(
      'That agent is not installed or has no command',
      'error',
    );
    expect(terminalApi.createTaskTerminal).not.toHaveBeenCalled();
  });

  it('getAgent 抛错与「没有命令」同一句话（两种来源都要能开不出会话）', async () => {
    const showToast = vi.fn();
    agentApi.getAgent.mockRejectedValue('agent not found');
    const { result } = renderHook(() => useRunSingleWorkItem(PROJECT_ID, showToast));

    await act(async () => {
      await result.current.run(item());
    });

    expect(showToast).toHaveBeenCalledExactlyOnceWith(
      'That agent is not installed or has no command',
      'error',
    );
  });

  it('终端配额满（端口返回 null）：toast 并返回 false，不写记录', async () => {
    const showToast = vi.fn();
    terminalApi.createTaskTerminal.mockReturnValue(null);
    const { result } = renderHook(() => useRunSingleWorkItem(PROJECT_ID, showToast));

    let launched: boolean | undefined;
    await act(async () => {
      launched = await result.current.run(item());
    });

    expect(launched).toBe(false);
    expect(showToast).toHaveBeenCalledExactlyOnceWith(
      'Terminal limit reached; close some terminals first',
      'error',
    );
    expect(workItemsApi.recordWorkItemRun).not.toHaveBeenCalled();
  });

  it('记录失败：toast 报原文、**不回滚终端**，并回报 true（调用方要刷新记录）', async () => {
    const showToast = vi.fn();
    workItemsApi.recordWorkItemRun.mockRejectedValue(new Error('Invalid input: nope'));
    const { result } = renderHook(() => useRunSingleWorkItem(PROJECT_ID, showToast));

    let launched: boolean | undefined;
    await act(async () => {
      launched = await result.current.run(item());
    });

    expect(launched).toBe(true);
    expect(showToast).toHaveBeenCalledExactlyOnceWith(
      'Run started, but recording failed: Invalid input: nope',
      'error',
    );
    // 终端只建了一次、没有被「回滚」（端口没有关闭入口，唯一能做错的补救是再建一个）。
    expect(terminalApi.createTaskTerminal).toHaveBeenCalledTimes(1);
  });

  it('连点：同一 tick 的第二次直接返回 false，不开第二个终端', async () => {
    const { result } = renderHook(() => useRunSingleWorkItem(PROJECT_ID, () => {}));

    let first: Promise<boolean> | undefined;
    let second: Promise<boolean> | undefined;
    await act(async () => {
      first = result.current.run(item());
      second = result.current.run(item());
      await Promise.all([first, second]);
    });

    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(false);
    expect(terminalApi.createTaskTerminal).toHaveBeenCalledTimes(1);
    expect(workItemsApi.recordWorkItemRun).toHaveBeenCalledTimes(1);
  });
});

describe('defaultAgentIdForProject', () => {
  it('项目的 selected_agents[0] 优先', () => {
    bindProject(['claude', 'opencode']);
    expect(defaultAgentIdForProject(PROJECT_ID)).toBe('claude');
  });

  it('项目里没有这一条时回落 activeProject（dock 切项目的那一帧）', () => {
    bindProject(['opencode']);
    expect(defaultAgentIdForProject('p_other')).toBe('opencode');
  });

  it('项目没配 agent / 没有项目：回落 opencode（不是空串）', () => {
    bindProject([]);
    expect(defaultAgentIdForProject(PROJECT_ID)).toBe('opencode');
    expect(defaultAgentIdForProject(null)).toBe('opencode');

    useProjectStore.setState({ projects: [], activeProject: null });
    expect(defaultAgentIdForProject(PROJECT_ID)).toBe('opencode');
  });
});
