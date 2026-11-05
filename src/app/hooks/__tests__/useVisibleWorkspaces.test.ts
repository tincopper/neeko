import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeSpy } = vi.hoisted(() => ({ invokeSpy: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeSpy,
  convertFileSrc: vi.fn((p: string) => `asset://${p}`),
}));

import { useVisibleWorkspaces } from '@/app/hooks/useVisibleWorkspaces';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorkspaceStore } from '@/shared/store/workspaceStore';
import type { GitStatusSnapshot } from '@/shared/types';
import { WorkspaceSession } from '@/shared/utils/workspaceRef';

/**
 * 本 hook 的**唯一**副作用出口是可见集合声明。按命令名过滤，避免被 `log_frontend_error`
 * 等旁路 invoke 干扰计数。
 */
function declareCalls() {
  return invokeSpy.mock.calls.filter(([cmd]) => cmd === 'set_visible_workspaces');
}

function declaredWorkspaces(callIndex = -1): unknown[] {
  const calls = declareCalls();
  const call = calls.at(callIndex) as [string, { workspaces: unknown[] }] | undefined;
  return call?.[1].workspaces ?? [];
}

function snapshotFor(
  projectId: string,
  worktreePath: string | null,
  version = 1,
): GitStatusSnapshot {
  return {
    workspace_key: String(WorkspaceSession.of(projectId, worktreePath).key),
    version,
    project_id: projectId,
    worktree_path: worktreePath,
    branch: worktreePath ? 'feat-a' : 'main',
    entries: [],
    truncated: false,
    ahead: 0,
    behind: 0,
  };
}

function seedProject(gitInfo: unknown = { current_branch: 'main', branches: [], worktrees: [] }) {
  useProjectStore.setState({
    projects: [{ id: 'p1', name: 'P1', path: '/repo/p1', git_info: gitInfo } as never],
    activeProjectId: 'p1',
    activeProject: null,
    statuses: {},
  });
}

beforeEach(() => {
  invokeSpy.mockReset();
  invokeSpy.mockResolvedValue([]);
  seedProject();
  useWorkspaceStore.setState({ byProject: {} });
});

