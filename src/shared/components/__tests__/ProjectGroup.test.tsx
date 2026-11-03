import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import ProjectGroup from '@/shared/components/ProjectGroup';

function setup(overrides: Partial<React.ComponentProps<typeof ProjectGroup>> = {}) {
  const onToggle = vi.fn();
  const props: React.ComponentProps<typeof ProjectGroup> = {
    name: 'neeko',
    sessionCount: 3,
    expanded: true,
    actions: { onToggle, ...overrides.actions },
    ...overrides,
  };
  render(<ProjectGroup {...props}>{props.children}</ProjectGroup>);
  return { onToggle };
}

describe('ProjectGroup header', () => {
  it('渲染项目名与会话数 (N)', () => {
    setup({ sessionCount: 2 });
    expect(screen.getByText('neeko')).toBeInTheDocument();
    expect(screen.getByText('(2)')).toBeInTheDocument();
  });

  it('渲染基于 name 派生的字母 avatar', () => {
    setup({ name: 'neeko' });
    expect(screen.getByText('N')).toBeInTheDocument();
  });

  /**
   * 2026-11-03 用户定案：项目头**不铺行背景**。
   *
   * 通栏灰底（`hover:bg-bg-hover`）只能铺到滚动容器的内容盒，而经典滚动条占布局宽度 ——
   * 右侧会留下一条通高空白（直抵面板圆角）。hover 反馈已由下面 local / worktree /
   * 会话行承担，项目头只在 hover 时浮现动作槽。
   */
  it('项目头不铺行背景，hover 的唯一视觉变化是动作槽浮现', () => {
    setup();
    expect(screen.getByTestId('project-group-header')).not.toHaveClass('hover:bg-bg-hover');
    // 可交互仍成立：动作槽靠 group-hover/proj 浮现。
    expect(screen.getByTestId('project-group-actions')).toHaveClass('group-hover/proj:opacity-100');
  });

  it('键盘聚焦仍有可见指示（鼠标 hover 底删掉后的替代）', () => {
    setup();
    // 与状态栏列表行同一套约定：ring-inset 不会外扩到 Island 的 overflow-hidden 外。
    expect(screen.getByTestId('project-group-header')).toHaveClass('focus-visible:ring-2');
    expect(screen.getByTestId('project-group-header')).toHaveClass('focus-visible:ring-inset');
  });

  it('点击 header 主体触发 onToggle', () => {
    const { onToggle } = setup();
    fireEvent.click(screen.getByTestId('project-group-header'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('展开时渲染 children；折叠时隐藏 children', () => {
    const { rerender } = render(
      <ProjectGroup name="neeko" sessionCount={1} expanded actions={{ onToggle: vi.fn() }}>
        <span data-testid="session-child">child</span>
      </ProjectGroup>,
    );
    expect(screen.getByTestId('session-child')).toBeInTheDocument();

    rerender(
      <ProjectGroup name="neeko" sessionCount={1} expanded={false} actions={{ onToggle: vi.fn() }}>
        <span data-testid="session-child">child</span>
      </ProjectGroup>,
    );
    expect(screen.queryByTestId('session-child')).not.toBeInTheDocument();
  });
});

describe('ProjectGroup hover actions', () => {
  it('提供 onAddWorktree 时渲染 + 按钮，点击不触发 onToggle 但触发 callback', () => {
    const onToggle = vi.fn();
    const onAddWorktree = vi.fn();
    render(
      <ProjectGroup name="neeko" sessionCount={1} expanded actions={{ onToggle, onAddWorktree }} />,
    );
    fireEvent.click(screen.getByTitle('New Worktree'));
    expect(onAddWorktree).toHaveBeenCalledTimes(1);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('提供 onOpenIde / onGitMenu / onRemove 时渲染对应按钮且独立触发', () => {
    const onOpenIde = vi.fn();
    const onGitMenu = vi.fn();
    const onRemove = vi.fn();
    render(
      <ProjectGroup
        name="neeko"
        sessionCount={1}
        expanded
        actions={{
          onToggle: vi.fn(),
          onOpenIde,
          onGitMenu,
          onRemove,
        }}
      />,
    );
    fireEvent.click(screen.getByTitle('Open in IDE'));
    fireEvent.click(screen.getByTitle('Git actions'));
    fireEvent.click(screen.getByTitle('Remove project'));
    expect(onOpenIde).toHaveBeenCalledTimes(1);
    expect(onGitMenu).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('未提供回调时不渲染对应按钮', () => {
    render(<ProjectGroup name="neeko" sessionCount={1} expanded actions={{ onToggle: vi.fn() }} />);
    expect(screen.queryByTitle('Open in IDE')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Git actions')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Remove project')).not.toBeInTheDocument();
    expect(screen.queryByTitle('New Worktree')).not.toBeInTheDocument();
  });

  it('Chevron 按钮独立触发 onToggle', () => {
    const onToggle = vi.fn();
    render(<ProjectGroup name="neeko" sessionCount={1} expanded actions={{ onToggle }} />);
    fireEvent.click(screen.getByTitle('Collapse'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('expanded=false 时 Chevron title=Expand', () => {
    render(
      <ProjectGroup
        name="neeko"
        sessionCount={1}
        expanded={false}
        actions={{ onToggle: vi.fn() }}
      />,
    );
    expect(screen.getByTitle('Expand')).toBeInTheDocument();
  });
});

describe('ProjectGroup right-click', () => {
  it('提供 onContextMenu 时右键触发回调', () => {
    const onContextMenu = vi.fn();
    render(
      <ProjectGroup
        name="neeko"
        sessionCount={1}
        expanded
        actions={{ onToggle: vi.fn(), onContextMenu }}
      />,
    );
    fireEvent.contextMenu(screen.getByTestId('project-group-header'));
    expect(onContextMenu).toHaveBeenCalledTimes(1);
  });
});

describe('ProjectGroup avatar color override', () => {
  it('提供 avatarColor 时优先用作 avatar 颜色', () => {
    render(
      <ProjectGroup
        name="neeko"
        avatarColor="#e06c75"
        sessionCount={1}
        expanded
        actions={{ onToggle: vi.fn() }}
      />,
    );
    const avatar = screen.getByTestId('project-group-avatar');
    expect(avatar).toBeInTheDocument();
    expect(avatar).toHaveStyle({ color: 'rgb(224, 108, 117)' });
  });

  it('avatarColor 缺省时走 hash 兜底（与同名稳定一致）', () => {
    render(<ProjectGroup name="neeko" sessionCount={1} expanded actions={{ onToggle: vi.fn() }} />);
    render(<ProjectGroup name="neeko" sessionCount={1} expanded actions={{ onToggle: vi.fn() }} />);
    const avatars = screen.getAllByTestId('project-group-avatar');
    expect(avatars.length).toBeGreaterThanOrEqual(2);
    expect(avatars[0].style.color).toBe(avatars[1].style.color);
  });
});
