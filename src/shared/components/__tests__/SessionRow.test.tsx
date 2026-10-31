import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import SessionRow from '@/shared/components/SessionRow';

describe('SessionRow', () => {
  it('渲染 label 与 branch 双行', () => {
    render(<SessionRow kind="local" label="local" branch="enhance/setting_panel" />);
    expect(screen.getByText('local')).toBeInTheDocument();
    expect(screen.getByText('enhance/setting_panel')).toBeInTheDocument();
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

  it('status 给出时在图标右下角画角标（取 dominantState 的结果）', () => {
    render(<SessionRow kind="local" label="local" status="awaitingApproval" />);
    const badge = screen.getByTestId('unit-status-badge');
    expect(within(badge).getByRole('img')).toHaveAttribute(
      'data-session-state',
      'awaitingApproval',
    );
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
