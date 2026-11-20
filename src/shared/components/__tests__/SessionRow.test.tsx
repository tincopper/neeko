import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import SessionRow from '@/shared/components/SessionRow';

describe('SessionRow', () => {
  /**
   * 2026-11-08 用户定案：侧栏行不再常驻分支名 —— 行宽留给 label，分支信息
   * 选中单元后在下方查看。`branch` prop 已整体删除（接口层面由 tsc 把关）。
   */
  it('label 是行内唯一文本主体（分支名不进侧栏行）', () => {
    render(<SessionRow kind="local" label="local" />);
    const label = screen.getByText('local');
    expect(label).toBeInTheDocument();
    expect(label).toHaveClass('truncate', 'font-medium');
  });

  it('点击触发 onClick', () => {
    const onClick = vi.fn();
    render(<SessionRow kind="local" label="local" onClick={onClick} />);
    fireEvent.click(screen.getByText('local'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('active + ahead > 0 时渲染 ↑N', () => {
    render(<SessionRow kind="local" label="local" isActive ahead={208} />);
    expect(screen.getByText('↑208')).toBeInTheDocument();
  });

  it('非 active 时即使 ahead > 0 也不渲染 ↑N（仅 active 行展示）', () => {
    render(<SessionRow kind="local" label="local" ahead={208} />);
    expect(screen.queryByText('↑208')).not.toBeInTheDocument();
  });

  it('有 shortcut 时渲染 ⌘N（hover 可见，不依赖 active）', () => {
    render(<SessionRow kind="local" label="local" shortcut="⌘1" />);
    expect(screen.getByText('⌘1')).toBeInTheDocument();
  });

  it('无 shortcut 时不渲染 ⌘N', () => {
    render(<SessionRow kind="local" label="local" isActive />);
    expect(screen.queryByText(/⌘|Ctrl\+/)).not.toBeInTheDocument();
  });

  it('kind=worktree ⇒ 行首图标是 FolderGit（地点 = 一棵树）', () => {
    const { container } = render(<SessionRow kind="worktree" label="feature-a" />);
    // eslint-disable-next-line testing-library/no-node-access, testing-library/no-container -- 断言的是「行首图标是哪一个」，图标没有可访问名（无 role / label），只能按 lucide 的 class 断言（同 DiagnosticsPanel 的写法）
    const icon = container.querySelector('svg.lucide-folder-git-2');
    expect(icon).not.toBeNull();
  });

  /**
   * 团队行是**第二级的第三种行**，与 local / worktree 同构，只换行首图标。
   * 用户反馈：「team 还是用 icon 图标展示」——它不能再靠文字标记辨认自己。
   */
  it('kind=team ⇒ 行首图标是 Users（容器 = 一个团队，不是一棵树）', () => {
    const { container } = render(<SessionRow kind="team" label="refactor" />);
    // eslint-disable-next-line testing-library/no-node-access, testing-library/no-container -- 同上：图标没有可访问名，唯一可观测的差异就是 lucide 的 class
    const face = container.querySelector('[data-testid="unit-face"]');
    expect(face).not.toBeNull();
    // eslint-disable-next-line testing-library/no-node-access -- 见上
    expect(face?.querySelector('svg.lucide-users')).not.toBeNull();
    // 三种 kind 共用同一个图标槽：团队行不多画一个方块，也不把图标换成文字
    // eslint-disable-next-line testing-library/no-node-access -- 见上
    expect(face?.querySelector('svg.lucide-terminal')).toBeNull();
    // eslint-disable-next-line testing-library/no-node-access -- 见上
    expect(face?.querySelector('svg.lucide-folder-git-2')).toBeNull();
  });

  it('展开箭头的宾语可由调用方指定（团队行的子项是成员，不是会话）', () => {
    render(
      <SessionRow kind="team" label="refactor" childrenLabel="team members">
        <span data-testid="team-members">成员</span>
      </SessionRow>,
    );

    fireEvent.click(screen.getByLabelText('Expand team members'));
    expect(screen.getByTestId('team-members')).toBeInTheDocument();
    // 默认值仍是 sessions（单元行的既有 a11y 文案不受影响）
    expect(screen.queryByLabelText('Expand sessions')).not.toBeInTheDocument();
  });

  it('active 行给主按钮 aria-current（三种 kind 同一判据）', () => {
    render(<SessionRow kind="team" label="refactor" isActive />);
    // 无子列表 ⇒ 行上唯一的按钮就是主体按钮
    expect(screen.getByRole('button', { name: 'refactor' })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  it('worktree kind 的 trailing 是 hover 覆盖槽，不占 flex 宽度', () => {
    render(
      <SessionRow
        kind="worktree"
        label="feature-a"
        trailing={<span data-testid="trailing">x</span>}
      />,
    );
    const overlay = screen.getByTestId('unit-row-trailing');
    expect(overlay).toContainElement(screen.getByTestId('trailing'));
    expect(overlay).toHaveClass(
      'absolute',
      'right-1.5',
      'bg-bg-hover',
      'opacity-0',
      'pointer-events-none',
      'group-hover:opacity-100',
      'group-hover:pointer-events-auto',
      'focus-within:opacity-100',
    );
    expect(overlay).not.toHaveClass('bg-bg-tertiary');
    expect(overlay).not.toHaveClass('rounded-md');
    expect(overlay).not.toHaveClass('shadow-sm');
    expect(screen.getByTestId('unit-row')).toHaveClass('relative', 'hover:bg-bg-hover');
  });

  it('有子列表时覆盖槽让开行尾展开箭头', () => {
    render(
      <SessionRow
        kind="worktree"
        label="feature-a"
        trailing={<span data-testid="trailing">x</span>}
      >
        <span>child</span>
      </SessionRow>,
    );
    expect(screen.getByTestId('unit-row-trailing')).toHaveClass('right-7');
  });

  it('deleting 时覆盖槽强制可见（spinner 不依赖 hover）', () => {
    render(
      <SessionRow
        kind="worktree"
        label="feature-a"
        deleting
        trailing={<span data-testid="trailing">x</span>}
      />,
    );
    const overlay = screen.getByTestId('unit-row-trailing');
    expect(overlay).toHaveClass('opacity-100', 'pointer-events-auto');
    expect(screen.getByTestId('unit-row')).toHaveClass('bg-bg-hover');
  });

  it('单元行不再画状态点（状态由展开后的子会话行表达）', () => {
    render(<SessionRow kind="local" label="local" />);
    expect(screen.queryByTestId('unit-status-badge')).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('无子列表时行尾没有展开箭头', () => {
    render(<SessionRow kind="local" label="local" />);
    expect(screen.queryByLabelText('Expand sessions')).not.toBeInTheDocument();
  });

  it('有子列表时默认折叠，点击箭头才渲染（折叠时不挂载：订阅与渲染都是白付的成本）', () => {
    render(
      <SessionRow kind="local" label="local">
        <span data-testid="unit-sessions">会话列表</span>
      </SessionRow>,
    );

    expect(screen.queryByTestId('unit-sessions')).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Expand sessions'));
    expect(screen.getByTestId('unit-sessions')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Collapse sessions'));
    expect(screen.queryByTestId('unit-sessions')).not.toBeInTheDocument();
  });

  it('子行被选中（childActive）⇒ 父行不再填充背景（选中只出现在最具体的一层）', () => {
    const { rerender } = render(
      <SessionRow kind="local" label="local" isActive childCount={1} childActive={false}>
        <span>会话列表</span>
      </SessionRow>,
    );
    // 选中单元但里面没有选中会话：父行填充中性选中色
    expect(screen.getByTestId('unit-row')).toHaveClass('bg-bg-selected');

    rerender(
      <SessionRow kind="local" label="local" isActive childCount={1} childActive>
        <span>会话列表</span>
      </SessionRow>,
    );
    // 子行接管「当前」：父行让出填充，只保留文字语气
    expect(screen.getByTestId('unit-row')).not.toHaveClass('bg-bg-selected');
  });

  it('子列表折叠时子行不可见 ⇒ 父行保留选中底色', () => {
    render(
      <SessionRow kind="local" label="local" isActive childCount={1} childActive>
        <span data-testid="unit-sessions">会话列表</span>
      </SessionRow>,
    );
    fireEvent.click(screen.getByLabelText('Collapse sessions'));
    expect(screen.getByTestId('unit-row')).toHaveClass('bg-bg-selected');

    fireEvent.click(screen.getByLabelText('Expand sessions'));
    expect(screen.getByTestId('unit-row')).not.toHaveClass('bg-bg-selected');
  });

  it('没有子列表时 childActive 不会错误移除父行选中底色', () => {
    // `childCount` 可能来自快照，但调用方没注入子列表渲染入口；此时不能让父行误让色。
    render(<SessionRow kind="local" label="local" isActive childCount={1} childActive />);
    expect(screen.getByTestId('unit-row')).toHaveClass('bg-bg-selected');
  });

  it('非选中单元永不填充（hover 才给底色）', () => {
    render(<SessionRow kind="local" label="local" />);
    const row = screen.getByTestId('unit-row');
    expect(row).not.toHaveClass('bg-bg-selected');
    expect(row).toHaveClass('hover:bg-bg-hover');
  });

  it('选中单元的图标方块不再叠第二层底色（同一次强调只说一遍）', () => {
    render(<SessionRow kind="local" label="local" isActive />);
    // 图标方块曾自带 `backgroundColor: var(--bg-selected)`：在已填充的行上再压一层，
    // 同一个「选中」被强调两次。现在它只有尺寸与圆角。
    expect(screen.getByTestId('unit-face')).not.toHaveAttribute('style');
  });

  it('新会话出现（childCount 增长）⇒ 自动展开', () => {
    const { rerender } = render(
      <SessionRow kind="local" label="local" childCount={0}>
        <span data-testid="unit-sessions">会话列表</span>
      </SessionRow>,
    );
    expect(screen.queryByTestId('unit-sessions')).not.toBeInTheDocument();

    rerender(
      <SessionRow kind="local" label="local" childCount={1}>
        <span data-testid="unit-sessions">会话列表</span>
      </SessionRow>,
    );
    expect(screen.getByTestId('unit-sessions')).toBeInTheDocument();
  });

  it('条数不变 ⇒ 尊重用户的手动折叠（不会被刷新弹开）', () => {
    const { rerender } = render(
      <SessionRow kind="local" label="local" childCount={2}>
        <span data-testid="unit-sessions">会话列表</span>
      </SessionRow>,
    );
    // 首次挂载本来就有会话 ⇒ 展开
    expect(screen.getByTestId('unit-sessions')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Collapse sessions'));
    expect(screen.queryByTestId('unit-sessions')).not.toBeInTheDocument();

    // 条数没变（只是快照刷新）⇒ 保持折叠
    rerender(
      <SessionRow kind="local" label="local" childCount={2}>
        <span data-testid="unit-sessions">会话列表</span>
      </SessionRow>,
    );
    expect(screen.queryByTestId('unit-sessions')).not.toBeInTheDocument();
  });

  it('点击展开箭头不会触发行的点击语义（打开单元终端）', () => {
    const onClick = vi.fn();
    render(
      <SessionRow kind="local" label="local" onClick={onClick}>
        <span>会话列表</span>
      </SessionRow>,
    );

    fireEvent.click(screen.getByLabelText('Expand sessions'));
    expect(onClick).not.toHaveBeenCalled();
  });
});
