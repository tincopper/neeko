import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';

import { useWorktreeStore } from '@/shared/store/worktreeStore';
import type { GitInfo } from '@/shared/types';

import BranchInfo from '../BranchInfo';

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

const gitInfo: GitInfo = {
  current_branch: 'main',
  branches: ['main', 'dev'],
  worktrees: [],
  changed_files: [],
  is_clean: true,
  git_provider: '',
};

const defaultProps = {
  gitInfo,
  projectId: 'proj-1',
  aheadBehind: null,
  loading: false,
  onFetch: vi.fn(),
  onPull: vi.fn(),
  onPush: vi.fn(),
  onRefresh: vi.fn(),
  onNewBranch: vi.fn(),
  onNewWorktree: vi.fn(),
  onCheckoutBranch: vi.fn(),
};

function renderBranchInfo(props: Partial<typeof defaultProps> = {}) {
  return render(<BranchInfo {...defaultProps} {...props} />);
}

describe('BranchInfo worktree 分支切换限制', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorktreeStore.setState({ activeWorktreePath: null, activeWorktreeBranch: '' });
  });

  afterEach(() => {
    useWorktreeStore.setState({ activeWorktreePath: null, activeWorktreeBranch: '' });
  });

  it('无 worktree 时点击分支徽标打开切换面板', () => {
    renderBranchInfo();
    fireEvent.click(screen.getByText('main'));
    expect(screen.getByPlaceholderText('Search branches...')).toBeInTheDocument();
  });

  it('worktree 激活时点击分支徽标不打开切换面板（回归：worktree 不应允许切分支）', () => {
    useWorktreeStore.setState({
      activeWorktreePath: '/tmp/proj-wt',
      activeWorktreeBranch: 'feature-x',
    });
    renderBranchInfo();
    // worktree 激活时徽标显示 worktree 分支名，点击不应打开切换面板
    fireEvent.click(screen.getByText('feature-x'));
    expect(screen.queryByPlaceholderText('Search branches...')).not.toBeInTheDocument();
  });

  it('worktree 激活时徽标显示 worktree 分支名而非主分支（回归：worktree 下展示错误分支）', () => {
    useWorktreeStore.setState({
      activeWorktreePath: '/tmp/proj-wt',
      activeWorktreeBranch: 'feature-x',
    });
    renderBranchInfo();
    expect(screen.getByText('feature-x')).toBeInTheDocument();
    expect(screen.queryByText('main')).not.toBeInTheDocument();
    expect(screen.getByTitle('Worktree branch: feature-x (read-only)')).toBeInTheDocument();
  });
});
