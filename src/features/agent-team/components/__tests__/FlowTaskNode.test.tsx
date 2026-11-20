import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';

import type { TaskCard } from '@/shared/types/team';
import { createTaskCard } from '@/testing/factories';

import FlowTaskNode from '../FlowTaskNode';

/**
 * 第 2 轮 #1 的判据：「谁该做」（计划事实）与「谁在做」（执行事实）是**两行**，
 * 各自独立推导，绝不写 `assignee ?? owner` —— 那会把 owner 吃掉（本轮的根因）。
 *
 * 确切文案来自 design §8 的四行表。`getByText` 是精确匹配：两行必须是两个不同的
 * `<text>`，合成一行时两条查询都会失败，而不是只挂掉一条。
 */
function renderNode(overrides: Partial<TaskCard>): void {
  render(
    <svg>
      <FlowTaskNode task={createTaskCard({ id: 't1', ...overrides })} cx={100} y={20} />
    </svg>,
  );
}

describe('FlowTaskNode — 两行副标题各自独立', () => {
  it('只有 assignee：指派者 + 待认领', () => {
    renderNode({ assignee: 'A@tm_1' });
    expect(screen.getByText('t1 · assigned to A')).toBeInTheDocument();
    expect(screen.getByText('Unclaimed')).toBeInTheDocument();
  });

  it('只有 owner：空指派槽 + 已认领（老数据没有 assignee）', () => {
    renderNode({ owner: 'B@tm_1', state: 'in_progress' });
    expect(screen.getByText('t1 · assigned —')).toBeInTheDocument();
    expect(screen.getByText('Claimed by B')).toBeInTheDocument();
  });

  it('两者都有且不同：两行分别出现两个名字，互不覆盖', () => {
    renderNode({ assignee: 'A@tm_1', owner: 'B@tm_1', state: 'in_progress' });
    expect(screen.getByText('t1 · assigned to A')).toBeInTheDocument();
    expect(screen.getByText('Claimed by B')).toBeInTheDocument();
    // 反证：任一名字被 `??` 挪到另一行都算退化。
    expect(screen.queryByText('Claimed by A')).not.toBeInTheDocument();
    expect(screen.queryByText('t1 · assigned to B')).not.toBeInTheDocument();
  });

  it('两者都没有：未指派 + 待认领', () => {
    renderNode({});
    expect(screen.getByText('t1 · unassigned')).toBeInTheDocument();
    expect(screen.getByText('Unclaimed')).toBeInTheDocument();
  });
});
