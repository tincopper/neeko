import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

import BranchSwitcherPanel from '../BranchSwitcherPanel';

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

const defaultProps = {
  branches: ['main', 'dev', 'origin/feature-a', 'origin/feature-b'],
  currentBranch: 'main',
  favoriteBranches: ['dev'],
  aheadBehind: {},
  onCheckout: vi.fn(),
  onToggleFavorite: vi.fn(),
  onNewBranch: vi.fn(),
  onNewWorktree: vi.fn(),
  onClose: vi.fn(),
};

function renderPanel(props = {}) {
  return render(<BranchSwitcherPanel {...defaultProps} {...props} />);
}

describe('BranchSwitcherPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('渲染所有分支', () => {
    renderPanel();
    expect(screen.getByText('main')).toBeInTheDocument();
    expect(screen.getByText('dev')).toBeInTheDocument();
    expect(screen.getByText('origin/feature-a')).toBeInTheDocument();
    expect(screen.getByText('origin/feature-b')).toBeInTheDocument();
  });

  it('搜索过滤分支', () => {
    renderPanel();
    const searchInput = screen.getByPlaceholderText('Search branches...');
    fireEvent.change(searchInput, { target: { value: 'feature' } });
    expect(screen.getByText('origin/feature-a')).toBeInTheDocument();
    expect(screen.getByText('origin/feature-b')).toBeInTheDocument();
    expect(screen.queryByText('main')).not.toBeInTheDocument();
    expect(screen.queryByText('dev')).not.toBeInTheDocument();
  });

  it('搜索忽略大小写', () => {
    renderPanel();
    const searchInput = screen.getByPlaceholderText('Search branches...');
    fireEvent.change(searchInput, { target: { value: 'MAIN' } });
    expect(screen.getByText('main')).toBeInTheDocument();
  });

  it('无匹配分支时显示空状态', () => {
    renderPanel();
    const searchInput = screen.getByPlaceholderText('Search branches...');
    fireEvent.change(searchInput, { target: { value: 'zzz' } });
    expect(screen.getByText('No branches found')).toBeInTheDocument();
  });

  it('空分支列表显示空状态', () => {
    renderPanel({ branches: [] });
    expect(screen.getByText('No branches found')).toBeInTheDocument();
  });

  it('当前分支显示左侧蓝色色条', () => {
    renderPanel();
    const currentItem = screen.getByRole('option', { name: /☆main/ });
    expect(currentItem).toHaveClass('border-accent-blue');
  });

  it('非当前分支不显示蓝色色条', () => {
    renderPanel();
    const devItem = screen.getByRole('option', { name: /★dev/ });
    expect(devItem).toHaveClass('border-transparent');
  });

  it('点击分支触发 onCheckout 和 onClose', () => {
    const onCheckout = vi.fn();
    const onClose = vi.fn();
    renderPanel({ onCheckout, onClose });
    fireEvent.click(screen.getByText('dev'));
    expect(onCheckout).toHaveBeenCalledWith('dev');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('点击当前分支不触发 onCheckout', () => {
    const onCheckout = vi.fn();
    renderPanel({ onCheckout });
    fireEvent.click(screen.getByText('main'));
    expect(onCheckout).not.toHaveBeenCalled();
  });

  it('点击星标切换收藏状态', () => {
    const onToggleFavorite = vi.fn();
    renderPanel({ onToggleFavorite });
    const star = screen.getByTitle('Remove from favorites');
    fireEvent.click(star);
    expect(onToggleFavorite).toHaveBeenCalledTimes(1);
  });

  it('收藏分支显示实心星', () => {
    renderPanel();
    const devStar = screen.getByTitle('Remove from favorites');
    expect(devStar).toBeInTheDocument();
    expect(devStar).toHaveTextContent('\u2605');
  });

  it('非收藏分支显示空心星', () => {
    renderPanel();
    const emptyStars = screen.getAllByTitle('Add to favorites');
    expect(emptyStars).toHaveLength(3);
    expect(emptyStars[0]).toHaveTextContent('\u2606');
  });

  it('显示 Local 和 Remote 分区', () => {
    renderPanel();
    expect(screen.getByText('Local')).toBeInTheDocument();
    expect(screen.getByText('Remote (origin)')).toBeInTheDocument();
  });

  it('各分区显示分支', () => {
    renderPanel();
    expect(screen.getByText('dev')).toBeInTheDocument();
    expect(screen.getByText('origin/feature-a')).toBeInTheDocument();
    expect(screen.getByText('origin/feature-b')).toBeInTheDocument();
  });

  it('New Branch 按钮触发回调', () => {
    const onNewBranch = vi.fn();
    const onClose = vi.fn();
    renderPanel({ onNewBranch, onClose });
    fireEvent.click(screen.getByText('New Branch'));
    expect(onNewBranch).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('New Worktree 按钮触发回调', () => {
    const onNewWorktree = vi.fn();
    const onClose = vi.fn();
    renderPanel({ onNewWorktree, onClose });
    fireEvent.click(screen.getByText('New Worktree'));
    expect(onNewWorktree).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape 键触发 onClose', () => {
    const onClose = vi.fn();
    renderPanel({ onClose });
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ArrowDown 和 ArrowUp 移动焦点', () => {
    renderPanel();
    const listbox = screen.getByRole('listbox');

    // 新顺序: main (index 0), dev (index 1)
    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    expect(screen.getByRole('option', { name: /☆main/ })).toHaveClass('bg-accent-blue/10');

    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    expect(screen.getByRole('option', { name: /★dev/ })).toHaveClass('bg-accent-blue/10');

    expect(screen.getByRole('option', { name: /☆main/ })).not.toHaveClass('bg-accent-blue/10');
  });

  it('Enter 键对当前分支不触发 checkout', () => {
    const onCheckout = vi.fn();
    renderPanel({ onCheckout });
    const listbox = screen.getByRole('listbox');
    // main 当前分支在 index 0，ArrowDown x1 到达
    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    fireEvent.keyDown(listbox, { key: 'Enter' });
    expect(onCheckout).not.toHaveBeenCalled();
  });

  it('Space 键触发收藏切换', () => {
    const onToggleFavorite = vi.fn();
    renderPanel({ onToggleFavorite });
    const listbox = screen.getByRole('listbox');
    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    fireEvent.keyDown(listbox, { key: ' ' });
    expect(onToggleFavorite).toHaveBeenCalledTimes(1);
  });

  it('右键菜单显示并触发 checkout', () => {
    const onCheckout = vi.fn();
    const onClose = vi.fn();
    renderPanel({ onCheckout, onClose });
    fireEvent.contextMenu(screen.getByText('dev'));
    expect(screen.getByText('Checkout')).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();
    expect(screen.getByText('Copy Name')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Checkout'));
    expect(onCheckout).toHaveBeenCalledWith('dev');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('右键菜单 Escape 关闭', () => {
    renderPanel();
    fireEvent.contextMenu(screen.getByText('dev'));
    expect(screen.getByText('Checkout')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
    expect(screen.queryByText('Checkout')).not.toBeInTheDocument();
  });

  it('右键非当前分支', () => {
    const onCheckout = vi.fn();
    renderPanel({ onCheckout });
    fireEvent.contextMenu(screen.getByText('main'));
    expect(screen.getByText('Checkout')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Checkout'));
    expect(onCheckout).not.toHaveBeenCalled();
  });

  it('右键菜单 copy name 调用 clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderPanel();
    fireEvent.contextMenu(screen.getByText('dev'));
    fireEvent.click(screen.getByText('Copy Name'));
    expect(writeText).toHaveBeenCalledWith('dev');
  });

  it('显示 ahead/behind 指示器（焦点行可见）', () => {
    const aheadBehind = {
      dev: { ahead: 3, behind: 1 },
    };
    renderPanel({ aheadBehind });
    // ArrowDown x2 聚焦 dev (index 1)
    const listbox = screen.getByRole('listbox');
    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    expect(screen.getByTitle('3 ahead')).toBeInTheDocument();
    expect(screen.getByTitle('1 behind')).toBeInTheDocument();
  });

  it('当前分支显示 ahead/behind', () => {
    const aheadBehind = {
      main: { ahead: 2, behind: 0 },
    };
    renderPanel({ aheadBehind });
    // main 为当前分支，新设计显示 ahead/behind
    expect(screen.getByTitle('2 ahead')).toBeInTheDocument();
  });
});
