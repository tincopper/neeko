import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { MemberStatusView } from '@/shared/types/team';
import { createTaskCard } from '@/testing/factories';

import TaskCardRow from '../TaskCardRow';

/**
 * 任务卡片的「已指派」标签（R4 的看板面）。
 *
 * 规则只有一条：`owner` 为空且 `assignee` 有值时显示「已指派 · {name}」，**否则维持现状**
 * —— 300px 的看板列里不许同时出现持有者 chip 与指派 label（两张标签说的是两件事，
 * 挤在一起只会让用户以为板上有两个人在干这活）。
 */

const w1 = { memberId: 'w1@tm_1', name: 'w1' } as unknown as MemberStatusView;

const renderCard = (
  task: ReturnType<typeof createTaskCard>,
  assignee: MemberStatusView | null = w1,
  owner: MemberStatusView | null = null,
): void => {
  render(<TaskCardRow task={task} owner={owner} assignee={assignee} now={0} onOpen={() => {}} />);
};

describe('TaskCardRow — 已指派标签', () => {
  it('未认领但有指派 ⇒ 显示「已指派 · {name}」', () => {
    renderCard(createTaskCard({ id: 't1', assignee: 'w1@tm_1' }));
    expect(screen.getByText('已指派 · w1')).toBeInTheDocument();
  });

  it('已认领 ⇒ 不显示指派标签（持有者 chip 已经是「谁在做」）', () => {
    renderCard(
      createTaskCard({ id: 't1', assignee: 'w1@tm_1', owner: 'w1@tm_1', state: 'claimed' }),
      w1,
      w1,
    );
    expect(screen.queryByText(/已指派/)).not.toBeInTheDocument();
  });

  it('未指派且未认领 ⇒ 什么都不显示', () => {
    renderCard(createTaskCard({ id: 't1' }), null);
    expect(screen.queryByText(/已指派/)).not.toBeInTheDocument();
  });

  it('指派者不在花名册里 ⇒ 不猜名字（与 owner 的「查不到就不显示」同一纪律）', () => {
    renderCard(createTaskCard({ id: 't1', assignee: 'gone@tm_1' }), null);
    expect(screen.queryByText(/已指派/)).not.toBeInTheDocument();
  });
});

describe('TaskCardRow — 重试动作', () => {
  it('failed 卡渲染重试按钮，点击回调带完整任务（且不触发打开详情）', () => {
    const onRetry = vi.fn();
    const onOpen = vi.fn();
    const task = createTaskCard({ id: 't9', state: 'failed' });
    render(
      <TaskCardRow
        task={task}
        owner={null}
        assignee={null}
        now={0}
        onOpen={onOpen}
        onRetry={onRetry}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '重试任务 t9' }));
    expect(onRetry).toHaveBeenCalledWith(task);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('不可重试（pending）卡没有重试按钮 —— 不做灰按钮', () => {
    render(
      <TaskCardRow
        task={createTaskCard({ id: 't1' })}
        owner={null}
        assignee={null}
        now={0}
        onOpen={() => {}}
        onRetry={() => {}}
      />,
    );
    expect(screen.queryByRole('button', { name: /重试任务/ })).not.toBeInTheDocument();
  });

  it('宿主没接重试动作 ⇒ 可重试状态也不渲染（不承诺一个没接线的动作）', () => {
    render(
      <TaskCardRow
        task={createTaskCard({ id: 't1', state: 'blocked' })}
        owner={null}
        assignee={null}
        now={0}
        onOpen={() => {}}
      />,
    );
    expect(screen.queryByRole('button', { name: /重试任务/ })).not.toBeInTheDocument();
  });
});
