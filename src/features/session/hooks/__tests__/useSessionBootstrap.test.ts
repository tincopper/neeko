import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// hoisted：确保 vi.mock 工厂执行前 mock 已初始化（工厂 eager 读取变量会触发 TDZ）。
const { mockListen, mockGetGitBranchInfo, mockGetAheadBehind, mockLoadSession } = vi.hoisted(
  () => ({
    mockListen: vi.fn(),
    mockGetGitBranchInfo: vi.fn(),
    mockGetAheadBehind: vi.fn(),
    mockLoadSession: vi.fn(),
  }),
);

// Mock Tauri event API：捕获 listen 注册的 handler，模拟 git-changed 事件。
vi.mock('@tauri-apps/api/event', () => ({
  listen: (...args: unknown[]) => mockListen(...args),
}));

vi.mock('../../../git/api/gitApi', () => ({
  getIgnoredFiles: vi.fn(() => Promise.resolve([])),
  getWorktreeChangedFiles: vi.fn(() => Promise.resolve([])),
  getGitBranchInfo: mockGetGitBranchInfo,
  getAheadBehind: mockGetAheadBehind,
}));

vi.mock('../../../project/api/projectApi', () => ({
  listProjects: vi.fn(() => Promise.resolve([])),
}));

vi.mock('../../api/sessionApi', () => ({
  loadSession: mockLoadSession,
}));

vi.mock('@/shared/store/gitStore', () => ({
  useGitStore: {
    getState: () => ({
      setAheadBehind: vi.fn(),
      ignoredByProject: {},
      setIgnoredFiles: vi.fn(),
    }),
  },
}));

import { GIT_CHANGED_EVENT } from '@/shared/events';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorktreeStore } from '@/shared/store/worktreeStore';

import { useSessionBootstrap } from '../useSessionBootstrap';

/** 从 listen mock 中取出指定事件的 handler。 */
function captureHandler(eventName: string) {
  const call = mockListen.mock.calls.find(([name]) => name === eventName);
  if (!call) throw new Error(`listener for ${eventName} was not registered`);
  return call[1] as (payload: { payload: string }) => void;
}

