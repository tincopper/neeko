import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type FocusCb = (event: { payload: boolean }) => void;
type Listener = (event: { payload: unknown }) => void;

const { focusHandlers, listeners, invokeSpy } = vi.hoisted(() => ({
  focusHandlers: [] as FocusCb[],
  listeners: {} as Record<string, Listener[]>,
  invokeSpy: vi.fn(),
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: vi.fn(() => ({
    onFocusChanged: vi.fn((cb: FocusCb) => {
      focusHandlers.push(cb);
      return Promise.resolve(() => {});
    }),
  })),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((event: string, cb: Listener) => {
    (listeners[event] ??= []).push(cb);
    return Promise.resolve(() => {});
  }),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeSpy,
  convertFileSrc: vi.fn((path: string) => `asset://localhost/${path}`),
}));

import { GIT_CHANGED_EVENT, GIT_STATUS_SNAPSHOT_EVENT } from '@/shared/events';
import { useGitStore } from '@/shared/store/gitStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorkspaceStore } from '@/shared/store/workspaceStore';
import { workspaceKeyOf } from '@/shared/utils/workspaceRef';

import { useGitStatusEventsSync } from '../useGitStatusEventsSync';

const DEBOUNCE_MS = 500;
const MAIN_KEY = workspaceKeyOf('p1', null);
const WT_KEY = workspaceKeyOf('p1', '/wt/a');

function snapshot(overrides: Record<string, unknown>) {
  return {
    workspace_key: MAIN_KEY,
    version: 1,
    project_id: 'p1',
    worktree_path: null,
    branch: 'main',
    entries: [],
    truncated: false,
    ahead: 0,
    behind: 0,
    ...overrides,
  };
}

function emit(event: string, payload: unknown) {
  for (const cb of listeners[event] ?? []) cb({ payload });
}

