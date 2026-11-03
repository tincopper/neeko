/**
 * `WorkItemDetail`：字段渲染、阶段轨、执行区（三入口置灰 + 一行原因 + 记录/空态/陈旧标记）、
 * 删除动作。
 *
 * 只 mock **api 层**：本组件唯一的数据副作用是 `listWorkItemRuns`（执行记录），它不该在测试里
 * 打真 IPC。
 *
 * 陈旧标记的用例把 `Date.now` 钉住（`mockReturnValue`）：「现在」是这条判据的第二个输入，
 * 用真时钟写 `capturedAt = Date.now() - 90_000` 也能过，但那是在测时钟而不是测判据。
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  getStagePlan: vi.fn(),
  listWorkItems: vi.fn(),
  createWorkItem: vi.fn(),
  updateWorkItem: vi.fn(),
  transitionWorkItem: vi.fn(),
  deleteWorkItem: vi.fn(),
  listWorkItemRuns: vi.fn(),
  recordWorkItemRun: vi.fn(),
}));

/** agent 列表：详情里的执行区会拉它来填下拉（本文件不测下拉行为，只求不打真 IPC）。 */
const agentApi = vi.hoisted(() => ({ listAgents: vi.fn() }));

vi.mock('../../api/workItemsApi', () => api);
vi.mock('../../../agent/api/agentApi', () => agentApi);

import type { StagePlan, WorkItem, WorkItemRun } from '../../types';
import WorkItemDetail from '../WorkItemDetail';

const PLAN: StagePlan = {
  stages: ['Backlog', 'Ready', 'In Progress', 'Review', 'Done'],
  transitions: [
    { from: 'Backlog', to: 'Ready' },
    { from: 'Ready', to: 'In Progress' },
    { from: 'In Progress', to: 'Review' },
    { from: 'Review', to: 'Done' },
  ],
};

function item(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: 'wi_1',
    projectId: 'p1',
    title: '修复登录态过期',
    body: '第一行\n第二行',
    stage: 'In Progress',
    priority: 'p1',
    labels: ['bug', 'auth'],
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
    ref: { kind: 'session', id: 'term_1', sub: null },
    snapshot: { state: 'running', label: 'claude · 正在写测试', capturedAt: 1_700_000_000_000 },
    createdAt: 1,
    ...overrides,
  };
}

interface Handlers {
  onMove: ReturnType<typeof vi.fn>;
  onEdit: ReturnType<typeof vi.fn>;
  onDelete: ReturnType<typeof vi.fn>;
  onClose: ReturnType<typeof vi.fn>;
  showToast: ReturnType<typeof vi.fn>;
}

function renderDetail(overrides: Partial<WorkItem> = {}): Handlers {
  const handlers: Handlers = {
    onMove: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onClose: vi.fn(),
    showToast: vi.fn(),
  };
  render(
    <WorkItemDetail
      item={item(overrides)}
      plan={PLAN}
      projectId="p1"
      showToast={handlers.showToast}
      onMove={handlers.onMove}
      onEdit={handlers.onEdit}
      onDelete={handlers.onDelete}
      onClose={handlers.onClose}
    />,
  );
  return handlers;
}

beforeEach(() => {
  api.listWorkItemRuns.mockReset();
  api.listWorkItemRuns.mockResolvedValue([]);
  agentApi.listAgents.mockReset();
  agentApi.listAgents.mockResolvedValue([]);
});

afterEach(() => {
  // `Date.now` 的 spy 必须还原：不还原会让后续用例（以及别的测试文件里的同进程）看不到真时钟。
  vi.restoreAllMocks();
});

describe('WorkItemDetail — 字段', () => {
  it('渲染标题 / 优先级 / 标签 / 负责人 / 描述，并把 stage 画在阶段轨上', async () => {
    renderDetail();

    const detail = screen.getByRole('region', { name: '工作项详情' });
    expect(within(detail).getByRole('heading', { name: '修复登录态过期' })).toBeInTheDocument();
    expect(within(detail).getByText('P1')).toBeInTheDocument();
    expect(within(detail).getByText('bug')).toBeInTheDocument();
    expect(within(detail).getByText('tincopper')).toBeInTheDocument();
    // 纯文本按行渲染：两行都在（`pre-wrap` 保留换行，testing-library 的默认归一化会把换行变空格），
    // 不解析成 markdown。
    expect(within(detail).getByText('第一行 第二行')).toBeInTheDocument();

    const rail = within(detail).getByRole('group', { name: '阶段轨道' });
    expect(within(rail).getByRole('button', { name: 'In Progress' })).toHaveAttribute(
      'aria-current',
      'step',
    );

    expect(await within(detail).findByText('还没有执行记录')).toBeInTheDocument();
  });

  it('未设置的字段显示占位，不显示假的 P3 / 空标签', async () => {
    renderDetail({ priority: null, assignee: null, labels: [], body: '' });

    const detail = screen.getByRole('region', { name: '工作项详情' });
    expect(within(detail).getByText('未设置')).toBeInTheDocument();
    expect(within(detail).getByText('未指派')).toBeInTheDocument();
    expect(within(detail).getByText('（无描述）')).toBeInTheDocument();
    expect(within(detail).queryByText('P3')).not.toBeInTheDocument();

    expect(await within(detail).findByText('还没有执行记录')).toBeInTheDocument();
  });
});

