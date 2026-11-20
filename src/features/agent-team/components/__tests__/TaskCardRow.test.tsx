import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { MemberStatusView, TaskCard } from '@/shared/types/team';
import { createMemberStatus, createTaskCard } from '@/testing/factories';

import TaskCardRow from '../TaskCardRow';

/**
 * 任务卡片的**信息取舍**（R6 / R7）。
 *
 * 三条判据，每条都对应一处真实噪音：
 *
 * | 判据 | 反例 |
 * | --- | --- |
 * | 状态 chip 只在列说不清状态时渲染（`showState`）| 卡片上「进行中」与它所在的「进行中」列说两遍 |
 * | 缺省工作区（`shared`）不出 chip | 每张卡都写「共享工作区」，一整列噪音 |
 * | 可见 `task.id` / `依赖 N` 不渲染 | id 只在队内唯一、依赖数属于详情（仍在 `aria-label` / `data-task-id`）|
 *
 * 另外钉住「成员已空闲但没人认可完成」（design §6 硬规则 1 的 UI 侧）：只在**未终结**任务
 * 上、且持有者处于 `idle+unverified` / `stalled` / `offline` / `failed` 时才占一行 ——
 * `运行中` / `待批准` 在花名册与列上已经说过了。
 */

const w1 = { memberId: 'w1@tm_1', name: 'w1' } as unknown as MemberStatusView;

function renderCard(
  task: TaskCard,
  {
    assignee = w1,
    owner = null,
    showState = true,
    onOpen = () => {},
    onRetry,
  }: {
    assignee?: MemberStatusView | null;
    owner?: MemberStatusView | null;
    showState?: boolean;
    onOpen?: (teamId: string, taskId: string, title: string) => void;
    onRetry?: (task: TaskCard) => void;
  } = {},
): void {
  render(
    <TaskCardRow
      task={task}
      owner={owner}
      assignee={assignee}
      now={0}
      showState={showState}
      onOpen={onOpen}
      onRetry={onRetry}
    />,
  );
}

describe('TaskCardRow — 已指派标签', () => {
  it('未认领但有指派 ⇒ 显示「已指派 · {name}」', () => {
    renderCard(createTaskCard({ id: 't1', assignee: 'w1@tm_1' }));
    expect(screen.getByText('Assigned · w1')).toBeInTheDocument();
  });

  it('已认领 ⇒ 不显示指派标签（持有者 chip 已经是「谁在做」）', () => {
    renderCard(
      createTaskCard({ id: 't1', assignee: 'w1@tm_1', owner: 'w1@tm_1', state: 'claimed' }),
      { owner: w1 },
    );
    expect(screen.queryByText(/Assigned/)).not.toBeInTheDocument();
  });

  it('未指派且未认领 ⇒ 什么都不显示', () => {
    renderCard(createTaskCard({ id: 't1' }), { assignee: null });
    expect(screen.queryByText(/Assigned/)).not.toBeInTheDocument();
  });

  it('指派者不在花名册里 ⇒ 不猜名字（与 owner 的「查不到就不显示」同一纪律）', () => {
    renderCard(createTaskCard({ id: 't1', assignee: 'gone@tm_1' }), { assignee: null });
    expect(screen.queryByText(/Assigned/)).not.toBeInTheDocument();
  });
});

