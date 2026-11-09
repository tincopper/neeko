import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ConnectionWorktreeList from '@/features/connection/components/ConnectionWorktreeList';
import { useGitStore } from '@/shared/store/gitStore';
import { useWorkspaceStore } from '@/shared/store/workspaceStore';
import type { Worktree } from '@/shared/types';
import { WorkspaceSession } from '@/shared/utils/workspaceRef';

const PROJECT_ID = 'p1';
const WT: Worktree = { path: '/home/u/wts/feature-x', branch: 'feature/x', head: 'abc' };
const WT_KEY = WorkspaceSession.of(PROJECT_ID, WT.path).key;

function List({
  worktrees = [WT],
  activeCheckoutPath = null,
}: {
  worktrees?: Worktree[];
  activeCheckoutPath?: string | null;
}) {
  return (
    <ConnectionWorktreeList
      projectId={PROJECT_ID}
      worktrees={worktrees}
      activeCheckoutPath={activeCheckoutPath}
      onOpenWorktreeTerminal={vi.fn()}
      onCommitRenameWorktree={vi.fn()}
      onRemoveWorktree={vi.fn()}
    />
  );
}

describe('ConnectionWorktreeList — 待 push 提交数（与 local 行逐字同一条读取规则）', () => {
  beforeEach(() => {
    useGitStore.setState({ aheadBehind: {} });
    useWorkspaceStore.setState({ byProject: {} });
  });

  it('激活的 worktree 行渲染 ↑N（键 = 该 worktree 单元）', () => {
    // ↑N 的键来自 workspaceStore 的激活单元（与 local 行同一条派生）。
    useWorkspaceStore.getState().setActiveWorkspace(PROJECT_ID, WT.path, WT.branch);
    useGitStore.setState({ aheadBehind: { [WT_KEY]: { ahead: 9, behind: 0 } } });
    render(<List activeCheckoutPath={WT.path} />);
    expect(screen.getByText('↑9')).toBeInTheDocument();
  });

  it('非激活行不渲染 ↑N（与 local 行一致：仅激活行展示）', () => {
    useWorkspaceStore.getState().setActiveWorkspace(PROJECT_ID, WT.path, WT.branch);
    useGitStore.setState({ aheadBehind: { [WT_KEY]: { ahead: 9, behind: 0 } } });
    render(<List activeCheckoutPath={null} />);
    expect(screen.queryByText('↑9')).not.toBeInTheDocument();
  });

  it('无数据（未知）时不渲染 ↑N，绝不写 0 假干净', () => {
    useWorkspaceStore.getState().setActiveWorkspace(PROJECT_ID, WT.path, WT.branch);
    render(<List activeCheckoutPath={WT.path} />);
    expect(screen.queryByText('↑0')).not.toBeInTheDocument();
  });

  it('渲染 worktree 行（仅目录名；分支名不进侧栏行）', () => {
    render(<List />);
    expect(screen.getByText('feature-x')).toBeInTheDocument();
    // 2026-11-08 用户定案：分支名不再常驻行内（选中后在下方查看）
    expect(screen.queryByText('feature/x')).not.toBeInTheDocument();
  });

  it('删除按钮在 hover 覆盖槽内，不固定占行宽', () => {
    render(<List />);
    const overlay = screen.getByTestId('unit-row-trailing');
    expect(overlay).toContainElement(screen.getByTitle('Remove worktree and branch'));
    expect(overlay).toHaveClass('absolute', 'bg-bg-hover', 'opacity-0', 'group-hover:opacity-100');
  });
});

describe('ConnectionWorktreeList — 单元生命周期', () => {
  it('删除点击触发 dirty 检查后弹确认', async () => {
    const onIsWorktreeDirty = vi.fn().mockResolvedValue(true);
    render(
      <ConnectionWorktreeList
        projectId={PROJECT_ID}
        worktrees={[WT]}
        activeCheckoutPath={null}
        onOpenWorktreeTerminal={vi.fn()}
        onCommitRenameWorktree={vi.fn()}
        onRemoveWorktree={vi.fn()}
        onIsWorktreeDirty={onIsWorktreeDirty}
      />,
    );
    await userEvent.click(screen.getByTitle('Remove worktree and branch'));
    await waitFor(() => expect(onIsWorktreeDirty).toHaveBeenCalledWith(WT.path));
    expect(await screen.findByText(/Force Remove/)).toBeInTheDocument();
  });
});
