import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { ProjectId } from '@/shared/utils/workspaceRef';

import TeamBoardCenterView from '../TeamBoardCenterView';

/**
 * 中央 tab 的缩放接线（第 2 轮 J5）：`zoom` + `onZoomChange` 一起传给图，
 * 于是 wheel 与 `+/-/重置` 按钮写的是**同一个** zoom state（单一持有者）。
 *
 * 用真实的 `TeamFlowGraph`（不 mock 它）：wheel 命中容器里的原生非 passive 监听，
 * 回调改 state，百分比标签随之变化 —— 这才是「中央 tab 受控」的端到端判据。
 * 只断言「传了 prop」会漏掉「传了但没接上」的静默退化。
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

function renderFlowTab(): void {
  render(<TeamBoardCenterView teamId="tm_1" view="flow" projectId={'p1' as ProjectId} />);
}

describe('TeamBoardCenterView — 分配图缩放接线', () => {
  it('wheel 上滚经 onZoomChange 更新百分比（受控，非图内部另存一份）', () => {
    renderFlowTab();
    expect(screen.getByText('100%')).toBeInTheDocument();
    fireEvent.wheel(screen.getByTestId('flow-viewport'), { deltaY: -100 });
    expect(screen.getByText('110%')).toBeInTheDocument();
  });

  it('+/-/重置 按钮仍以 0.25 步长工作（与 wheel 的 0.1 手感各自独立）', () => {
    renderFlowTab();
    fireEvent.click(screen.getByRole('button', { name: '放大' }));
    expect(screen.getByText('125%')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '缩小' }));
    expect(screen.getByText('100%')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '放大' }));
    fireEvent.click(screen.getByRole('button', { name: '重置缩放' }));
    expect(screen.getByText('100%')).toBeInTheDocument();
  });
});
