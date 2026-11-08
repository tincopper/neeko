import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import SessionRow from '@/shared/components/SessionRow';

describe('SessionRow', () => {
  /**
   * 2026-11-08 方案 C 定案：单元行改**单行** —— branch 以等宽字体跟在 label 同排，
   * 不再双行堆叠（行高从 ~46px 收到 ~28px）。
   */
  it('label 与 branch 单行同排（branch 为行内等宽次要文本）', () => {
    render(<SessionRow kind="local" label="local" branch="enhance/setting_panel" />);
    const line = screen.getByTestId('unit-label-line');
    expect(within(line).getByText('local')).toBeInTheDocument();
    // 同一个基线弹性行容器（不是上下两块；旧双行堆叠废止）
    expect(line).toHaveClass('items-baseline');
    expect(within(line).getByText('enhance/setting_panel')).toHaveClass('font-mono');
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

  it('worktree kind 渲染 trailing 节点', () => {
    render(
      <SessionRow
        kind="worktree"
        label="feature-a"
        branch="feature/a"
        trailing={<span data-testid="trailing">x</span>}
      />,
    );
    expect(screen.getByTestId('trailing')).toBeInTheDocument();
  });

  it('无会话（status 缺省）不画任何状态点', () => {
    render(<SessionRow kind="local" label="local" />);
    expect(screen.queryByTestId('unit-status-badge')).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  /**
   * 2026-11-08 方案 C 定案：单元行去掉 28px 图标块，状态角标随之从图标角落
   ** 移到行尾**（与 ↑N / 快捷键同一端），图标本身裸用。
   */
  it('status 给出时在行尾画状态点（不在图标上叠角标）', () => {
    render(<SessionRow kind="local" label="local" status="awaitingApproval" />);
    const badge = screen.getByTestId('unit-status-badge');
    expect(within(badge).getByRole('img')).toHaveAttribute(
      'data-session-state',
      'awaitingApproval',
    );
    // 角标不在图标槽内（方案 C：图标裸用，无 28px 方块可叠）
    expect(
      within(screen.getByTestId('unit-face')).queryByTestId('unit-status-badge'),
    ).not.toBeInTheDocument();
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
