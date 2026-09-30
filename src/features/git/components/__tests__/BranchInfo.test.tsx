import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';

import { useProjectStore } from '@/shared/store/projectStore';
import { useWorktreeStore, type WorktreeUnitState } from '@/shared/store/worktreeStore';
import type { GitInfo } from '@/shared/types';
import { createAppProviderWrapper } from '@/testing/AppProviderTestUtils';

import BranchInfo from '../BranchInfo';

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

/**
 * `GitInfo` 已不含 changed_files / is_clean —— 未提交变更是 per 工作树的事实，
 * 走 projectStore.statuses[repoKey]（见 ChangesList / GitCommitPanel 的用例）。
 */
const gitInfo: GitInfo = {
  current_branch: 'main',
  branches: ['main', 'dev'],
  worktrees: [],
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

const WORKTREE_PATH = '/tmp/proj-wt';

function unit(activePath: string | null, activeBranch = ''): WorktreeUnitState {
  return { activePath, activeBranch, opened: [] };
}

function renderBranchInfo(props: Partial<typeof defaultProps> = {}) {
  return render(<BranchInfo {...defaultProps} {...props} />, {
    wrapper: createAppProviderWrapper(),
  });
}

describe('BranchInfo worktree 分支切换限制', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 单一表示：激活态只有 worktreeStore.byProject[activeProjectId] 一份（无全局镜像）
    useWorktreeStore.setState({ byProject: {} });
    useProjectStore.setState({ activeProjectId: 'proj-1', statuses: {} });
  });

  afterEach(() => {
    useWorktreeStore.setState({ byProject: {} });
    useProjectStore.setState({ activeProjectId: null, statuses: {} });
  });

  it('无 worktree 时点击分支徽标打开切换面板', () => {
    renderBranchInfo();
    fireEvent.click(screen.getByText('main'));
    expect(screen.getByPlaceholderText('Search branches...')).toBeInTheDocument();
  });

  it('worktree 激活时点击分支徽标不打开切换面板（回归：worktree 不应允许切分支）', () => {
    useWorktreeStore.setState({
      byProject: { 'proj-1': unit(WORKTREE_PATH, 'feature-x') },
    });
    renderBranchInfo();
    // worktree 激活时徽标显示 worktree 分支名，点击不应打开切换面板
    fireEvent.click(screen.getByText('feature-x'));
    expect(screen.queryByPlaceholderText('Search branches...')).not.toBeInTheDocument();
  });

  it('worktree 激活时徽标显示 worktree 分支名而非主分支（回归：worktree 下展示错误分支）', () => {
    useWorktreeStore.setState({
      byProject: { 'proj-1': unit(WORKTREE_PATH, 'feature-x') },
    });
    renderBranchInfo();
    expect(screen.getByText('feature-x')).toBeInTheDocument();
    expect(screen.queryByText('main')).not.toBeInTheDocument();
    expect(screen.getByTitle('Worktree branch: feature-x (read-only)')).toBeInTheDocument();
  });

  it('worktree 分支未知时不得回退画主仓分支（未知不是主仓）', () => {
    useWorktreeStore.setState({
      byProject: { 'proj-1': unit(WORKTREE_PATH, '') },
    });
    renderBranchInfo();
    expect(screen.queryByText('main')).not.toBeInTheDocument();
    // getByTitle 默认折叠空白，等价于模板里的双空格
    expect(screen.getByTitle('Worktree branch: (read-only)')).toBeInTheDocument();
  });

  it('激活态按项目隔离：别的项目在 worktree 上不影响本项目的分支切换（回归：全局镜像串项目）', () => {
    useWorktreeStore.setState({
      byProject: { 'proj-2': unit(WORKTREE_PATH, 'feature-x') },
    });
    renderBranchInfo();

    expect(screen.getByText('main')).toBeInTheDocument();
    expect(screen.queryByText('feature-x')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('main'));
    expect(screen.getByPlaceholderText('Search branches...')).toBeInTheDocument();
  });

  it('切回主仓（activePath=null）后徽标恢复主分支且允许切换', () => {
    useWorktreeStore.setState({
      byProject: { 'proj-1': unit(WORKTREE_PATH, 'feature-x') },
    });
    const { rerender } = renderBranchInfo();
    expect(screen.getByText('feature-x')).toBeInTheDocument();

    act(() => {
      useWorktreeStore.getState().setActiveWorktree('proj-1', null);
    });
    rerender(<BranchInfo {...defaultProps} />);

    expect(screen.getByText('main')).toBeInTheDocument();
    fireEvent.click(screen.getByText('main'));
    expect(screen.getByPlaceholderText('Search branches...')).toBeInTheDocument();
  });

  it('无 git 信息时不渲染分支徽标（非 git 项目不发 git 命令）', () => {
    renderBranchInfo({ gitInfo: null });
    expect(screen.getByText('Not a git repo')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Search branches...')).not.toBeInTheDocument();
  });
});