describe('useVisibleWorkspaces —— 声明式 reconcile 的唯一发送端', () => {
  it('集合不变不重发（重渲染与同值写入都不产生第二条命令）', async () => {
    useWorkspaceStore.getState().setActiveWorkspace('p1', '/wt/a', 'feat-a');
    const { rerender } = renderHook(() => useVisibleWorkspaces());

    await waitFor(() => expect(declareCalls()).toHaveLength(1));
    expect(declaredWorkspaces()).toEqual([
      expect.objectContaining({ projectId: 'p1', worktreePath: '/wt/a' }),
    ]);

    // ① 纯粹的重渲染：去重判据是**字符串签名**，不是每次渲染都会新建的集合/对象身份
    //    （`hook-guidelines.md` 常见错误 5）。这里若按对象身份去重，这行会多出一条命令。
    rerender();
    await new Promise((r) => setTimeout(r, 20));
    expect(declareCalls()).toHaveLength(1);

    // ② 内容未变的重写激活态（store 内部同值短路之外的路径）同样不得产生命令。
    act(() => {
      useWorkspaceStore.getState().setActiveWorkspace('p1', '/wt/a', 'feat-a');
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(declareCalls()).toHaveLength(1);
  });

  it('声明串行：上一条未落地时不发下一条（旧声明不得晚于新声明生效）', async () => {
    // 每次 invoke 在 Tauri 里各自 spawn，后端 reconcile 之前还要 await 地址解析 / 仓库校验
    // （远端单元是 SSH/WSL 往返）。并发声明因此可能乱序落地：一条**更早**的声明晚到，会以它的
    // keep 为准把刚挂上的单元释放掉，此后没有视图变化就不再收敛（重试环已删）。
    let releaseFirst: (() => void) | undefined;
    invokeSpy.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseFirst = () => resolve([]);
        }),
    );
    invokeSpy.mockResolvedValue([]);

    renderHook(() => useVisibleWorkspaces());
    await waitFor(() => expect(declareCalls()).toHaveLength(1));

    // 第一条还挂着，再切一次视图
    act(() => {
      useWorkspaceStore.getState().setActiveWorkspace('p1', '/wt/b', 'feat-b');
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(declareCalls()).toHaveLength(1);

    // 放行第一条之后，第二条才发出 —— 顺序由发送端保证，后端不必记「哪条更新」
    act(() => releaseFirst?.());
    await waitFor(() => expect(declareCalls()).toHaveLength(2));
    expect(declaredWorkspaces(0)).toEqual([
      expect.objectContaining({ projectId: 'p1', worktreePath: null }),
    ]);
    expect(declaredWorkspaces(1)).toEqual([
      expect.objectContaining({ projectId: 'p1', worktreePath: '/wt/b' }),
    ]);
  });

  it('集合变化只发一次，载荷是新单元（声明式真值，不是「再挂一个」）', async () => {
    renderHook(() => useVisibleWorkspaces());
    await waitFor(() => expect(declareCalls()).toHaveLength(1));

    act(() => {
      useWorkspaceStore.getState().setActiveWorkspace('p1', '/wt/b', 'feat-b');
    });

    await waitFor(() => expect(declareCalls()).toHaveLength(2));
    expect(declaredWorkspaces()).toEqual([
      expect.objectContaining({ projectId: 'p1', worktreePath: '/wt/b' }),
    ]);
  });

  it('切到非 git 项目 ⇒ 声明空集合（后端据此释放全部挂载）', async () => {
    useWorkspaceStore.getState().setActiveWorkspace('p1', '/wt/a', 'feat-a');
    const { rerender } = renderHook(() => useVisibleWorkspaces());
    await waitFor(() => expect(declareCalls()).toHaveLength(1));
    expect(declaredWorkspaces()).toHaveLength(1);

    act(() => {
      useProjectStore.setState({
        projects: [{ id: 'p1', name: 'P1', path: '/repo/p1', git_info: null } as never],
      });
    });
    rerender();

    await waitFor(() => expect(declareCalls()).toHaveLength(2));
    expect(declaredWorkspaces()).toEqual([]);
  });

  it('ready ⇒ 快照写进该单元槽位；pending ⇒ 什么都不做', async () => {
    useWorkspaceStore.getState().setActiveWorkspace('p1', '/wt/a', 'feat-a');
    const key = String(WorkspaceSession.of('p1', '/wt/a').key);
    invokeSpy.mockResolvedValueOnce([
      { state: 'ready', workspace_key: key, snapshot: snapshotFor('p1', '/wt/a', 4) },
      // 同批里另一个单元的冷窗口：不写槽位、不报错
      { state: 'pending', workspace_key: String(WorkspaceSession.of('p1', null).key) },
    ]);

    renderHook(() => useVisibleWorkspaces());
    await waitFor(() => expect(useProjectStore.getState().statuses[key]?.version).toBe(4));
    expect(useProjectStore.getState().statuses[String(WorkspaceSession.of('p1', null).key)]).toBe(
      undefined,
    );
    expect(invokeSpy.mock.calls.filter(([cmd]) => cmd === 'log_frontend_error')).toHaveLength(0);
  });

  it('failed ⇒ 只落一条 dev 日志（不写槽位、不弹用户可见错误）', async () => {
    useWorkspaceStore.getState().setActiveWorkspace('p1', '/wt/gone', 'gone');
    const key = String(WorkspaceSession.of('p1', '/wt/gone').key);
    invokeSpy.mockResolvedValueOnce([
      { state: 'failed', workspace_key: key, error: 'not a git repository' },
    ]);

    renderHook(() => useVisibleWorkspaces());

    await waitFor(() =>
      expect(invokeSpy.mock.calls.filter(([cmd]) => cmd === 'log_frontend_error')).toHaveLength(1),
    );
    const [cmd, payload] = invokeSpy.mock.calls.find(([c]) => c === 'log_frontend_error') as [
      string,
      { source: string; message: string },
    ];
    expect(cmd).toBe('log_frontend_error');
    expect(payload.source).toBe('visible-workspaces');
    expect(payload.message).toContain('not a git repository');
    // 日志文案不得把 NUL 分隔符带进日志文件（会被判成二进制）
    expect(payload.message).not.toContain('\u0000');
    // 该单元仍是「未知」，不得被伪造成「干净」
    expect(useProjectStore.getState().statuses[key]).toBeUndefined();
  });

  it('整批命令失败（IPC reject）⇒ 只落日志，不再重发（没有重试环）', async () => {
    useWorkspaceStore.getState().setActiveWorkspace('p1', '/wt/a', 'feat-a');
    invokeSpy.mockImplementation((cmd: string) =>
      cmd === 'set_visible_workspaces'
        ? Promise.reject(new Error('ipc unavailable'))
        : Promise.resolve(null),
    );

    renderHook(() => useVisibleWorkspaces());

    await waitFor(() =>
      expect(invokeSpy.mock.calls.filter(([c]) => c === 'log_frontend_error')).toHaveLength(1),
    );
    // 自愈只由视图变化驱动：没有任何定时器/重试会把同一条声明再发一次
    await new Promise((r) => setTimeout(r, 50));
    expect(declareCalls()).toHaveLength(1);
  });
});