describe('useGitStatusEventsSync — 事件按Workspace定址', () => {
  beforeEach(() => {
    focusHandlers.length = 0;
    for (const key of Object.keys(listeners)) delete listeners[key];
    invokeSpy.mockReset();
    invokeSpy.mockImplementation((cmd: string) => {
      if (cmd === 'get_workspace_status') {
        return Promise.resolve(snapshot({ version: 9, entries: [{ path: 'from-pull.ts' }] }));
      }
      if (cmd === 'get_git_branch_info') {
        return Promise.resolve({ current_branch: 'main', branches: [], worktrees: [] });
      }
      return Promise.resolve(null);
    });
    useProjectStore.setState({
      activeProjectId: 'p1',
      projects: [{ id: 'p1', git_info: { current_branch: 'main', branches: [], worktrees: [] } }],
      activeProject: null,
      statuses: {},
    } as never);
    useWorkspaceStore.setState({ byProject: {} });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('focused=true 时只刷新**当前视图单元**（不写死主仓）', async () => {
    useWorkspaceStore.setState({
      byProject: { p1: { activePath: '/wt/a', activeBranch: 'wt', opened: [] } },
    });
    renderHook(() => useGitStatusEventsSync());
    await waitFor(() => expect(focusHandlers.length).toBe(1));

    act(() => {
      focusHandlers[0]({ payload: true });
    });

    await waitFor(() =>
      expect(invokeSpy).toHaveBeenCalledWith('get_workspace_status', {
        projectId: 'p1',
        worktreePath: '/wt/a',
      }),
    );
    // 回归：旧实现在此处传 ''（主仓），把主仓的变更列表写进 worktree 视图
    expect(invokeSpy).not.toHaveBeenCalledWith(
      'get_workspace_status',
      expect.objectContaining({ worktreePath: null }),
    );
  });

  it('focused=false 时不触发刷新', async () => {
    renderHook(() => useGitStatusEventsSync());
    await waitFor(() => expect(focusHandlers.length).toBe(1));

    act(() => {
      focusHandlers[0]({ payload: false });
    });

    await new Promise((r) => setTimeout(r, DEBOUNCE_MS + 200));
    expect(invokeSpy).not.toHaveBeenCalledWith('get_workspace_status', expect.anything());
  });

  it('无 activeProjectId 时不触发刷新', async () => {
    useProjectStore.setState({ activeProjectId: null, projects: [], activeProject: null } as never);
    renderHook(() => useGitStatusEventsSync());
    await waitFor(() => expect(focusHandlers.length).toBe(1));

    act(() => {
      focusHandlers[0]({ payload: true });
    });

    await new Promise((r) => setTimeout(r, DEBOUNCE_MS + 200));
    expect(invokeSpy).not.toHaveBeenCalledWith('get_workspace_status', expect.anything());
  });

  it('主仓快照落在主仓槽位，不覆盖正在查看的 worktree 槽位', async () => {
    useProjectStore.setState({
      statuses: {
        [WT_KEY]: snapshot({
          workspace_key: WT_KEY,
          worktree_path: '/wt/a',
          version: 3,
          entries: [{ path: 'wt-only.ts' }],
        }),
      },
    } as never);
    useWorkspaceStore.setState({
      byProject: { p1: { activePath: '/wt/a', activeBranch: 'wt', opened: [] } },
    });
    renderHook(() => useGitStatusEventsSync());
    await waitFor(() => expect(listeners[GIT_STATUS_SNAPSHOT_EVENT]?.length).toBe(1));

    emit(GIT_STATUS_SNAPSHOT_EVENT, snapshot({ version: 4, entries: [{ path: 'main-only.ts' }] }));

    await waitFor(() =>
      expect(
        (useProjectStore.getState().statuses as Record<string, never>)[MAIN_KEY],
      ).toBeDefined(),
    );
    const store = useProjectStore.getState();
    // 两个视图各看自己的槽：主仓事件不再需要「worktree 激活时丢弃」的守卫
    expect((store.statuses[WT_KEY] as { entries: { path: string }[] }).entries[0].path).toBe(
      'wt-only.ts',
    );
    expect((store.statuses[MAIN_KEY] as { entries: { path: string }[] }).entries[0].path).toBe(
      'main-only.ts',
    );
  });

  it('git-changed 刷新事件自己的单元，而不是当前激活单元', async () => {
    useWorkspaceStore.setState({
      byProject: { p1: { activePath: '/wt/a', activeBranch: 'wt', opened: [] } },
    });
    renderHook(() => useGitStatusEventsSync());
    await waitFor(() => expect(listeners[GIT_CHANGED_EVENT]?.length).toBe(1));

    invokeSpy.mockClear();
    emit(GIT_CHANGED_EVENT, { workspace_key: MAIN_KEY, project_id: 'p1' });

    await waitFor(() =>
      expect(invokeSpy).toHaveBeenCalledWith('get_workspace_status', {
        projectId: 'p1',
        worktreePath: null,
      }),
    );
    // 回归：旧实现从全局镜像取 worktree 路径 → 主仓的元数据变化会去刷 worktree，
    // 反之亦然（「列表不动」与「串数据」的共同根因）
    expect(invokeSpy).not.toHaveBeenCalledWith('get_workspace_status', {
      projectId: 'p1',
      worktreePath: '/wt/a',
    });
  });

  it('收到含 ahead/behind 的快照后写入 gitStore.aheadBehind[workspaceKey]（单通道）', async () => {
    useGitStore.setState({ aheadBehind: {} });
    renderHook(() => useGitStatusEventsSync());
    await waitFor(() => expect(listeners[GIT_STATUS_SNAPSHOT_EVENT]?.length).toBe(1));

    emit(GIT_STATUS_SNAPSHOT_EVENT, snapshot({ version: 2, ahead: 3, behind: 1 }));

    await waitFor(() =>
      expect(useGitStore.getState().aheadBehind[MAIN_KEY]).toEqual({ ahead: 3, behind: 1 }),
    );
    // 不同单元的键互不影响（键 = WorkspaceKey）
    expect(useGitStore.getState().aheadBehind[WT_KEY]).toBeUndefined();
  });

  it('同一单元的旧版本快照被拒（per-workspace version gate）', async () => {
    useProjectStore.setState({
      statuses: { [MAIN_KEY]: snapshot({ version: 7, entries: [{ path: 'new.ts' }] }) },
    } as never);
    renderHook(() => useGitStatusEventsSync());
    await waitFor(() => expect(listeners[GIT_STATUS_SNAPSHOT_EVENT]?.length).toBe(1));

    emit(GIT_STATUS_SNAPSHOT_EVENT, snapshot({ version: 6, entries: [{ path: 'old.ts' }] }));
    await new Promise((r) => setTimeout(r, 100));

    const kept = (useProjectStore.getState().statuses as Record<string, { version: number }>)[
      MAIN_KEY
    ];
    expect(kept.version).toBe(7);
  });

  it('被拒的陈旧快照不得覆盖 ahead/behind（Fix 3：徽标同样过 version gate）', async () => {
    useProjectStore.setState({
      statuses: { [MAIN_KEY]: snapshot({ version: 7, entries: [{ path: 'new.ts' }] }) },
    } as never);
    useGitStore.setState({ aheadBehind: { [String(MAIN_KEY)]: { ahead: 4, behind: 2 } } });
    renderHook(() => useGitStatusEventsSync());
    await waitFor(() => expect(listeners[GIT_STATUS_SNAPSHOT_EVENT]?.length).toBe(1));

    // 陈旧快照（更低版本）带不同的 ahead/behind：被 applyStatus 拒绝，徽标不得被改写
    emit(GIT_STATUS_SNAPSHOT_EVENT, snapshot({ version: 6, ahead: 9, behind: 9 }));
    await new Promise((r) => setTimeout(r, 100));

    expect(useGitStore.getState().aheadBehind[String(MAIN_KEY)]).toEqual({ ahead: 4, behind: 2 });
  });

  it('另一个单元的高版本不影响本单元的门控', async () => {
    useProjectStore.setState({
      statuses: {
        [WT_KEY]: snapshot({ workspace_key: WT_KEY, worktree_path: '/wt/a', version: 50 }),
      },
    } as never);
    renderHook(() => useGitStatusEventsSync());
    await waitFor(() => expect(listeners[GIT_STATUS_SNAPSHOT_EVENT]?.length).toBe(1));

    emit(GIT_STATUS_SNAPSHOT_EVENT, snapshot({ version: 1, entries: [{ path: 'main.ts' }] }));
    await waitFor(() =>
      expect(
        (useProjectStore.getState().statuses as Record<string, never>)[MAIN_KEY],
      ).toBeDefined(),
    );
  });
});

describe('useGitStatusEventsSync — 失焦/聚焦连击下单元不串（AC1 的连击面）', () => {
  beforeEach(() => {
    // 事件注册口是 hoisted 的模块级数组，跨 describe 不清就会拿到上一个用例留下的 handler
    focusHandlers.length = 0;
    for (const key of Object.keys(listeners)) delete listeners[key];
    invokeSpy.mockReset();
    useProjectStore.setState({ statuses: {} } as never);
    useWorkspaceStore.setState({ byProject: {} });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('聚焦 10 次后，worktree 单元的槽位仍只含它自己的数据，且不为已卸载的主仓产数据', async () => {
    // 每轮刷新都要过 500ms 去抖窗口，10 轮用真实计时器要 5s+ 且不稳定 → 本用例走假计时器。
    vi.useFakeTimers();
    try {
      useWorkspaceStore.setState({
        byProject: { p1: { activePath: '/wt/a', activeBranch: 'feat-a', opened: [] } },
      });
      invokeSpy.mockImplementation((cmd: string, args?: { worktreePath?: string | null }) => {
        if (cmd === 'get_workspace_status') {
          const wt = args?.worktreePath ?? null;
          return Promise.resolve(
            snapshot({
              workspace_key: wt ? WT_KEY : MAIN_KEY,
              worktree_path: wt,
              version: 5,
              entries: [{ path: wt ? 'only-in-wt.ts' : 'only-in-main.ts' }],
            }),
          );
        }
        return Promise.resolve(null);
      });
      renderHook(() => useGitStatusEventsSync());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(focusHandlers.length).toBe(1);

      for (let i = 0; i < 10; i += 1) {
        await act(async () => {
          focusHandlers[0]({ payload: false });
          focusHandlers[0]({ payload: true });
        });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 50);
        });
      }

      const st = useProjectStore.getState().statuses as Record<string, never>;
      // 原缺陷：聚焦刷新写死主仓（`''`），第一次聚焦就把正在看的 worktree 覆盖成主仓内容
      expect(st[String(WT_KEY)]?.entries.map((e: { path: string }) => e.path)).toEqual([
        'only-in-wt.ts',
      ]);
      expect(st[String(MAIN_KEY)]).toBeUndefined();
      // 连击不产生第三个形态（旧实现里空串 worktreePath 会另开一格）
      expect(Object.keys(st)).toEqual([String(WT_KEY)]);
    } finally {
      vi.useRealTimers();
    }
  });
});
