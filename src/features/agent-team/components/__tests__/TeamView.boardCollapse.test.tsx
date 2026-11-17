import { fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMemberStatus, createTaskCard, createTeamSnapshot } from '@/testing/factories';
import { invoke } from '@/testing/tauriCore';

import { __resetTeamGenerationForTests, useTeamStore } from '../../store/teamStore';
import TeamView from '../TeamView';

/**
 * 任务区的**折叠**（R10）：默认展开，折叠是用户的主动动作（D3）。
 *
 * 判据：
 *
 * 1. 默认展开：`aria-expanded="true"`，分组与卡片都在；
 * 2. 折叠后只剩一行摘要（`N 个任务 · 列 计数 …`）+ 展开按钮，卡片一棵都不在；
 * 3. 点一下能展开回来（折叠是导航态，不是「丢数据」）；
 * 4. 折叠态不进 store（局部 `useState`，与 `taskView` 同族）—— 换队回来仍是默认展开。
 */
const mockInvoke = vi.mocked(invoke);

const SNAPSHOT = createTeamSnapshot({
  members: [
    createMemberStatus({ memberId: 'lead@tm_1', name: 'lead', role: 'lead' }),
    createMemberStatus({ memberId: 'w1@tm_1', name: 'frontend' }),
  ],
  tasks: [
    createTaskCard({ id: 't1', title: '调研 RSC', state: 'in_progress', owner: 'w1@tm_1' }),
    createTaskCard({ id: 't2', title: '登录页骨架', state: 'claimed', owner: 'w1@tm_1' }),
    createTaskCard({ id: 't3', title: '错误码映射', state: 'awaiting_approval' }),
  ],
});

function renderView(snapshot = SNAPSHOT): void {
  mockInvoke.mockResolvedValue(snapshot);
  render(
    <TeamView
      teamId="tm_1"
      snapshot={snapshot}
      loading={false}
      error={null}
      closing={false}
      resuming={false}
      onRefresh={vi.fn()}
      onBack={vi.fn()}
      onRequestClose={vi.fn()}
      onOpenTerminal={vi.fn()}
      onOpenTask={vi.fn()}
    />,
  );
}

/** 折叠开关（可访问名随状态变：`收起任务板` / `展开任务板`）。 */
function toggle(): HTMLElement {
  return screen.getByRole('button', { name: /任务板$/ });
}

describe('TeamView — 任务区头与折叠（R10）', () => {
  beforeEach(() => {
    __resetTeamGenerationForTests();
    useTeamStore.setState({
      teamId: 'tm_1',
      snapshot: SNAPSHOT,
      detail: null,
      loading: false,
      error: null,
      lastRev: 0,
    });
    mockInvoke.mockReset();
  });

  it('任务区头显示总计数与视图切换（板内部标题已删，计数只在这里）', () => {
    renderView();

    expect(screen.getByText('任务')).toBeInTheDocument();
    expect(screen.getByText('3', { selector: '[data-task-count]' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '看板' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '分配图' })).toBeInTheDocument();
    // R15：视图切换是**图标按钮** —— 可访问名与 title 是那两个词，按钮里没有可见文字
    // （窄列里省掉两个词宽；图标化不许丢掉可访问名）
    const boardToggle = screen.getByRole('button', { name: '看板' });
    expect(boardToggle).toHaveAttribute('title', '看板');
    expect(boardToggle).toHaveTextContent(/^$/);
    // 板自己的标题不再渲染（否则同一屏两个「共享任务板」）
    expect(screen.queryByText('共享任务板')).not.toBeInTheDocument();
  });

  it('默认展开：aria-expanded=true，卡片都在', () => {
    renderView();

    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    expect(toggle()).toHaveAccessibleName('收起任务板');
    expect(screen.getByRole('button', { name: /打开任务 t1/ })).toBeInTheDocument();
  });

  it('折叠后只剩一行摘要：总计数 + 非空列；卡片一棵都不在', () => {
    renderView();
    fireEvent.click(toggle());

    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    expect(toggle()).toHaveAccessibleName('展开任务板');
    expect(screen.getByRole('button', { name: /展开任务板/ })).toBeInTheDocument();

    const summary = screen.getByText(/^3 个任务/);
    expect(summary).toHaveTextContent('3 个任务 · 进行中 2 · 待批准 1');

    // 分组与卡片都不再挂载（折叠是「收起来」而不是「藏起来」）
    expect(screen.queryByRole('region', { name: '共享任务板' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /打开任务 t1/ })).not.toBeInTheDocument();
  });

  it('折叠态也必须说出截断（板上那条 role="status" 随板一起卸载了）', () => {
    renderView({ ...SNAPSHOT, tasksTruncated: true });
    fireEvent.click(toggle());

    // 「200 个任务」看起来就像团队真的只有 200 个 —— 截断这件事不能因为收起而消失
    expect(screen.getByText(/^3 个任务/)).toHaveTextContent('只显示前 200 条');
  });

  it('再点一下展开回看板（折叠是导航态，不是丢数据）', () => {
    renderView();
    fireEvent.click(toggle());
    fireEvent.click(toggle());

    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    const board = screen.getByRole('region', { name: '共享任务板' });
    expect(within(board).getByText('调研 RSC')).toBeInTheDocument();
  });
});