describe('TaskCardRow — 重试动作', () => {
  it('failed 卡渲染重试按钮，点击回调带完整任务（且不触发打开详情）', () => {
    const onRetry = vi.fn();
    const onOpen = vi.fn();
    const task = createTaskCard({ id: 't9', state: 'failed' });
    renderCard(task, { onOpen, onRetry });
    fireEvent.click(screen.getByRole('button', { name: 'Retry task t9' }));
    expect(onRetry).toHaveBeenCalledWith(task);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('不可重试（pending）卡没有重试按钮 —— 不做灰按钮', () => {
    renderCard(createTaskCard({ id: 't1' }), { onRetry: () => {} });
    expect(screen.queryByRole('button', { name: /Retry task/ })).not.toBeInTheDocument();
  });

  it('宿主没接重试动作 ⇒ 可重试状态也不渲染（不承诺一个没接线的动作）', () => {
    renderCard(createTaskCard({ id: 't1', state: 'blocked' }), { onRetry: undefined });
    expect(screen.queryByRole('button', { name: /Retry task/ })).not.toBeInTheDocument();
  });
});

describe('TaskCardRow — 状态 chip 只在列说不清时出现（R6）', () => {
  it('showState=false ⇒ 卡片上不重复列标签', () => {
    renderCard(createTaskCard({ id: 't1', state: 'in_progress' }), { showState: false });

    // 列已经写「In progress」，卡片再说一遍是纯噪音
    expect(screen.queryByText('In progress')).not.toBeInTheDocument();
  });

  it('showState=true ⇒ 渲染状态文案（同列多态：已认领 vs 进行中）', () => {
    renderCard(createTaskCard({ id: 't1', state: 'claimed' }), { showState: true });
    expect(screen.getByText('Claimed')).toBeInTheDocument();
  });
});

describe('TaskCardRow — 卡片上不再重复的信息（R7）', () => {
  it('缺省工作区（shared）不出 chip；worktree 仍出（末段）', () => {
    renderCard(createTaskCard({ id: 't1', workspace: 'shared' }));
    expect(screen.queryByText('Shared workspace')).not.toBeInTheDocument();
    expect(screen.queryByText(/worktree/)).not.toBeInTheDocument();

    renderCard(createTaskCard({ id: 't2', workspace: { worktree: { path: '/repo/wt/feat-x' } } }));
    expect(screen.getByText('worktree feat-x')).toBeInTheDocument();
  });

  it('task.id 不可见（它属于详情），但可访问名与 data-task-id 仍在', () => {
    renderCard(createTaskCard({ id: 't1', title: '登录页骨架' }));

    expect(screen.queryByText('t1')).not.toBeInTheDocument();
    const card = screen.getByRole('button', { name: 'Open task t1 details: 登录页骨架' });
    expect(card).toHaveAttribute('data-task-id', 't1');
  });

  it('依赖数不渲染（属于详情，不在 300px 的列里占位）', () => {
    renderCard(createTaskCard({ id: 't1', dependsOn: ['t2', 't3'] }));
    expect(screen.queryByText(/Depends/)).not.toBeInTheDocument();
  });

  it('被回收次数与摘要截断仍必须说出来（它们改变用户该不该重试 / 去详情看）', () => {
    renderCard(
      createTaskCard({ id: 't1', state: 'failed', reclaimCount: 2, summaryTruncated: true }),
    );
    expect(screen.getByText('Reclaimed 2 times')).toBeInTheDocument();
    expect(screen.getByText('Summary truncated')).toBeInTheDocument();
  });
});

describe('TaskCardRow — 「成员已空闲但没人认可完成」（design §6 硬规则 1）', () => {
  const unverified = createMemberStatus({
    memberId: 'w1@tm_1',
    name: 'frontend',
    state: 'idle',
    verification: 'unverified',
  });

  it('未终结任务 + idle+unverified ⇒ 可见「Idle ⚠ unverified」', () => {
    renderCard(createTaskCard({ id: 't1', state: 'in_progress', owner: 'w1@tm_1' }), {
      owner: unverified,
    });
    expect(screen.getByText('Idle ⚠ unverified')).toBeInTheDocument();
  });

  it.each(['stalled', 'offline', 'failed'] as const)(
    '未终结任务 + 持有者 %s ⇒ 仍然报出来（默认不可观测不等于可以不说）',
    (state) => {
      renderCard(createTaskCard({ id: 't1', state: 'in_progress', owner: 'w1@tm_1' }), {
        owner: createMemberStatus({ memberId: 'w1@tm_1', name: 'frontend', state }),
      });
      expect(screen.getByText(/Possibly waiting for input|Exited|Failed/)).toBeInTheDocument();
    },
  );

  it('已终结任务（done）⇒ 不渲染持有者状态（列已经说完）', () => {
    renderCard(createTaskCard({ id: 't1', state: 'done', owner: 'w1@tm_1' }), {
      owner: unverified,
    });
    expect(screen.queryByText('Idle ⚠ unverified')).not.toBeInTheDocument();
  });

  it('持有者只是运行中 / 待批准 ⇒ 不重复花名册已经说过的状态', () => {
    for (const state of ['running', 'awaiting'] as const) {
      renderCard(createTaskCard({ id: 't1', state: 'in_progress', owner: 'w1@tm_1' }), {
        owner: createMemberStatus({ memberId: 'w1@tm_1', name: 'frontend', state }),
      });
      expect(screen.queryByText(/Idle ⚠ unverified/)).not.toBeInTheDocument();
      expect(screen.queryByText('Running')).not.toBeInTheDocument();
      expect(screen.queryByText('Awaiting approval')).not.toBeInTheDocument();
    }
  });
});

describe('TaskCardRow — 租约并入 chip 行', () => {
  it('有租约时显示剩余时间（不再单起一行）', () => {
    renderCard(
      createTaskCard({
        id: 't1',
        state: 'in_progress',
        claimedAt: 1_000_000,
        leaseTtl: 1800,
      }),
      { assignee: null },
    );
    // now=0 ⇒ claimedAt + ttl 远在未来；文案与花名册 / 抽屉同一份（`utils/leaseText`）
    expect(screen.getByText(/Lease/)).toBeInTheDocument();
  });
});
