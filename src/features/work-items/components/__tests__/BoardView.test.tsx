/**
 * `BoardView`：列来自 `plan.stages`（不是写死的五列）、卡片按 store 顺序落列、列头计数、`plan=null` 不画列。
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { StagePlan, WorkItem } from '../../types';
import BoardView from '../BoardView';

/** 自定义 3 阶段：列必须跟着 plan 变（写死 Backlog…Done 会让卡片凭空消失）。 */
const PLAN: StagePlan = {
  stages: ['Todo', 'Doing', 'Done'],
  transitions: [
    { from: 'Todo', to: 'Doing' },
    { from: 'Doing', to: 'Todo' },
    { from: 'Doing', to: 'Done' },
    { from: 'Done', to: 'Doing' },
  ],
};

function item(id: string, stage: string, overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id,
    projectId: 'p1',
    title: `工作项 ${id}`,
    body: '',
    stage,
    priority: null,
    labels: [],
    assignee: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

/**
 * store 给的顺序（`updatedAt DESC`）：`wi_3` 最新，其次 `wi_2`、`wi_1`。
 * 渲染层不得重排，所以列内顺序必须与这个数组一致。
 */
const ITEMS: WorkItem[] = [item('wi_3', 'Todo'), item('wi_2', 'Doing'), item('wi_1', 'Todo')];

describe('BoardView — 列来自 plan', () => {
  it('按 plan.stages 画列，而不是写死五列', () => {
    render(
      <BoardView
        plan={PLAN}
        planLoading={false}
        items={ITEMS}
        onOpen={vi.fn()}
        onMove={vi.fn()}
        onAdd={vi.fn()}
      />,
    );

    expect(screen.getAllByRole('region', { name: / 列$/ })).toHaveLength(3);
    expect(screen.getByRole('region', { name: 'Todo 列' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Doing 列' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Done 列' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Backlog 列' })).not.toBeInTheDocument();
  });

  it('卡片落在自己的 stage 列里，且保持 store 顺序', () => {
    render(
      <BoardView
        plan={PLAN}
        planLoading={false}
        items={ITEMS}
        onOpen={vi.fn()}
        onMove={vi.fn()}
        onAdd={vi.fn()}
      />,
    );

    const todo = screen.getByRole('region', { name: 'Todo 列' });
    const cards = within(todo).getAllByRole('button', { name: /打开工作项/ });
    expect(cards.map((card) => card.getAttribute('data-work-item-id'))).toEqual(['wi_3', 'wi_1']);

    const doing = screen.getByRole('region', { name: 'Doing 列' });
    expect(
      within(doing)
        .getAllByRole('button', { name: /打开工作项/ })
        .map((c) => c.dataset.workItemId),
    ).toEqual(['wi_2']);

    // 空列：占位文字，不是「一条都没有却什么都不说」。
    expect(
      within(screen.getByRole('region', { name: 'Done 列' })).getByText('暂无工作项'),
    ).toBeInTheDocument();
  });

  it('列头显示 stage + 该列数量', () => {
    render(
      <BoardView
        plan={PLAN}
        planLoading={false}
        items={ITEMS}
        onOpen={vi.fn()}
        onMove={vi.fn()}
        onAdd={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Todo 阶段，共 2 条' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Doing 阶段，共 1 条' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Done 阶段，共 0 条' })).toBeInTheDocument();
  });

  it('列底部 + Add 带上该列的 stage', async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    render(
      <BoardView
        plan={PLAN}
        planLoading={false}
        items={ITEMS}
        onOpen={vi.fn()}
        onMove={vi.fn()}
        onAdd={onAdd}
      />,
    );

    await user.click(screen.getByRole('button', { name: '在 Doing 新建工作项' }));
    expect(onAdd).toHaveBeenCalledExactlyOnceWith('Doing');
  });
});

describe('BoardView — 没有阶段轨', () => {
  it('plan 为 null 时不画任何列，只显示占位', () => {
    render(
      <BoardView
        plan={null}
        planLoading={false}
        items={ITEMS}
        onOpen={vi.fn()}
        onMove={vi.fn()}
        onAdd={vi.fn()}
      />,
    );

    expect(screen.queryAllByRole('region', { name: / 列$/ })).toHaveLength(0);
    expect(screen.getByRole('status')).toHaveTextContent('阶段轨不可用');
  });

  it('plan 还在拉时占位文案说「加载中」（不谎报不可用）', () => {
    render(
      <BoardView
        plan={null}
        planLoading
        items={ITEMS}
        onOpen={vi.fn()}
        onMove={vi.fn()}
        onAdd={vi.fn()}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('阶段轨加载中…');
  });
});

describe('BoardView — 阶段不在阶段轨里的工作项', () => {
  it('不猜位置，而是报告条数', () => {
    render(
      <BoardView
        plan={PLAN}
        planLoading={false}
        items={[item('wi_9', 'Archived')]}
        onOpen={vi.fn()}
        onMove={vi.fn()}
        onAdd={vi.fn()}
      />,
    );

    expect(screen.getByText('1 条工作项的阶段不在阶段轨中')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /打开工作项/ })).not.toBeInTheDocument();
  });
});

describe('BoardView — 右键 Move to 透传到宿主（design §11.5 方式三）', () => {
  it('卡片右键选中的 stage 带着该卡片 id 交给宿主（Board → Column → Card 的接线）', async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    render(
      <BoardView
        plan={PLAN}
        planLoading={false}
        items={[item('wi_2', 'Doing')]}
        onOpen={vi.fn()}
        onMove={onMove}
        onAdd={vi.fn()}
      />,
    );

    fireEvent.contextMenu(screen.getByRole('button', { name: '打开工作项 工作项 wi_2' }));
    const menu = await screen.findByRole('menu');
    await user.click(within(menu).getByRole('menuitem', { name: 'Done' }));

    expect(onMove).toHaveBeenCalledWith('wi_2', 'Done');
  });
});
