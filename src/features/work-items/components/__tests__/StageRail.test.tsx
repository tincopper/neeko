/**
 * `StageRail`：三态视觉、只让 `reachable` 可点、以及三种「画不出来"的情形。
 *
 * 判据全部来自 `utils/stageRail.ts`（`stageNodes` 查后端下发的 `transitions` 表）。这里钉的是
 * **呈现与交互**：类名/aria 是否表达了状态、current 与 locked 点了会不会误触发 `onMove`。
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { StagePlan } from '../../types';
import StageRail from '../StageRail';

/** 相邻两两双向（与后端 `StagePlan::from_stages()` 同形）。 */
const PLAN: StagePlan = {
  stages: ['Backlog', 'Ready', 'In Progress', 'Review', 'Done'],
  transitions: [
    { from: 'Backlog', to: 'Ready' },
    { from: 'Ready', to: 'Backlog' },
    { from: 'Ready', to: 'In Progress' },
    { from: 'In Progress', to: 'Ready' },
    { from: 'In Progress', to: 'Review' },
    { from: 'Review', to: 'In Progress' },
    { from: 'Review', to: 'Done' },
    { from: 'Done', to: 'Review' },
  ],
};

function rail(): HTMLElement {
  return screen.getByRole('group', { name: 'Stage rail' });
}

function node(stage: string): HTMLElement {
  return within(rail()).getByRole('button', { name: stage });
}

describe('StageRail — 三态', () => {
  it('current 实心且带 aria-current=step；reachable 可点；locked 灰且 disabled', () => {
    render(<StageRail plan={PLAN} current="Ready" onMove={vi.fn()} />);

    const current = node('Ready');
    expect(current).toHaveAttribute('data-status', 'current');
    expect(current).toHaveAttribute('aria-current', 'step');
    expect(current.className).toContain('bg-accent-blue');
    expect(current).toBeDisabled();

    const reachable = node('Backlog');
    expect(reachable).toHaveAttribute('data-status', 'reachable');
    expect(reachable).not.toHaveAttribute('aria-current');
    expect(reachable.className).toContain('border-border');
    expect(reachable).toBeEnabled();

    // 隔了两个 stage 的目标不可直接流转（后端 `can_transition` 同一条规则）。
    const locked = node('Review');
    expect(locked).toHaveAttribute('data-status', 'locked');
    expect(locked.className).toContain('text-text-muted');
    expect(locked).toBeDisabled();
  });

  it('点 reachable 调 onMove；点 current / locked 不调', async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    render(<StageRail plan={PLAN} current="Ready" onMove={onMove} />);

    await user.click(node('In Progress'));
    expect(onMove).toHaveBeenCalledExactlyOnceWith('In Progress');

    await user.click(node('Ready'));
    await user.click(node('Done'));
    expect(onMove).toHaveBeenCalledTimes(1);
  });
});

describe('StageRail — 画不出来时不猜位置', () => {
  it('plan 为 null 时整条轨道不渲染', () => {
    render(<StageRail plan={null} current="Ready" onMove={vi.fn()} />);
    expect(screen.queryByRole('group', { name: 'Stage rail' })).not.toBeInTheDocument();
  });

  it('当前 stage 不在 plan 里时没有任何 current 节点', () => {
    render(<StageRail plan={PLAN} current="Unknown Stage" onMove={vi.fn()} />);

    expect(rail()).toHaveAttribute('data-current-stage', 'Unknown Stage');
    // 不猜「最像的"位置：全部 locked，没有 `aria-current`。
    expect(within(rail()).queryAllByRole('button', { current: 'step' })).toHaveLength(0);
    expect(node('Backlog')).toHaveAttribute('data-status', 'locked');
  });
});
