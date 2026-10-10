import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeSpy } = vi.hoisted(() => ({ invokeSpy: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeSpy,
  convertFileSrc: vi.fn((p: string) => `asset://${p}`),
}));

import { useActiveWorkspaceSync } from '@/app/hooks/useActiveWorkspaceSync';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorkspaceStore } from '@/shared/store/workspaceStore';
import type { GitStatusSnapshot } from '@/shared/types';
import { WorkspaceSession } from '@/shared/utils/workspaceRef';

/** 本 hook 的**唯一**副作用出口：挂载请求。用它计数，避免被日志上报等旁路命令干扰。 */
function mountCallCount(): number {
  return invokeSpy.mock.calls.filter(([cmd]) => cmd === 'set_active_workspace').length;
}

function snapshotFor(worktreePath: string | null, version = 1): GitStatusSnapshot {
  return {
    workspace_key: String(WorkspaceSession.of('p1', worktreePath ?? null).key),
    version,
    project_id: 'p1',
    worktree_path: worktreePath,
    branch: worktreePath ? 'feat-a' : 'main',
    entries: [],
    truncated: false,
  };
}

/** 让 `invoke('set_active_workspace')` 按 worktreePath 返回对应单元的快照。 */
function resolveSnapshotsFrom(version = 1): void {
  invokeSpy.mockImplementation((_cmd: string, args: { worktreePath?: string | null }) =>
    Promise.resolve(snapshotFor(args?.worktreePath ?? null, version)),
  );
}

/**
 * 推进虚拟时钟（小步）。
 *
 * 重试定时器是「上一轮请求结束后」才登记的，一次性大跨度推进不保证拾取到新登记的定时器；
 * 小步推进同时避免把断言钉死在策略的具体毫秒值上（策略值可变，行为不可变）。
 */
async function advanceVirtualTime(totalMs: number, stepMs = 25): Promise<void> {
  for (let elapsed = 0; elapsed < totalMs; elapsed += stepMs) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(stepMs);
    });
  }
}

/** 把主仓单元槽位预填成「pull 读回来的数据」（`useSessionBootstrap` 启动时对每个 git 项目都做一次）。 */
function prefillMainSlotFromPull(version = 3): void {
  useProjectStore.setState({
    statuses: { [String(WorkspaceSession.of('p1', null).key)]: snapshotFor(null, version) },
  });
}

