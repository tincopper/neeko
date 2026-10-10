import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeSpy } = vi.hoisted(() => ({ invokeSpy: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeSpy,
  convertFileSrc: vi.fn((p: string) => `asset://${p}`),
}));

import { useActivateWorkspace } from '@/features/git/hooks/useActivateWorkspace';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorkspaceStore } from '@/shared/store/workspaceStore';
import type { GitStatusSnapshot } from '@/shared/types';
import { WorkspaceSession } from '@/shared/utils/workspaceRef';

const MAIN_KEY = WorkspaceSession.of('p1', null).key;
const WT_A = WorkspaceSession.of('p1', '/wt/a').key;
const WT_B = WorkspaceSession.of('p1', '/wt/b').key;

function snapshotFor(key: string, version: number): GitStatusSnapshot {
  const [projectId, tail] = key.split('\u0000');
  const worktreePath = tail === '' ? null : tail;
  return {
    workspace_key: key,
    version,
    project_id: projectId,
    worktree_path: worktreePath,
    branch: worktreePath ? `wt-${worktreePath}` : 'main',
    entries: [{ path: `file-${version}.ts`, status: 'Modified', additions: 1, deletions: 0 }],
    truncated: false,
  };
}

function setActive() {
  invokeSpy.mockImplementation((_cmd: string, args: { worktreePath?: string | null }) =>
    Promise.resolve(
      snapshotFor(WorkspaceSession.of('p1', args?.worktreePath ?? null ?? null).key, 1),
    ),
  );
}

beforeEach(() => {
  invokeSpy.mockReset();
  setActive();
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
  useWorkspaceStore.setState({ byProject: {} });
});

// 「当前视图单元」的派生已收敛到 store（`workspaceStore.selectActiveWorkspaceKey` /
// `activeWorkspaceKeyOf`），其判据见 `shared/store/__tests__/workspaceStore.test.ts`。

