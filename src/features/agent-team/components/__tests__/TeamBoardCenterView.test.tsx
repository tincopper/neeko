import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { ProjectId } from '@/shared/utils/workspaceRef';

import TeamBoardCenterView from '../TeamBoardCenterView';

/**
 * 中央 tab 的**视图选择归 tab 数据**（组件只渲染 prop 要的那个视图），以及分配图的缩放接线。
 *
 * 两条判据都只能用真实 `TeamFlowGraph` / 真实 store 之外的组件行为来钉：
 *
 * 1. **视图不再有第二份真相**：点「Assignment graph」只调 `onViewChange`，组件**不**自己
 *    切 —— prop 没变就还画看板（有内部 `useState` 的版本在这里会立刻变成分配图）；
 *    要换脸必须由 `PaneContent` 把新 `view` 写回 tab 数据再传下来。
 * 2. **缩放单一持有者**：`zoom` + `onZoomChange` 一起传给图，于是 wheel 与 `+/-/重置` 按钮
 *    写的是同一个 zoom state。只断言「传了 prop」会漏掉「传了但没接上」的静默退化。
 */
vi.mock('../../hooks/useTeamPanel', () => ({
  useTeamPanel: () => ({
    teamId: 'tm_1',
    snapshot: { team: { name: '队伍 1' }, members: [], tasks: [], tasksTruncated: false },
    loading: false,
    error: null,
  }),
}));
vi.mock('../../store/teamStore', () => ({
  useTeamStore: (selector: (s: unknown) => unknown) =>
    selector({ openTeam: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('../../hooks/useTeamTaskTab', () => ({
  useTeamTaskTab: () => ({ openTaskTab: vi.fn() }),
}));

const PROJECT = 'p1' as ProjectId;

function renderTab(
  view: 'board' | 'flow',
  onViewChange: (next: 'board' | 'flow') => void = vi.fn(),
) {
  const utils = render(
    <TeamBoardCenterView
      teamId="tm_1"
      view={view}
      projectId={PROJECT}
      onViewChange={onViewChange}
    />,
  );
  return { ...utils, onViewChange };
}

/** 看板 / 分配图的存在性判据（分配图挂 `flow-viewport`，看板不挂）。 */
function isFlowRendered(): boolean {
  return screen.queryByTestId('flow-viewport') !== null;
}

describe('TeamBoardCenterView — 分配图缩放接线', () => {
  it('wheel 上滚经 onZoomChange 更新百分比（受控，非图内部另存一份）', () => {
    renderTab('flow');
    expect(screen.getByText('100%')).toBeInTheDocument();
    fireEvent.wheel(screen.getByTestId('flow-viewport'), { deltaY: -100 });
    expect(screen.getByText('110%')).toBeInTheDocument();
  });

  it('+/-/重置 按钮仍以 0.25 步长工作（与 wheel 的 0.1 手感各自独立）', () => {
    renderTab('flow');
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(screen.getByText('125%')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(screen.getByText('100%')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset zoom' }));
    expect(screen.getByText('100%')).toBeInTheDocument();
  });
});

/**
 * R2 / AC3：`view` **只**来自 props（tab 数据），组件不持有副本。
 *
 * 反例（旧实现）：`useState(initialView)` ⇒ 切 tab 卸载即丢；`view` prop 变了还要靠
 * `lastPropView` 手工同步。三者都随这一版删掉，判据就是下面两条。
 */
describe('TeamBoardCenterView — 视图只由 tab 数据决定', () => {
  it('点「Assignment graph」⇒ onViewChange(flow)，且自己不切换（prop 未变仍是看板）', () => {
    const { onViewChange } = renderTab('board');
    expect(isFlowRendered()).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Assignment graph' }));

    expect(onViewChange).toHaveBeenCalledWith('flow');
    // 有内部 state 的实现这里会变成分配图 —— 那就是第二份真相。
    expect(isFlowRendered()).toBe(false);
  });

  it('点「Board」⇒ onViewChange(board)', () => {
    const { onViewChange } = renderTab('flow');

    fireEvent.click(screen.getByRole('button', { name: 'Board' }));

    expect(onViewChange).toHaveBeenCalledWith('board');
    expect(isFlowRendered()).toBe(true);
  });

  it('view prop 换成 flow ⇒ 渲染分配图（切 tab 回来读到上次视图的等价形态）', () => {
    const { rerender } = renderTab('board');
    expect(isFlowRendered()).toBe(false);

    rerender(
      <TeamBoardCenterView teamId="tm_1" view="flow" projectId={PROJECT} onViewChange={vi.fn()} />,
    );
    expect(isFlowRendered()).toBe(true);

    rerender(
      <TeamBoardCenterView teamId="tm_1" view="board" projectId={PROJECT} onViewChange={vi.fn()} />,
    );
    expect(isFlowRendered()).toBe(false);
  });
});
