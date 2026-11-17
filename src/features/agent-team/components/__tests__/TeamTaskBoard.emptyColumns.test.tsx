import { render, screen, within } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { TaskCard } from '@/shared/types/team';
import { createMemberStatus, createTaskCard } from '@/testing/factories';

import TeamTaskBoard from '../TeamTaskBoard';

/**
 * 任务板的**紧凑分组 + 空列汇总**（R5 / R12）。
 *
 * 三条不变量各自防一类回归：
 *
 * | 判据 | 违反的后果 |
 * | --- | --- |
 * | 空列不进 `role="group"`、进汇总行（仍带 `data-column` / `data-count`）| 要么空列白占 40px，要么「这一列有几行」再也读不到 |
 * | `unplaced` 仍 `role="alert"` | 后端先发一个未镜像的状态时，任务会静默消失 |
 * | 截断提示仍可见 | 面板看起来像「团队真的只有 200 个任务」|
 *
 * 另钉 R12：分组不再是边框盒子（只剩标题行 + 卡片列表）。
 */
const MEMBERS = [createMemberStatus({ memberId: 'w1@tm_1', name: 'frontend' })];

function renderBoard(
  tasks: readonly TaskCard[],
  { tasksTruncated = false }: { tasksTruncated?: boolean } = {},
): void {
  render(
    <TeamTaskBoard
      tasks={tasks}
      members={MEMBERS}
      tasksTruncated={tasksTruncated}
      onOpenTask={vi.fn()}
    />,
  );
}

function board(): HTMLElement {
  return screen.getByRole('region', { name: '共享任务板' });
}

describe('TeamTaskBoard — 空列汇总（R5）', () => {
  it('空列不进 role="group"，进汇总行且保留 data-column / data-count=0', () => {
    renderBoard([createTaskCard({ id: 't1', state: 'in_progress', owner: 'w1@tm_1' })]);

    // 进行中非空 ⇒ 仍是分组
    expect(within(board()).getByRole('group', { name: '进行中' })).toBeInTheDocument();
    // 其余四列空 ⇒ 不再各占一个分组
    for (const label of ['待认领', '待批准', '已完成', '阻塞']) {
      expect(within(board()).queryByRole('group', { name: label })).not.toBeInTheDocument();
    }

    // 「这一列有几行」这个不变量仍能读（列映射是封闭枚举，空列 ≠ 列不存在）。
    // 汇总项的可读文本就是 `<label> 0`，机器钩子 `data-column` / `data-count` 在同一个节点上。
    expect(within(board()).getByText('待认领 0')).toHaveAttribute('data-column', 'pending');
    const awaiting = within(board()).getByText('待批准 0');
    expect(awaiting).toHaveAttribute('data-column', 'awaiting_approval');
    expect(awaiting).toHaveAttribute('data-count', '0');
    expect(within(board()).getByText('已完成 0')).toHaveAttribute('data-column', 'done');
    expect(within(board()).getByText('阻塞 0')).toHaveAttribute('data-column', 'frozen');
  });

  it('全部为空 ⇒ 一行汇总（五个空列都在）、零个分组', () => {
    renderBoard([]);

    expect(within(board()).queryAllByRole('group')).toHaveLength(0);
    for (const label of ['待认领', '进行中', '待批准', '已完成', '阻塞']) {
      expect(within(board()).getByText(`${label} 0`)).toHaveAttribute('data-count', '0');
    }
  });
});

describe('TeamTaskBoard — 不静默丢任务', () => {
  it('unplaced（后端先发了未镜像的状态）仍然报警', () => {
    const ghost = {
      ...createTaskCard({ id: 't9' }),
      state: 'not_a_real_state',
    } as unknown as TaskCard;
    renderBoard([ghost]);

    const alert = within(board()).getByRole('alert');
    expect(alert).toHaveTextContent('1 个任务的状态没有对应的列');
  });

  it('截断提示仍在（只显示前 200 条）', () => {
    renderBoard([createTaskCard({ id: 't1' })], { tasksTruncated: true });

    expect(within(board()).getByRole('status')).toHaveTextContent('只显示前 200 条');
  });

  it('未截断时没有这条提示（否则提示永远亮着，等于没有提示）', () => {
    renderBoard([createTaskCard({ id: 't1' })]);
    expect(within(board()).queryByText(/只显示前/)).not.toBeInTheDocument();
  });
});

describe('TeamTaskBoard — 同列多态可区分（R6）', () => {
  it('claimed 与 in_progress 同列时，claimed 卡片带「已认领」', () => {
    renderBoard([
      createTaskCard({ id: 't1', title: '刚认领的活', state: 'claimed', owner: 'w1@tm_1' }),
      createTaskCard({ id: 't2', title: '进行中的活', state: 'in_progress', owner: 'w1@tm_1' }),
    ]);

    const column = within(board()).getByRole('group', { name: '进行中' });
    const claimed = within(column).getByRole('button', { name: /打开任务 t1/ });
    expect(within(claimed).getByText('已认领')).toBeInTheDocument();
  });

  it('单态列（已完成）不给卡片加状态 chip —— 列已经说完了', () => {
    renderBoard([createTaskCard({ id: 't1', title: '做完的活', state: 'done' })]);

    const column = within(board()).getByRole('group', { name: '已完成' });
    // 只查**卡片内部**：列标题本身就是「已完成」
    const card = within(column).getByRole('button', { name: /打开任务 t1/ });
    expect(within(card).queryByText('已完成')).not.toBeInTheDocument();
  });
});

describe('TeamTaskBoard — 分组不再是盒子（R12）', () => {
  it('分组容器没有边框 / 底色 / 内边距，但机器标识一个不少', () => {
    renderBoard([createTaskCard({ id: 't1', state: 'pending' })]);

    const column = within(board()).getByRole('group', { name: '待认领' });
    expect(column).toHaveAttribute('data-column', 'pending');
    // 结构/样式断言必须读类名 —— 这是 R12 唯一能机器验证的形态
    // eslint-disable-next-line testing-library/no-node-access -- class 结构断言
    expect(column.className).not.toMatch(/\bborder\b|\bborder-|\bbg-bg-/);
    // 计数仍在分组里（唯一来源 = 这一列的行数）
    expect(within(column).getByText('1', { selector: '[data-count]' })).toBeInTheDocument();
  });
});