beforeEach(() => {
  invokeSpy.mockReset();
  resolveSnapshotsFrom();
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

afterEach(() => {
  vi.useRealTimers();
});

describe('useActiveWorkspaceSync —— 挂载唯一发起点', () => {
  it('同一单元不被发起两次（canonical 改写激活态回来的一跳要跳过）', async () => {
    useWorkspaceStore.getState().setActiveWorkspace('p1', '/wt/a', 'feat-a');
    renderHook(() => useActiveWorkspaceSync());

    await waitFor(() => expect(mountCallCount()).toBe(1));
    // 再推一次同样的激活态（内容未变）不该再发命令
    act(() => {
      useWorkspaceStore.getState().setActiveWorkspace('p1', '/wt/a', 'feat-a');
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(mountCallCount()).toBe(1);
  });

  it('切换激活单元即改挂（旧单元由后端 release_except 回收）', async () => {
    renderHook(() => useActiveWorkspaceSync());
    await waitFor(() => expect(mountCallCount()).toBe(1));

    act(() => {
      useWorkspaceStore.getState().setActiveWorkspace('p1', '/wt/b', 'feat-b');
    });

    await waitFor(() => expect(mountCallCount()).toBe(2));
    expect(invokeSpy).toHaveBeenLastCalledWith(
      'set_active_workspace',
      expect.objectContaining({ worktreePath: '/wt/b' }),
    );
  });

  /**
   * 回归契约：**槽位非空不是「后端已挂载」的证据**。
   *
   * `get_workspace_status` 的 pull 读也会写槽位（`useSessionBootstrap` 启动时对每个 git 项目的主仓
   * 单元各拉一次），而 pull 不建立 push 生产者。若把「槽位非空」当成收敛完成，冷启动的真实竞态
   * 与「切到该项目」都会跳过 `set_active_workspace` —— 该单元从此没有 watcher：Changes 列表
   * 冻结在启动那一刻，文件树着色与侧栏徽标也不再更新（正是本 hook 要根治的症状形态）。
   */
  it('槽位已被 pull 预填时仍必须请求挂载（后端资源才是「有生产者」的证据）', async () => {
    prefillMainSlotFromPull();
    renderHook(() => useActiveWorkspaceSync());

    await waitFor(() => expect(mountCallCount()).toBe(1));
  });

  it('切到「主仓槽位已被 pull 预填」的项目 ⇒ 必须为新单元请求挂载', async () => {
    useProjectStore.setState({ activeProjectId: null });
    renderHook(() => useActiveWorkspaceSync());
    await new Promise((r) => setTimeout(r, 20));
    expect(mountCallCount()).toBe(0);

    act(() => {
      prefillMainSlotFromPull();
      useProjectStore.setState({ activeProjectId: 'p1' });
    });

    await waitFor(() => expect(mountCallCount()).toBe(1));
  });

  it('非 git 项目（git_info === null）不发任何 git 命令', async () => {
    useProjectStore.setState({
      projects: [{ id: 'p1', name: 'P1', path: '/repo/p1', git_info: null } as never],
    });
    renderHook(() => useActiveWorkspaceSync());

    await new Promise((r) => setTimeout(r, 50));
    expect(mountCallCount()).toBe(0);
  });
});

describe('useActiveWorkspaceSync —— 首快照未落地时的有界自愈', () => {
  /**
   * 回归契约：判据是「槽位有没有数据」这个**状态**，不是某次请求的结局。
   * 旧实现按结局分支（失败只把重发门闸置回 null），而门闸是 ref —— 改它不会重跑 effect，
   * 于是「挂载失败 / 槽位被其它路径作废而意图未变」都会永久停在 `Loading changes…`
   * （真 app 实测症状：切到 worktree 与切回主仓都一直转）。
   */
  it('挂载失败不作判死：保留激活意图、槽位置为未知，并退避重试直到落地', async () => {
    vi.useFakeTimers();
    const key = String(WorkspaceSession.of('p1', '/wt/gone').key);
    useWorkspaceStore.getState().setActiveWorkspace('p1', '/wt/gone', 'gone');
    invokeSpy
      .mockRejectedValueOnce(new Error('status for workspace is not available yet'))
      .mockRejectedValueOnce(new Error('status for workspace is not available yet'));
    // 第三次落地（号段跨挂载单调，见后端 version_floors）
    invokeSpy.mockImplementation((_cmd: string, args: { worktreePath?: string | null }) =>
      Promise.resolve(snapshotFor(args?.worktreePath ?? null, 7)),
    );

    renderHook(() => useActiveWorkspaceSync());

    // 第 1 次（立即）
    await advanceVirtualTime(25);
    expect(mountCallCount()).toBe(1);
    // 失败不判死：激活意图保留，槽位是「未知」而不是被伪造成「干净」
    expect(useWorkspaceStore.getState().byProject['p1']?.activePath).toBe('/wt/gone');
    expect(useProjectStore.getState().statuses[key]).toBeUndefined();

    // 退避：首个失败后不立即重发（立即重发＝自激环）
    await advanceVirtualTime(50);
    expect(mountCallCount()).toBe(1);

    // 退避窗内收敛
    await advanceVirtualTime(2000);
    expect(useProjectStore.getState().statuses[key]?.version).toBe(7);

    // 收敛后不再发命令（有界：自愈不得变成轮询）
    const settled = mountCallCount();
    await advanceVirtualTime(60_000);
    expect(mountCallCount()).toBe(settled);
  });

  it('一直失败则停在预算上限（不得无限重试打后端），且槽位保持未知', async () => {
    vi.useFakeTimers();
    useWorkspaceStore.getState().setActiveWorkspace('p1', '/wt/gone', 'gone');
    invokeSpy.mockRejectedValue(new Error('status for workspace is not available yet'));

    renderHook(() => useActiveWorkspaceSync());
    await advanceVirtualTime(10_000);
    // maxAttempts = 4（立即 + 3 次退避），此后不再发起
    expect(mountCallCount()).toBe(4);

    await advanceVirtualTime(60_000);
    expect(mountCallCount()).toBe(4);
    // 且仍然不判死：激活意图保留，交给唯一判死点（useAppShellData 的清单校验）
    expect(useWorkspaceStore.getState().byProject['p1']?.activePath).toBe('/wt/gone');
    expect(
      useProjectStore.getState().statuses[String(WorkspaceSession.of('p1', '/wt/gone').key)],
    ).toBeUndefined();

    // 「耗尽」只上报一次（列表一直转与只是慢在外部的唯一可分辨信号），且上报文案不含 NUL
    const giveUpLogs = invokeSpy.mock.calls.filter(([cmd]) => cmd === 'log_frontend_error');
    expect(giveUpLogs).toHaveLength(1);
    expect(giveUpLogs[0][1]).toMatchObject({ source: 'workspace-sync' });
    expect(JSON.stringify(giveUpLogs[0][1])).not.toContain('\u0000');
  });

  it('意图未变但槽位被作废 ⇒ 自愈重取（预算已归还，重新有完整次数）', async () => {
    vi.useFakeTimers();
    useWorkspaceStore.getState().setActiveWorkspace('p1', '/wt/a', 'feat-a');
    const key = String(WorkspaceSession.of('p1', '/wt/a').key);
    renderHook(() => useActiveWorkspaceSync());
    await advanceVirtualTime(25);
    expect(mountCallCount()).toBe(1);
    expect(useProjectStore.getState().statuses[key]?.version).toBe(1);

    // 外部路径作废了当前单元的槽位（例如项目根路径变更），而视图没动
    act(() => {
      useProjectStore.getState().invalidateStatus(key);
    });
    await advanceVirtualTime(2000);
    expect(mountCallCount()).toBe(2);
    expect(useProjectStore.getState().statuses[key]).toBeDefined();
  });

  it('退避窗内快照到达（push 生产者先落地）⇒ 取消本轮重试，不再发命令', async () => {
    vi.useFakeTimers();
    useWorkspaceStore.getState().setActiveWorkspace('p1', '/wt/a', 'feat-a');
    const key = String(WorkspaceSession.of('p1', '/wt/a').key);
    invokeSpy.mockRejectedValue(new Error('status for workspace is not available yet'));

    renderHook(() => useActiveWorkspaceSync());
    await advanceVirtualTime(25);
    expect(mountCallCount()).toBe(1);

    // 首快照由事件通道落地（push 生产者已建立，只是比首个读接口慢）
    act(() => {
      useProjectStore.getState().applyStatus(snapshotFor('/wt/a', 5));
    });
    await advanceVirtualTime(10_000);

    expect(mountCallCount()).toBe(1);
    expect(useProjectStore.getState().statuses[key]?.version).toBe(5);
  });

  it('意图变化 ⇒ 预算归零：前一个单元耗尽不影响新单元的完整次数', async () => {
    vi.useFakeTimers();
    useWorkspaceStore.getState().setActiveWorkspace('p1', '/wt/dead', 'dead');
    invokeSpy.mockRejectedValue(new Error('status for workspace is not available yet'));

    renderHook(() => useActiveWorkspaceSync());
    await advanceVirtualTime(10_000);
    expect(mountCallCount()).toBe(4); // /wt/dead 的预算耗尽

    // 切到另一个单元：新意图拿到完整预算（4 次），而不是继承耗尽的计数
    invokeSpy.mockImplementation((_cmd: string, args: { worktreePath?: string | null }) =>
      Promise.resolve(snapshotFor(args?.worktreePath ?? null, 2)),
    );
    act(() => {
      useWorkspaceStore.getState().setActiveWorkspace('p1', '/wt/b', 'b');
    });
    await advanceVirtualTime(25);
    expect(mountCallCount()).toBe(5);
    expect(
      useProjectStore.getState().statuses[String(WorkspaceSession.of('p1', '/wt/b').key)]?.version,
    ).toBe(2);
  });
});
