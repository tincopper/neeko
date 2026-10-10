import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ConnectionWorktreeList from '@/features/connection/components/ConnectionWorktreeList';
import { useProjectStore } from '@/shared/store/projectStore';
import type { GitStatusSnapshot, Worktree } from '@/shared/types';
import { WorkspaceSession } from '@/shared/utils/workspaceRef';

const WT: Worktree = { path: '/home/u/wts/feature-x', branch: 'feature/x', head: 'abc' };

function makeSnapshot(projectId: string, worktreePath: string): GitStatusSnapshot {
  return {
    workspace_key: WorkspaceSession.of(projectId, worktreePath ?? null).key,
    version: 1,
    project_id: projectId,
    worktree_path: worktreePath,
    branch: 'feature/x',
    entries: [{ path: 'a.ts', status: 'Modified', additions: 2, deletions: 1, is_dir: false }],
    truncated: false,
  };
}

type FetchStatus = (worktreePath: string) => Promise<GitStatusSnapshot | null>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function List({
  worktrees = [WT],
  onFetchStatus,
}: {
  worktrees?: Worktree[];
  onFetchStatus?: FetchStatus;
}) {
  return (
    <ConnectionWorktreeList
      projectId="p1"
      worktrees={worktrees}
      activeCheckoutPath={null}
      onOpenWorktreeTerminal={vi.fn()}
      onCommitRenameWorktree={vi.fn()}
      onRemoveWorktree={vi.fn()}
      onFetchStatus={onFetchStatus}
    />
  );
}

describe('ConnectionWorktreeList — 远端侧栏 chip（按单元订阅，不用组件本地 state）', () => {
  beforeEach(() => {
    useProjectStore.setState({ statuses: {} });
  });

  it('拉取失败 = 未知：不出 chip（绝不写 0/0 假干净），下一次触发可重试', async () => {
    const onFetchStatus = vi.fn<FetchStatus>().mockResolvedValue(null);
    const { rerender } = render(<List onFetchStatus={onFetchStatus} />);

    await waitFor(() => expect(onFetchStatus).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('+0')).not.toBeInTheDocument();
    expect(screen.queryByText('-0')).not.toBeInTheDocument();

    // 失败项必须退出「已拉清单」：清单变化（新数组）即重试，而不是一生只拉一次。
    rerender(<List worktrees={[{ ...WT }]} onFetchStatus={onFetchStatus} />);
    await waitFor(() => expect(onFetchStatus).toHaveBeenCalledTimes(2));
  });

  it('成功拉取经 projectStore.statuses 出 chip（订阅而非本地 state）', async () => {
    const onFetchStatus = vi.fn<FetchStatus>().mockResolvedValue(makeSnapshot('p1', WT.path));
    render(<List onFetchStatus={onFetchStatus} />);

    expect(await screen.findByText('+2')).toBeInTheDocument();
    expect(screen.getByText('-1')).toBeInTheDocument();
    // 数据确实落在共享槽位（本地/远端侧栏同表），而不是组件私有 state
    expect(
      useProjectStore.getState().statuses[WorkspaceSession.of('p1', WT.path ?? null).key]?.entries,
    ).toHaveLength(1);
  });

  it('同一挂载内不重复拉取已成功单元', async () => {
    const onFetchStatus = vi.fn<FetchStatus>().mockResolvedValue(makeSnapshot('p1', WT.path));
    const { rerender } = render(<List onFetchStatus={onFetchStatus} />);
    await waitFor(() => expect(onFetchStatus).toHaveBeenCalledTimes(1));

    // rerender 在 act 内同步 flush effect：跳过是同步的，无需等待即可断言「没有第二次拉取」。
    rerender(<List worktrees={[{ ...WT }]} onFetchStatus={onFetchStatus} />);
    expect(onFetchStatus).toHaveBeenCalledTimes(1);
  });

  it('React.StrictMode 双挂载下 chip 仍出现（不得丢弃首轮结果）', async () => {
    // 回归：曾用组件生命周期 `cancelled` 丢弃首轮拉取结果，而 StrictMode 的「重挂」会让次轮因
    // key 已在已拉清单而跳过 ⇒ 结果被两头丢掉、chip 永不出现。applyStatus 是全局 store 写入，
    // 不该被组件生命周期取消。
    const onFetchStatus = vi.fn<FetchStatus>().mockResolvedValue(makeSnapshot('p1', WT.path));
    render(
      <React.StrictMode>
        <List onFetchStatus={onFetchStatus} />
      </React.StrictMode>,
    );

    expect(await screen.findByText('+2')).toBeInTheDocument();
  });

  it('本地 + 远端两侧栏同挂在同一单元时并发只拉一次（进程级单飞）', async () => {
    const d = deferred<GitStatusSnapshot | null>();
    const onFetchStatus = vi.fn<FetchStatus>().mockReturnValue(d.promise);
    render(
      <>
        <List onFetchStatus={onFetchStatus} />
        <List onFetchStatus={onFetchStatus} />
      </>,
    );

    await waitFor(() => expect(onFetchStatus).toHaveBeenCalledTimes(1));
    d.resolve(makeSnapshot('p1', WT.path));
    await waitFor(() =>
      expect(
        useProjectStore.getState().statuses[WorkspaceSession.of('p1', WT.path ?? null).key],
      ).toBeDefined(),
    );
    expect(onFetchStatus).toHaveBeenCalledTimes(1);
  });

  it('单元移出清单后再加回会重拉（已拉清单随之收敛）', async () => {
    const onFetchStatus = vi.fn<FetchStatus>().mockResolvedValue(makeSnapshot('p1', WT.path));
    const { rerender } = render(<List onFetchStatus={onFetchStatus} />);
    await waitFor(() => expect(onFetchStatus).toHaveBeenCalledTimes(1));

    // 移出清单 → 它的 key 退出「已拉清单」；再加回 ⇒ 同一挂载内也会重拉（不永久陈旧）。
    rerender(<List worktrees={[]} onFetchStatus={onFetchStatus} />);
    rerender(<List worktrees={[{ ...WT }]} onFetchStatus={onFetchStatus} />);
    await waitFor(() => expect(onFetchStatus).toHaveBeenCalledTimes(2));
  });
});
