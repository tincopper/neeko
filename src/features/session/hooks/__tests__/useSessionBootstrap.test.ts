import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// hoisted：确保 vi.mock 工厂执行前 mock 已初始化（工厂 eager 读取变量会触发 TDZ）。
const {
  mockListen,
  mockGetWorkspaceStatus,
  mockGetGitBranchInfo,
  mockGetAheadBehind,
  mockLoadSession,
  mockCanonicalWtPath,
} = vi.hoisted(() => ({
  mockListen: vi.fn(),
  mockGetWorkspaceStatus: vi.fn(),
  mockGetGitBranchInfo: vi.fn(),
  mockGetAheadBehind: vi.fn(),
  mockLoadSession: vi.fn(),
  mockCanonicalWtPath: vi.fn(),
}));

// Mock Tauri event API：捕获 listen 注册的 handler，模拟 git-changed 事件。
vi.mock('@tauri-apps/api/event', () => ({
  listen: (...args: unknown[]) => mockListen(...args),
}));

vi.mock('../../../git/api/gitApi', () => ({
  // status 读接口的唯一形态：按Workspace的 versioned 快照
  getWorkspaceStatus: mockGetWorkspaceStatus,
  activateWorkspace: vi.fn(() => Promise.resolve({})),
  getGitBranchInfo: mockGetGitBranchInfo,
  getAheadBehind: mockGetAheadBehind,
  canonicalWorktreePath: mockCanonicalWtPath,
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
      setStatusTruncated: vi.fn(),
    }),
  },
}));

import { GIT_CHANGED_EVENT } from '@/shared/events';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorkspaceStore } from '@/shared/store/workspaceStore';
import { workspaceKeyOf } from '@/shared/utils/workspaceRef';

import { useSessionBootstrap } from '../useSessionBootstrap';

const MAIN_KEY = workspaceKeyOf('p1', null);
const WT_KEY = workspaceKeyOf('p1', '/repo/wt/Test');

/** 从 listen mock 中取出指定事件的 handler。 */
function captureHandler(eventName: string) {
  const call = mockListen.mock.calls.find(([name]) => name === eventName);
  if (!call) throw new Error(`listener for ${eventName} was not registered`);
  return call[1] as (event: { payload: unknown }) => void;
}

function setup() {
  useProjectStore.setState({
    projects: [
      {
        id: 'p1',
        name: 'P1',
        path: '/repo/p1',
        // git 项目（git_info 非 null）：这些用例验证 git-changed 的**寻址**，
        // 非 git 项目会在守卫处直接返回（另一条用例覆盖）。
        git_info: { current_branch: 'master', branches: ['master'], worktrees: [] },
      } as never,
    ],
    activeProjectId: 'p1',
    activeProject: null,
    statuses: {},
  });
  useWorkspaceStore.setState({ byProject: {} });
  renderHook(() =>
    useSessionBootstrap({
      loadProjects: () => Promise.resolve(),
      restoreWorktreeState: () => {},
    }),
  );
}

