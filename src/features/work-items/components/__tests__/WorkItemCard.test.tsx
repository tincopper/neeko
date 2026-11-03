/**
 * `WorkItemCard`：右键 [Move to] 菜单（design §11.5 方式三）。
 *
 * 只钉三件事，因为可达性判据本身住在 `utils/stageRail.ts`（并由它的单测钉满）：
 * 1. 菜单里**只有**可直接流转的 stage（current / locked 不出现）；
 * 2. 选中一条 → `onMove(id, stage)`（宿主负责 `transition` + 失败 toast）；
 * 3. 没有可流转目标时仍然弹一条置灰说明 —— 右键被接管却什么都不弹，用户只会以为菜单坏了。
 *
 * 这里**不做拖拽**（HTML5 `dataTransfer` 在 jsdom 里不可靠，会产出脆弱测试）：
 * design §4.5 已把拖拽标为「未来支持」，§11.5 只是把三种入口并列。
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { StagePlan, WorkItem } from '../../types';
import WorkItemCard from '../WorkItemCard';

/** 相邻两两可流转（与后端 `StagePlan::default()` 同形），所以中间那条有两个可去目标。 */
const PLAN: StagePlan = {
  stages: ['Backlog', 'Ready', 'In Progress', 'Done'],
  transitions: [
    { from: 'Backlog', to: 'Ready' },
    { from: 'Ready', to: 'Backlog' },
    { from: 'Ready', to: 'In Progress' },
    { from: 'In Progress', to: 'Ready' },
    { from: 'In Progress', to: 'Done' },
    { from: 'Done', to: 'In Progress' },
  ],
};

function item(stage = 'Ready', overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: 'wi_1',
    projectId: 'p1',
    title: '修复登录',
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

/** 右键卡片 → 返回菜单容器（Radix 的 Content 有 `role="menu"`）。 */
async function openMenu(
  stage = 'Ready',
  props: Partial<React.ComponentProps<typeof WorkItemCard>> = {},
): Promise<HTMLElement> {
  render(
    <ul>
      <WorkItemCard item={item(stage)} plan={PLAN} onOpen={vi.fn()} onMove={vi.fn()} {...props} />
    </ul>,
  );

  fireEvent.contextMenu(screen.getByRole('button', { name: /打开工作项/ }));

  return screen.findByRole('menu');
}

describe('WorkItemCard — 右键 Move to', () => {
  it('只列可直接流转的 stage：当前 stage 与需要经过中间阶段的都不出现', async () => {
    const menu = await openMenu('Ready');

    const labels = within(menu)
      .getAllByRole('menuitem')
      .map((entry) => entry.textContent);

    // Ready 的相邻是 Backlog 与 In Progress；Done 需要先经过 In Progress ⇒ 不出现。
    expect(labels).toEqual(['Backlog', 'In Progress']);
    expect(within(menu).queryByText('Ready')).not.toBeInTheDocument();
    expect(within(menu).queryByText('Done')).not.toBeInTheDocument();
  });

  it('选中一个 stage → onMove(卡片 id, stage)', async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    const menu = await openMenu('Ready', { onMove });

    await user.click(within(menu).getByRole('menuitem', { name: 'In Progress' }));

    await waitFor(() => expect(onMove).toHaveBeenCalledWith('wi_1', 'In Progress'));
  });

  it('阶段轨还没拿到（plan=null）时菜单里是置灰说明，不是一个能点的目标', async () => {
    const menu = await openMenu('Ready', { plan: null });

    const entries = within(menu).getAllByRole('menuitem');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toHaveTextContent('没有可流转的阶段');
    expect(entries[0]).toHaveAttribute('aria-disabled', 'true');
  });

  it('右键不改变卡片的点击语义：左键仍然打开详情', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(
      <ul>
        <WorkItemCard item={item()} plan={PLAN} onOpen={onOpen} onMove={vi.fn()} />
      </ul>,
    );

    await user.click(screen.getByRole('button', { name: /打开工作项/ }));

    expect(onOpen).toHaveBeenCalledWith('wi_1');
  });
});