describe('WorkItemDetail — 执行区', () => {
  it('三个执行入口都可见：Run with agent 可点，另两档置灰且各自写明原因', async () => {
    renderDetail();

    expect(screen.getByRole('button', { name: 'Run with agent' })).toBeEnabled();
    for (const label of ['Dispatch to team', 'Run flow…']) {
      expect(screen.getByRole('button', { name: label })).toBeDisabled();
    }
    // 两档不可用的理由不同，所以不共用一句话。
    expect(screen.getByText(/派给团队：/)).toBeInTheDocument();
    expect(screen.getByText(/固定流程引擎未实现/)).toBeInTheDocument();

    expect(await screen.findByText('还没有执行记录')).toBeInTheDocument();
  });

  it('渲染执行记录：mode 徽标 + 状态 + 摘要', async () => {
    api.listWorkItemRuns.mockResolvedValue([run()]);
    renderDetail();

    expect(await screen.findByText('single')).toBeInTheDocument();
    expect(screen.getByText('运行中')).toBeInTheDocument();
    expect(screen.getByText('claude · 正在写测试')).toBeInTheDocument();
    expect(screen.queryByText('还没有执行记录')).not.toBeInTheDocument();
  });

  it('读取失败时原文照抄，字段区不受影响', async () => {
    api.listWorkItemRuns.mockRejectedValue(new Error('run store is corrupted'));
    renderDetail();

    expect(await screen.findByText('run store is corrupted')).toBeInTheDocument();
    expect(screen.getByText('P1')).toBeInTheDocument();
  });

  it('快照超阈标「· 已过期」，未超阈的不标（阈值 60s，一处定义）', async () => {
    const now = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    api.listWorkItemRuns.mockResolvedValue([
      run({
        id: 'run_old',
        snapshot: { state: 'done', label: '旧快照', capturedAt: now - 90_000 },
      }),
      run({
        id: 'run_new',
        snapshot: { state: 'running', label: '新快照', capturedAt: now - 5_000 },
      }),
    ]);
    renderDetail();

    // 按行断言（而不是按文本找元素再爬 DOM）：标记属于**那一行**，不是整块执行区。
    const list = await screen.findByRole('list', { name: '执行记录' });
    const [oldRow, newRow] = within(list).getAllByRole('listitem');

    expect(within(oldRow).getByText('旧快照')).toBeInTheDocument();
    expect(within(oldRow).getByText('· 已过期')).toHaveAttribute('data-stale', 'true');

    // 新快照那一行没有标记 —— 否则「已过期」变成每行都有的噪声。
    expect(within(newRow).getByText('新快照')).toBeInTheDocument();
    expect(within(newRow).queryByText('· 已过期')).not.toBeInTheDocument();
  });

  it('点↻ 重读时钟：时间走过去之后同一枚快照才标过期', async () => {
    const user = userEvent.setup();
    let now = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    // 快照时间落在「现在」之后 30 秒（时钟回拨 / 跨机快照的形状）⇒ 首帧不算过期。
    api.listWorkItemRuns.mockResolvedValue([
      run({ snapshot: { state: 'running', label: '待观察', capturedAt: now + 30_000 } }),
    ]);
    renderDetail();

    expect(await screen.findByText('待观察')).toBeInTheDocument();
    expect(screen.queryByText('· 已过期')).not.toBeInTheDocument();

    // 两分钟后再刷新：同一个 capturedAt 已经超出阈值 ⇒ 标记出现（刷新会重读时钟）。
    now += 120_000;
    await user.click(screen.getByRole('button', { name: '刷新执行记录' }));

    expect(await screen.findByText('· 已过期')).toBeInTheDocument();
  });
});

describe('WorkItemDetail — 动作条', () => {
  it('点「删除」触发 onDelete；点阶段轨的可流转节点触发 onMove', async () => {
    const user = userEvent.setup();
    const { onDelete, onMove } = renderDetail();

    await user.click(screen.getByRole('button', { name: '删除' }));
    expect(onDelete).toHaveBeenCalledTimes(1);

    // Review 与 In Progress 相邻 ⇒ reachable（判据来自后端下发的 transitions）。
    await user.click(screen.getByRole('button', { name: 'Review' }));
    expect(onMove).toHaveBeenCalledExactlyOnceWith('Review');
  });
});
