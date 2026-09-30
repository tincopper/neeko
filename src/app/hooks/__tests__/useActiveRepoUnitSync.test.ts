import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeSpy } = vi.hoisted(() => ({ invokeSpy: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeSpy,
  convertFileSrc: vi.fn((p: string) => `asset://${p}`),
}));

import { useActiveRepoUnitSync } from '@/app/hooks/useActiveRepoUnitSync';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorktreeStore } from '@/shared/store/worktreeStore';
import type { GitStatusSnapshot } from '@/shared/types';
import { repoKeyOf } from '@/shared/utils/repoRef';

function snapshotFor(worktreePath: string | null, version = 1): GitStatusSnapshot {
  return {
    repo_key: String(repoKeyOf('p1', worktreePath)),
    version,
    project_id: 'p1',
    worktree_path: worktreePath,
    branch: worktreePath ? 'feat-a' : 'main',
    entries: [],
    truncated: false,
  };
}

beforeEach(() => {
  invokeSpy.mockReset();
  invokeSpy.mockImplementation((_cmd: string, args: { worktreePath?: string | null }) =>
    Promise.resolve(snapshotFor(args?.worktreePath ?? null)),
  );
  useProjectStore.setState({
    projects: [
      {
        id: 'p1',
        name: 'P1',
        path: '/repo/p1',
        git_info: { current_branch: 'main', branches: ['main'], worktrees: [] },
      } as never,
    ],
    activeProjectId: 'p1',
    activeProject: null,
    statuses: {},
  });
  useWorktreeStore.setState({ byProject: {} });
});

describe('useActiveRepoUnitSync —— 挂载唯一发起点', () => {
  it('同一单元不被发起两次（canonical 改写激活态回来的一跳要跳过）', async () => {
    useWorktreeStore.getState().setActiveWorktree('p1', '/wt/a', 'feat-a');
    renderHook(() => useActiveRepoUnitSync());

    await waitFor(() => expect(invokeSpy).toHaveBeenCalledTimes(1));
    // 再推一次同样的激活态（内容未变）与 canonical 改写后的第二次表述都不该再发命令
    act(() => {
      useWorktreeStore.getState().setActiveWorktree('p1', '/wt/a', 'feat-a');
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(invokeSpy).toHaveBeenCalledTimes(1);
  });

  it('挂载失败不作判死：保留激活意图、槽位置为未知，并允许后续重试', async () => {
    // 「工作树是否还存在」只由 useAppShellData 的 canonical 清单校验判定；这里判死会与它互抖。
    useWorktreeStore.getState().setActiveWorktree('p1', '/wt/gone', 'gone');
    invokeSpy.mockRejectedValue(new Error('status for unit is not available yet'));
    const { rerender } = renderHook(() => useActiveRepoUnitSync());
    await waitFor(() => expect(invokeSpy).toHaveBeenCalledTimes(1));

    expect(useWorktreeStore.getState().byProject['p1']?.activePath).toBe('/wt/gone');
    expect(
      useProjectStore.getState().statuses[String(repoKeyOf('p1', '/wt/gone'))],
    ).toBeUndefined();

    // 同一意图不重发；换个单元（重新渲染出新意图）才再打命令
    rerender();
    await new Promise((r) => setTimeout(r, 20));
    expect(invokeSpy).toHaveBeenCalledTimes(1);
  });

  it('切换激活单元即改挂（旧单元由后端 release_except 回收）', async () => {
    renderHook(() => useActiveRepoUnitSync());
    await waitFor(() => expect(invokeSpy).toHaveBeenCalledTimes(1));

    act(() => {
      useWorktreeStore.getState().setActiveWorktree('p1', '/wt/b', 'feat-b');
    });

    await waitFor(() => expect(invokeSpy).toHaveBeenCalledTimes(2));
    expect(invokeSpy).toHaveBeenLastCalledWith(
      'set_active_repo_unit',
      expect.objectContaining({ worktreePath: '/wt/b' }),
    );
  });
});