describe('useActivateWorkspace —— 后端只挂当前视图单元（决策 D-B）的命令出口', () => {
  it('激活即发 set_active_workspace，并把返回快照写进该单元槽位', async () => {
    // 生产顺序（useWorktreeState.activateWorktree → useActiveWorkspaceSync）：先写激活态，
    // 再请求挂载。反过来会命中「响应已不属于当前视图」的丢弃分支。
    useWorkspaceStore.setState({
      byProject: { p1: { activePath: '/wt/a', activeBranch: 'a', opened: [] } },
    });
    const { result } = renderHook(() => useActivateWorkspace('p1'));
    await act(async () => {
      await result.current('/wt/a');
    });

    await waitFor(() =>
      expect(invokeSpy).toHaveBeenCalledWith('set_active_workspace', {
        projectId: 'p1',
        worktreePath: '/wt/a',
      }),
    );
    expect(useProjectStore.getState().statuses[WT_A]?.entries[0]?.path).toBe('file-1.ts');
    // 主仓槽位不被这次激活污染
    expect(useProjectStore.getState().statuses[MAIN_KEY]).toBeUndefined();
  });

  it('挂载失败 → 目标单元保持「未知」，不写空列表也不清空其它单元', async () => {
    useWorkspaceStore.setState({
      byProject: { p1: { activePath: '/wt/a', activeBranch: 'a', opened: [] } },
    });
    useProjectStore.setState({ statuses: { [MAIN_KEY]: snapshotFor(MAIN_KEY, 4) } } as never);
    invokeSpy.mockRejectedValueOnce(new Error('mount refused'));
    const { result } = renderHook(() => useActivateWorkspace('p1'));

    await act(async () => {
      await result.current('/wt/a');
    });

    const store = useProjectStore.getState();
    expect(store.statuses[WT_A]).toBeUndefined();
    expect(store.statuses[MAIN_KEY]?.version).toBe(4);
  });

  it('视图已切走的迟到响应被丢弃（切换竞态）', async () => {
    let resolveLate: (v: GitStatusSnapshot) => void = () => {};
    invokeSpy.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveLate = resolve;
        }),
    );
    const { result } = renderHook(() => useActivateWorkspace('p1'));
    const pending = act(async () => {
      await result.current('/wt/a');
    });

    // 期间用户切到 /wt/b，且 B 的响应先到
    useWorkspaceStore.setState({
      byProject: { p1: { activePath: '/wt/b', activeBranch: 'b', opened: [] } },
    });
    invokeSpy.mockResolvedValueOnce(snapshotFor(WT_B, 2));
    await act(async () => {
      await result.current('/wt/b');
    });

    resolveLate(snapshotFor(WT_A, 99));
    await pending;

    const store = useProjectStore.getState();
    expect(store.statuses[WT_A]).toBeUndefined();
    expect(store.statuses[WT_B]?.version).toBe(2);
  });

  it('视图已切走时到达的响应不写旧单元（守卫的另一半）', async () => {
    useWorkspaceStore.setState({
      byProject: { p1: { activePath: '/wt/b', activeBranch: 'b', opened: [] } },
    });
    invokeSpy.mockResolvedValueOnce(snapshotFor(WT_A, 5));
    const { result } = renderHook(() => useActivateWorkspace('p1'));
    await act(async () => {
      await result.current('/wt/a');
    });
    expect(useProjectStore.getState().statuses[WT_A]).toBeUndefined();
  });

  it('非 git 项目不发任何 git 命令', async () => {
    useProjectStore.setState({
      projects: [{ id: 'p1', name: 'P1', path: '/repo/p1', git_info: null } as never],
    });
    const { result } = renderHook(() => useActivateWorkspace('p1'));
    await act(async () => {
      await result.current('/wt/a');
    });
    expect(invokeSpy).not.toHaveBeenCalled();
  });

  it('无 projectId 时不动 store 不发命令', async () => {
    const { result } = renderHook(() => useActivateWorkspace(null));
    await act(async () => {
      await result.current('/wt/a');
    });
    expect(invokeSpy).not.toHaveBeenCalled();
  });
});
describe('useActivateWorkspace —— 后端是路径身份的唯一归一点（AC6 / 红线 12）', () => {
  it('后端回传 canonical 形态时把激活态改写成后端形态（旧 session 的 /tmp 形态因此自愈）', async () => {
    const hint = '/tmp/x/wt-a';
    const canonical = '/private/tmp/x/wt-a';
    useWorkspaceStore.getState().setActiveWorkspace('p1', hint, 'feat-a');
    invokeSpy.mockImplementation(() =>
      Promise.resolve(snapshotFor(WorkspaceSession.of('p1', canonical ?? null).key, 1)),
    );

    const { result } = renderHook(() => useActivateWorkspace('p1'));
    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current(hint);
    });

    expect(outcome).toBe('mounted');
    expect(useWorkspaceStore.getState().byProject['p1']?.activePath).toBe(canonical);
    expect(
      useProjectStore.getState().statuses[String(WorkspaceSession.of('p1', canonical ?? null).key)],
    ).toBeDefined();
    // 意图形态不该留下槽位（否则两份形态各占一格）
    expect(
      useProjectStore.getState().statuses[String(WorkspaceSession.of('p1', hint ?? null).key)],
    ).toBeUndefined();
  });

  it('主仓单元保持 null 形态（不该被改写成项目根路径）', async () => {
    const { result } = renderHook(() => useActivateWorkspace('p1'));
    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current(null);
    });
    expect(outcome).toBe('mounted');
    expect(useWorkspaceStore.getState().byProject['p1']?.activePath ?? null).toBeNull();
  });

  it('后端解析不了该单元 → 返回 failed，槽位置为未知', async () => {
    invokeSpy.mockRejectedValue(new Error('unit not found'));
    const { result } = renderHook(() => useActivateWorkspace('p1'));
    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current('/wt/gone');
    });
    expect(outcome).toBe('failed');
    expect(
      useProjectStore.getState().statuses[String(WorkspaceSession.of('p1', '/wt/gone').key)],
    ).toBeUndefined();
  });

  it('非 git 项目返回 skipped 且不发命令', async () => {
    useProjectStore.setState({
      projects: [{ id: 'p1', name: 'P1', path: '/x', git_info: null } as never],
    });
    invokeSpy.mockClear();
    const { result } = renderHook(() => useActivateWorkspace('p1'));
    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current(null);
    });
    expect(outcome).toBe('skipped');
    expect(invokeSpy).not.toHaveBeenCalled();
  });
});
