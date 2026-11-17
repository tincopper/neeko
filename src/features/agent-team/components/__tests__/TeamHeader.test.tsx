import { fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { createTaskCard, createTeam, createTeamSnapshot } from '@/testing/factories';

import TeamHeader from '../TeamHeader';

/**
 * 面板头的**形状**（R1 / R2）：两行 —— 一行身份 + 一行 meta。
 *
 * 三条判据：
 *
 * 1. **只有两行**：`header` 的直接子元素 = 2。回退到三行（标题 / 计数 / 动作各一行）会让
 *    260–300px 的 dock 列白掉 30+ px，而这一点在任何内容断言里都看不出来。
 * 2. **信息一条不丢，只降级**：成员数 / 待批（仅 >0）/ 项目根末段 / sealed 的「只读快照」
 *    全在 meta 行，并且「只进 title」不算数（禁 hover-only 信息）。
 * 3. **`返回列表` 的可访问名不变**（图标按钮靠 `aria-label`，测试与用户习惯都靠它）。
 */
const SNAPSHOT = createTeamSnapshot({
  memberCount: 3,
  tasks: [],
  team: createTeam({ name: 'refactor', projectPath: '/repo/worktrees/feat-team' }),
});

function renderHeader(overrides: Partial<React.ComponentProps<typeof TeamHeader>> = {}) {
  const props: React.ComponentProps<typeof TeamHeader> = {
    teamId: 'tm_1',
    snapshot: SNAPSHOT,
    closing: false,
    resuming: false,
    onRenameTeam: vi.fn(),
    onRefresh: vi.fn(),
    onBack: vi.fn(),
    onRequestClose: vi.fn(),
    ...overrides,
  };
  const view = render(<TeamHeader {...props} />);
  return { ...view, props };
}

describe('TeamHeader — 两行形状', () => {
  it('header 直接子元素恰好两行（防回退到三行）', () => {
    renderHeader();
    const header = screen.getByRole('banner');
    // 「几行」是 DOM 层级本身，没有可访问名能表达它
    // eslint-disable-next-line testing-library/no-node-access -- 结构关系断言（DOM 层级）
    expect(header.children).toHaveLength(2);
  });

  it('meta 行：N 成员 · 项目根末段（完整路径进 title），待批为 0 时不出现', () => {
    renderHeader();

    // 第二行 = meta 行（结构断言：可访问名表达不了「第几行」）
    // eslint-disable-next-line testing-library/no-node-access -- 结构关系断言（DOM 层级）
    const meta = screen.getByRole('banner').children[1] as HTMLElement;
    expect(meta).toHaveTextContent('3 成员');
    const root = within(meta).getByText('feat-team');
    expect(root).toHaveAttribute('title', '/repo/worktrees/feat-team');
    expect(within(meta).queryByText(/待批/)).not.toBeInTheDocument();
  });

  it('有待批时出现「M 待批」并保留 data-awaiting 钩子（信息不丢，只降级成文字）', () => {
    renderHeader({
      snapshot: createTeamSnapshot({
        memberCount: 3,
        tasks: [
          createTaskCard({ id: 't1', state: 'awaiting_approval' }),
          createTaskCard({ id: 't2', state: 'awaiting_approval' }),
        ],
      }),
    });

    expect(screen.getByText('2 待批')).toHaveAttribute('data-awaiting', '2');
  });

  it('sealed ⇒ meta 行补「只读快照（不随重启恢复）」这句可见文字', () => {
    renderHeader({
      snapshot: createTeamSnapshot({
        team: createTeam({ name: 'refactor', state: 'sealed', sealedAt: 1_700_000_000_000 }),
      }),
    });

    expect(screen.getByText(/只读快照/)).toBeInTheDocument();
    // 只读快照没有可关的东西
    fireEvent.pointerDown(screen.getByRole('button', { name: '团队操作：refactor' }));
    expect(screen.queryByRole('menuitem', { name: /关闭团队/ })).not.toBeInTheDocument();
  });

  it('返回列表是图标按钮，可访问名仍是「返回列表」', () => {
    const { props } = renderHeader();
    fireEvent.click(screen.getByRole('button', { name: '返回列表' }));
    expect(props.onBack).toHaveBeenCalledTimes(1);
  });

  it('刷新快照在菜单里（事件通道断掉时唯一的手动恢复路径）', () => {
    const { props } = renderHeader();
    fireEvent.pointerDown(screen.getByRole('button', { name: '团队操作：refactor' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '刷新快照' }));
    expect(props.onRefresh).toHaveBeenCalledTimes(1);
  });
});