beforeEach(() => {
  mockCanonicalWtPath.mockImplementation((_pid: string, path: string) => Promise.resolve(path));
  vi.useFakeTimers();
  vi.clearAllMocks();
  mockListen.mockReset();
  mockListen.mockResolvedValue(() => {});
  mockGetWorkspaceStatus.mockResolvedValue({
    workspace_key: MAIN_KEY,
    version: 1,
    project_id: 'p1',
    worktree_path: null,
    branch: 'master',
    entries: [],
    truncated: false,
    ahead: 0,
    behind: 0,
  });
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

describe('useSessionBootstrap — git-changed 按事件自带的Workspace刷新', () => {
  it('主仓单元事件 → getGitBranchInfo 传 null（而非空字符串，回归）；不再单独拉 ahead/behind', async () => {
    setup();

    const handler = captureHandler(GIT_CHANGED_EVENT);
    // 丢掉 bootstrap 自身启动拉取的调用记录，只断言事件驱动的这一次
    mockGetGitBranchInfo.mockClear();
    mockGetAheadBehind.mockClear();
    await act(async () => {
      handler({ payload: { workspace_key: MAIN_KEY, project_id: 'p1' } });
      await vi.advanceTimersByTimeAsync(600);
    });

    // 回归①：空字符串会被 Rust 端当字面路径 → 必须 null（→ Rust None → 项目根）。
    expect(mockGetGitBranchInfo).toHaveBeenCalledWith('p1', null);
    // ahead/behind 随权威快照 `git-status-snapshot` 单通道投递，事件刷新不再单独拉。
    expect(mockGetAheadBehind).not.toHaveBeenCalled();
  });

  it('worktree 单元事件 → 按该 worktree 路径刷新（身份来自事件，不来自全局状态）', async () => {
    setup();

    const handler = captureHandler(GIT_CHANGED_EVENT);
    // 丢掉 bootstrap 自身启动拉取的调用记录，只断言事件驱动的这一次
    mockGetGitBranchInfo.mockClear();
    mockGetAheadBehind.mockClear();
    await act(async () => {
      handler({ payload: { workspace_key: WT_KEY, project_id: 'p1' } });
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(mockGetGitBranchInfo).toHaveBeenCalledWith('p1', '/repo/wt/Test');
    expect(mockGetAheadBehind).not.toHaveBeenCalled();
  });

  it('回归：主仓事件不再被「当前正看 worktree」劫持（旧实现读全局镜像猜目标）', async () => {
    setup();
    // setup() 重置了 worktree store，renderHook 之后再置激活态模拟「正在看 worktree」
    useWorkspaceStore.setState({
      byProject: { p1: { activePath: '/repo/wt/Test', activeBranch: 'Test', opened: [] } },
    });

    const handler = captureHandler(GIT_CHANGED_EVENT);
    // 丢掉 bootstrap 自身启动拉取的调用记录，只断言事件驱动的这一次
    mockGetGitBranchInfo.mockClear();
    mockGetAheadBehind.mockClear();
    await act(async () => {
      handler({ payload: { workspace_key: MAIN_KEY, project_id: 'p1' } });
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(mockGetGitBranchInfo).toHaveBeenCalledWith('p1', null);
    expect(mockGetGitBranchInfo).not.toHaveBeenCalledWith('p1', '/repo/wt/Test');
  });
});

describe('useSessionBootstrap — 启动恢复 session 激活 worktree', () => {
  it('worktrees 加载后把 session 激活 worktree 恢复到单一表示 byProject', async () => {
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
    await act(async () => {});

    const unit = useWorkspaceStore.getState().byProject['p1'];
    expect(unit?.activePath).toBe('/repo/wt/Test');
    expect(unit?.activeBranch).toBe('Test');
    expect(unit?.opened).toEqual([{ path: '/repo/wt/Test', branch: 'Test' }]);
  });

  it('清单里匹配不上也照样把路径意图交给挂载点（前端不判路径死活 —— 红线 12）', async () => {
    // 匹配不上有两种成因：真被删了，或 session 里存的是**非 canonical 形态**
    // （`/tmp` ↔ `/private/tmp`）。后者在本仓里前端无法分辨，因此一律交给后端：
    // 解析得了就恢复（并把激活态改写成后端形态），解析不了由挂载点回落主仓。
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

    expect(useWorkspaceStore.getState().byProject['p1']?.activePath).toBe('/repo/wt/Gone');
    // 不在清单里就不进 opened（那部分是纯本地展示，没有身份含义）
    expect(useWorkspaceStore.getState().byProject['p1']?.opened).toEqual([]);
  });

  it('session 存的是符号链接形态路径 → 交后端归一后按 canonical 形态恢复（AC6）', async () => {
    mockLoadSession.mockResolvedValue({
      active_project_id: 'p1',
      worktree_state: { p1: '/tmp/repo/wt/Test' },
      sidebar_width: null,
    });
    mockGetGitBranchInfo.mockResolvedValue({
      current_branch: 'master',
      branches: ['master'],
      worktrees: [{ path: '/private/tmp/repo/wt/Test', branch: 'Test' }],
    });
    // 后端是路径身份的唯一归一点：/tmp 与 /private/tmp 指的是同一个目录
    mockCanonicalWtPath.mockImplementation((_pid: string, path: string) =>
      Promise.resolve(path.replace('/tmp/', '/private/tmp/')),
    );

    setup();
    await act(async () => {});

    // 必须恢复成**后端形态**：存活校验比的也是后端形态，写成 /tmp 形态会被立刻判没，
    // 表现为 main ↔ worktree 反复重挂（2026-09-28 隔离实例实测）。
    expect(useWorkspaceStore.getState().byProject['p1']?.activePath).toBe(
      '/private/tmp/repo/wt/Test',
    );
    expect(useWorkspaceStore.getState().byProject['p1']?.opened).toEqual([
      { path: '/private/tmp/repo/wt/Test', branch: 'Test' },
    ]);
  });
});

describe('useSessionBootstrap — 初始化兜底（splash 退出保证）', () => {
  function setupCaptureInitializing() {
    let initializing: boolean | undefined;
    useProjectStore.setState({
      projects: [{ id: 'p1', name: 'P1', path: '/repo/p1', git_info: null } as never],
      activeProjectId: 'p1',
      activeProject: null,
      statuses: {},
    });
    useWorkspaceStore.setState({ byProject: {} });
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
