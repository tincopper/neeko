/**
 * `BranchStatusBarWidget` 的 ahead/behind 读取 —— **键必须是Workspace身份**。
 *
 * 回归（P1-2 读侧）：本组件曾读 `aheadBehind[projectId]`，而键空间里从来没有这个键
 * （写入侧用的是 `{source}:{connectionId}:{projectId}`，且三个写入点的 connectionId 约定
 * 各不相同：`distro` / `${host}:${port}` / `host`）⇒ 状态栏的 ↑N/↓N 恒空。
 *
 * 现在读写两侧共用 `workspaceKeyOf(projectId, worktreePath)`：主仓与 linked worktree 各显示
 * **自己那个单元**的待推送数 —— 这正是 ahead/behind 作为 per 工作树 事实的落地点。
 */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useGitStore } from '@/shared/store/gitStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorkspaceStore } from '@/shared/store/workspaceStore';
import { workspaceKeyOf } from '@/shared/utils/workspaceRef';

import BranchStatusBarWidget from '../BranchStatusBarWidget';

const ACTIONS = {
  onNewBranch: vi.fn(),
  onNewWorktree: vi.fn(),
  onCheckoutBranch: vi.fn(),
};

/** 只铺该组件读取的状态：activeProject（含 git_info）+ 激活单元。 */
function seed(projectId: string, activeCheckoutPath: string | null) {
  useProjectStore.setState({
    activeProjectId: projectId,
    activeProject: {
      id: projectId,
      git_info: { current_branch: 'main', branches: [], worktrees: [], git_provider: '' },
    } as never,
  });
  useWorkspaceStore.setState({
    byProject: activeCheckoutPath
      ? {
          [projectId]: {
            activePath: activeCheckoutPath,
            activeBranch: 'feature/x',
            opened: [],
          },
        }
      : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  useProjectStore.setState({ activeProject: null, activeProjectId: null });
  useWorkspaceStore.setState({ byProject: {} });
  useGitStore.setState({ aheadBehind: {} });
});

describe('BranchStatusBarWidget — ahead/behind 按Workspace读取', () => {
  it('主仓单元：显示该单元键下的 ↑N/↓N', () => {
    seed('p1', null);
    useGitStore.setState({
      aheadBehind: { [workspaceKeyOf('p1', null)]: { ahead: 2, behind: 1 } },
    });

    render(<BranchStatusBarWidget {...ACTIONS} />);

    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('worktree 单元：显示**该 worktree** 的数字，主仓的数字不得串过来', () => {
    seed('p1', '/repo-wt');
    useGitStore.setState({
      aheadBehind: {
        [workspaceKeyOf('p1', null)]: { ahead: 7, behind: 0 },
        [workspaceKeyOf('p1', '/repo-wt')]: { ahead: 5, behind: 0 },
      },
    });

    render(<BranchStatusBarWidget {...ACTIONS} />);

    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.queryByText('7')).not.toBeInTheDocument();
  });

  it('键不是 projectId：只有项目维度的旧键时不得显示（键空间里没有这个键）', () => {
    seed('p1', null);
    useGitStore.setState({
      aheadBehind: { 'local:p1': { ahead: 4, behind: 0 }, p1: { ahead: 4, behind: 0 } } as never,
    });

    render(<BranchStatusBarWidget {...ACTIONS} />);

    expect(screen.queryByText('4')).not.toBeInTheDocument();
  });

  it('ahead/behind 缺失（未知）时不渲染数字，也不报错', () => {
    seed('p1', null);

    render(<BranchStatusBarWidget {...ACTIONS} />);

    expect(screen.getByTitle('Current branch: main')).toBeInTheDocument();
  });
});
