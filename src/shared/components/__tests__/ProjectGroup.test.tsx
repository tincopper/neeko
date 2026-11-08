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
  /**
   * 2026-11-08 方案 C 定案（用户选定原型 C「轻分组」）：计数改为行尾 pill，
   * 不再是名字后面的 `(N)`。hover 期间 pill 淡出、动作胶囊淡入，两者不叠影。
   */
  it('会话数渲染为行尾 pill（不再是名字后的括号计数）', () => {
    setup({ sessionCount: 2 });
    expect(screen.getByText('neeko')).toBeInTheDocument();
    const pill = screen.getByTestId('project-group-count');
    expect(pill).toBeInTheDocument();
    expect(pill).toHaveTextContent('2');
    expect(pill).toHaveClass('group-hover/proj:opacity-0');
  });

  it('渲染基于 name 派生的字母 avatar（方案 C：20px 无描边小方块）', () => {
    setup({ name: 'neeko' });
    const avatar = screen.getByTestId('project-group-avatar');
    expect(avatar).toHaveTextContent('N');
    // 方案 C 几何：20px + 字重降档；去描边在 avatarColor 用例里钉（那里颜色确定）
    expect(avatar).toHaveClass('w-5', 'font-medium');
  });

  /**
   * 2026-11-08 用户定案：`group/proj` 必须在**项目头行**，不能在整张卡外层。
   * 挂外层时 hover 到展开的 local / 会话行也会命中命名组，动作胶囊会在「鼠标只是
   * 路过会话」时冒出来。收窄后，pill / 动作槽的 hover 门只认项目头自己。
   */
  it('命名 group 挂在项目头行（不是卡片外层），hover 子行不触发项目工具栏', () => {
    setup();
    const header = screen.getByTestId('project-group-header');
    expect(header).toHaveClass('group/proj');
    // 根容器不再带命名组：展开区是 header 的兄弟，不在 group 后代链上
    expect(screen.getByTestId('project-group-root')).not.toHaveClass('group/proj');
    // 依赖该组的两个视觉仍以 header 为祖先
    expect(screen.getByTestId('project-group-actions')).toHaveClass('group-hover/proj:opacity-100');
    expect(screen.getByTestId('project-group-count')).toHaveClass('group-hover/proj:opacity-0');
  });

  /**
   * 2026-11-08 方案 C 定案：项目卡变成岛式容器（`bg-bg-secondary` 圆角块），
   * 项目头随之成为「岛内的第一行」—— hover 铺底与单元行同一套反馈，
   * 旧「通栏滚动条空白」异议随岛内缩（`mx-1`）消失，2026-11-03 的通栏定案就此废止。
   */
  it('项目头在岛内铺 hover 底，hover 的另一视觉变化是动作胶囊浮现', () => {
    setup();
    expect(screen.getByTestId('project-group-header')).toHaveClass('hover:bg-bg-hover');
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
    // 去描边（方案 C）：旧 1.5px 彩色描边废止，色彩身份只留在 color + 淡底
    expect(avatar).not.toHaveStyle({ border: '1.5px solid rgb(224, 108, 117)' });
  });

  it('avatarColor 缺省时走 hash 兜底（与同名稳定一致）', () => {
    render(<ProjectGroup name="neeko" sessionCount={1} expanded actions={{ onToggle: vi.fn() }} />);
    render(<ProjectGroup name="neeko" sessionCount={1} expanded actions={{ onToggle: vi.fn() }} />);
    const avatars = screen.getAllByTestId('project-group-avatar');
    expect(avatars.length).toBeGreaterThanOrEqual(2);
    expect(avatars[0].style.color).toBe(avatars[1].style.color);
  });
});