function setup() {
  useProjectStore.setState({
    projects: [
      {
        id: 'p1',
        name: 'P1',
        path: '/repo/p1',
        git_info: null,
      } as never,
    ],
    activeProjectId: 'p1',
    activeProject: null,
  });
  useWorktreeStore.setState({
    activeWorktreePath: null,
    activeWorktreeBranch: '',
    openedWorktrees: [],
    worktreeStateMap: {},
  });
  renderHook(() =>
    useSessionBootstrap({
      loadProjects: () => Promise.resolve(),
      restoreWorktreeState: () => {},
    }),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mockListen.mockReset();
  mockListen.mockResolvedValue(() => {});
  mockLoadSession.mockResolvedValue({
    active_project_id: null,
    worktree_state: {},
    sidebar_width: null,
  });
  mockGetGitBranchInfo.mockResolvedValue({
    current_branch: 'master',
    branches: ['master'],
    worktrees: [],
  });
  mockGetAheadBehind.mockResolvedValue({ ahead: 0, behind: 0 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useSessionBootstrap — git-changed 刷新的 worktree 路径', () => {
  it('无激活 worktree 时 getGitBranchInfo/getAheadBehind 传 null（而非空字符串，回归）', async () => {
    setup();

    const handler = captureHandler(GIT_CHANGED_EVENT);
    await act(async () => {
      handler({ payload: 'p1' });
      await vi.advanceTimersByTimeAsync(600);
    });

    // 回归断言：空字符串会被 Rust 端当作字面路径、落到 shell 回退在 app CWD 跑 git，
    // 必须转成 null（→ Rust None → 项目根目录）。
    expect(mockGetGitBranchInfo).toHaveBeenCalledWith('p1', null);
    expect(mockGetAheadBehind).toHaveBeenCalledWith('p1', null);
  });

  it('激活 worktree 时按 worktree 路径刷新', async () => {
    setup();
    // setup() 会重置 worktree store，需在 renderHook 之后再设置激活态
    useWorktreeStore.setState({ activeWorktreePath: '/repo/wt/Test' });

    const handler = captureHandler(GIT_CHANGED_EVENT);
    await act(async () => {
      handler({ payload: 'p1' });
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(mockGetGitBranchInfo).toHaveBeenCalledWith('p1', '/repo/wt/Test');
    expect(mockGetAheadBehind).toHaveBeenCalledWith('p1', '/repo/wt/Test');
  });
});

describe('useSessionBootstrap — 启动恢复 session 激活 worktree', () => {
  it('worktrees 加载后把 session 激活 worktree 恢复到 store', async () => {
    mockLoadSession.mockResolvedValue({
      active_project_id: 'p1',
      worktree_state: { p1: '/repo/wt/Test' },
      sidebar_width: null,
    });
    mockGetGitBranchInfo.mockResolvedValue({
      current_branch: 'master',
      branches: ['master'],
      worktrees: [{ path: '/repo/wt/Test', branch: 'Test' }],
    });

    setup();
    // setup() 默认给非 git 项目（git_info=null）；恢复激活 worktree 需要 git
    // 项目路径（hook 对非 git 项目跳过所有 git 操作），这里显式覆盖。
    useProjectStore.setState((s) => ({
      projects: s.projects.map((p) => (p.id === 'p1' ? { ...p, git_info: {} } : p)),
    }));
    await act(async () => {});

    expect(useWorktreeStore.getState().activeWorktreePath).toBe('/repo/wt/Test');
    expect(useWorktreeStore.getState().worktreeStateMap['p1']?.activePath).toBe('/repo/wt/Test');
    expect(useWorktreeStore.getState().worktreeStateMap['p1']?.opened).toEqual([
      { path: '/repo/wt/Test', branch: 'Test' },
    ]);
  });

  it('worktree 已不存在时不恢复激活态', async () => {
    mockLoadSession.mockResolvedValue({
      active_project_id: 'p1',
      worktree_state: { p1: '/repo/wt/Gone' },
      sidebar_width: null,
    });
    mockGetGitBranchInfo.mockResolvedValue({
      current_branch: 'master',
      branches: ['master'],
      worktrees: [{ path: '/repo/wt/Test', branch: 'Test' }],
    });

    setup();
    await act(async () => {});

    expect(useWorktreeStore.getState().activeWorktreePath).toBeNull();
    expect(useWorktreeStore.getState().worktreeStateMap['p1']?.activePath).toBeUndefined();
  });
});

describe('useSessionBootstrap — 初始化兜底（splash 退出保证）', () => {
  function setupCaptureInitializing() {
    let initializing: boolean | undefined;
    useProjectStore.setState({
      projects: [{ id: 'p1', name: 'P1', path: '/repo/p1', git_info: null } as never],
      activeProjectId: 'p1',
      activeProject: null,
    });
    useWorktreeStore.setState({
      activeWorktreePath: null,
      activeWorktreeBranch: '',
      openedWorktrees: [],
      worktreeStateMap: {},
    });
    renderHook(() => {
      const r = useSessionBootstrap({
        loadProjects: () => Promise.resolve(),
        restoreWorktreeState: () => {},
      });
      initializing = r.initializing;
    });
    return () => initializing;
  }

  it('loadSession 失败也要退出 splash（否则纯浏览器/损坏 session 永久卡死）', async () => {
    mockLoadSession.mockRejectedValue(new Error('load_session unavailable'));
    const getInitializing = setupCaptureInitializing();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(getInitializing()).toBe(false);
  });

  it('初始化挂起时超时兜底退出 splash', async () => {
    // 永不 settle 的 loadSession
    mockLoadSession.mockImplementation(() => new Promise(() => {}));
    const getInitializing = setupCaptureInitializing();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(getInitializing()).toBe(false);
  });
});
