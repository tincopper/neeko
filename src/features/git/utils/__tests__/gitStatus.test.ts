import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  setIgnoredFiles: vi.fn(),
}));

vi.mock('@/shared/store/projectStore', () => ({
  useProjectStore: { setState: vi.fn() },
}));

vi.mock('@/shared/store/gitStore', () => ({
  useGitStore: {
    getState: () => ({ setIgnoredFiles: mocks.setIgnoredFiles }),
  },
}));

vi.mock('../../api/gitApi', () => ({
  getWorktreeChangedFiles: vi.fn(),
  getIgnoredFiles: vi.fn(),
}));

import { useProjectStore } from '@/shared/store/projectStore';
import type { FileChange, GitInfo } from '@/shared/types';

import { getIgnoredFiles, getWorktreeChangedFiles } from '../../api/gitApi';
import { refreshGitFileStates, createDebouncedGitRefresh } from '../gitStatus';

const mockGetWorktreeChangedFiles = vi.mocked(getWorktreeChangedFiles);
const mockGetIgnoredFiles = vi.mocked(getIgnoredFiles);
const mockSetState = vi.mocked(useProjectStore.setState);
const mockSetIgnoredFiles = mocks.setIgnoredFiles;

const makeGitInfo = (changedFiles: FileChange[] = []): GitInfo => ({
  current_branch: 'main',
  branches: ['main'],
  worktrees: [],
  changed_files: changedFiles,
  is_clean: changedFiles.length === 0,
  git_provider: 'local',
});

interface TestProject {
  id: string;
  git_info: GitInfo;
}

const makeState = (projects: TestProject[], activeProjectId: string | null) => ({
  projects,
  activeProjectId,
  activeProject: activeProjectId ? (projects.find((p) => p.id === activeProjectId) ?? null) : null,
});

/**
 * 捕获 setState 的 updater 并在 await 之后手动执行断言。
 *
 * 不得在 mockImplementation 回调内断言：生产代码 refreshGitFileStates 的
 * try/catch 会吞掉回调内抛出的 AssertionError，导致断言失败被静默吞掉（假绿）。
 * 所有状态断言一律在 await 之后执行。
 */
const captureUpdater = () => {
  let captured: ((s: unknown) => unknown) | null = null;
  mockSetState.mockImplementation((updater) => {
    captured = updater;
  });
  return () => captured;
};

describe('refreshGitFileStates', () => {
  beforeEach(() => {
    // resetAllMocks：清除实现与调用记录，杜绝上一用例的 mockImplementation 泄漏进下一用例
    vi.resetAllMocks();
  });

  it('includeIgnored: true 时拉取 ignored_files 写入 gitStore，changed_files patch 到项目', async () => {
    mockGetWorktreeChangedFiles.mockResolvedValue([
      { path: 'new.ts', status: 'Untracked', additions: 0, deletions: 0 },
    ]);
    mockGetIgnoredFiles.mockResolvedValue(['.env', 'dist']);
    const takeUpdater = captureUpdater();

    await refreshGitFileStates('p1', '', { includeIgnored: true });

    expect(mockGetWorktreeChangedFiles).toHaveBeenCalledWith('p1', '');
    expect(mockGetIgnoredFiles).toHaveBeenCalledWith('p1', '');
    // ignored 集合写入独立 gitStore（不寄生 git_info —— 会被项目列表刷新洗掉）
    expect(mockSetIgnoredFiles).toHaveBeenCalledWith('p1', ['.env', 'dist']);

    const state = makeState(
      [
        { id: 'p1', git_info: makeGitInfo() },
        { id: 'p2', git_info: makeGitInfo() },
      ],
      'p1',
    );
    const next = takeUpdater()!(state) as typeof state;
    // 目标项目被 patch（changed_files）
    expect(next.projects[0].git_info.changed_files).toHaveLength(1);
    expect(next.projects[0].git_info.changed_files[0].status).toBe('Untracked');
    expect(next.projects[0].git_info.is_clean).toBe(false);
    // 其他项目不受影响
    expect(next.projects[1].git_info.changed_files).toHaveLength(0);
    // activeProject 同步更新
    expect(next.activeProject?.id).toBe('p1');
    expect(mockSetState).toHaveBeenCalledTimes(1);
  });

  it('默认（轻量模式）不拉取 ignored_files，且不覆盖 gitStore 既有灰显集合', async () => {
    mockGetWorktreeChangedFiles.mockResolvedValue([
      { path: 'a.ts', status: 'Modified', additions: 1, deletions: 0 },
    ]);
    const takeUpdater = captureUpdater();

    await refreshGitFileStates('p1', '');

    expect(mockGetWorktreeChangedFiles).toHaveBeenCalledWith('p1', '');
    expect(mockGetIgnoredFiles).not.toHaveBeenCalled();
    // 关键回归（S0-2）：常规刷新不得清掉启动时加载的 ignored 集合（gitStore 不被触碰）
    expect(mockSetIgnoredFiles).not.toHaveBeenCalled();

    const state = makeState([{ id: 'p1', git_info: makeGitInfo() }], 'p1');
    const next = takeUpdater()!(state) as typeof state;
    expect(next.projects[0].git_info.changed_files).toHaveLength(1);
    expect(mockSetState).toHaveBeenCalledTimes(1);
  });

  it('worktree 路径透传给两个 API（includeIgnored: true）', async () => {
    mockGetWorktreeChangedFiles.mockResolvedValue([]);
    mockGetIgnoredFiles.mockResolvedValue([]);
    const takeUpdater = captureUpdater();

    await refreshGitFileStates('p1', '/wt/path', { includeIgnored: true });

    expect(mockGetWorktreeChangedFiles).toHaveBeenCalledWith('p1', '/wt/path');
    expect(mockGetIgnoredFiles).toHaveBeenCalledWith('p1', '/wt/path');
    // 空 ignored 集合同样按 worktree 路径写入 gitStore
    expect(mockSetIgnoredFiles).toHaveBeenCalledWith('p1', []);
    expect(takeUpdater()).not.toBeNull();
  });

  it('get_ignored_files 失败时回退为空列表并写入 gitStore（includeIgnored: true）', async () => {
    mockGetWorktreeChangedFiles.mockResolvedValue([]);
    mockGetIgnoredFiles.mockRejectedValue(new Error('not a repo'));
    const takeUpdater = captureUpdater();

    await refreshGitFileStates('p1', '', { includeIgnored: true });

    // 非 git 仓库：getIgnoredFiles 失败 → 回退空列表 → 覆盖 gitStore 灰显集合为空
    expect(mockSetIgnoredFiles).toHaveBeenCalledWith('p1', []);
    expect(takeUpdater()).not.toBeNull();
    expect(mockSetState).toHaveBeenCalledTimes(1);
  });

  it('changed_files 失败时静默忽略（不抛出、不 patch）', async () => {
    mockGetWorktreeChangedFiles.mockRejectedValue(new Error('boom'));
    mockGetIgnoredFiles.mockResolvedValue([]);
    await expect(refreshGitFileStates('p1', '')).resolves.toBeUndefined();
    expect(mockSetState).not.toHaveBeenCalled();
    expect(mockSetIgnoredFiles).not.toHaveBeenCalled();
  });

  it('并发刷新时仅最新一代的全量快照生效，陈旧请求的结果被丢弃', async () => {
    // 复现 build 场景：git-changed 短时间内多次触发 refreshGitFileStates。
    // 较早发出的 A 请求较慢、较晚发出的 B 请求较快。
    // 期望 B（更新）的快照最终生效；A（陈旧）解析后 setState 被跳过。
    //
    // 为避免依赖微任务调度顺序（Node 上两条 setState 相对顺序不稳定），
    // 用 mockSetState 的实现作为信号：第一次 setState（B 的快照）触发后再
    // 解析 A，从而保证 A 的 setState 一定在 B 之后执行。
    let resolveA!: (v: FileChange[]) => void;
    let resolveB!: (v: FileChange[]) => void;
    const promiseA = new Promise<FileChange[]>((r) => {
      resolveA = r;
    });
    const promiseB = new Promise<FileChange[]>((r) => {
      resolveB = r;
    });
    mockGetWorktreeChangedFiles
      .mockReturnValueOnce(promiseA as never)
      .mockReturnValueOnce(promiseB as never);
    mockGetIgnoredFiles.mockResolvedValue([]);

    let firstSetStateResolve!: () => void;
    const firstSetStateDone = new Promise<void>((r) => {
      firstSetStateResolve = r;
    });
    let setStateCount = 0;
    mockSetState.mockImplementation(() => {
      setStateCount += 1;
      if (setStateCount === 1) {
        resolveA([{ path: 'stale.ts', status: 'Modified', additions: 0, deletions: 0 }]);
        firstSetStateResolve();
      }
    });

    const callA = refreshGitFileStates('p1', '');
    const callB = refreshGitFileStates('p1', '');

    // B 先返回（build 后期发出，捕获更新快照）
    resolveB([{ path: 'newer.ts', status: 'Modified', additions: 1, deletions: 0 }]);

    // 等待 B 的 setState 触发（A 在该回调内被解析）
    await firstSetStateDone;

    await callA;
    await callB;

    // 至少应有一次 setState（来自 B）；A 的迟到结果不应覆盖 B。
    expect(mockSetState).toHaveBeenCalled();
    const calls = mockSetState.mock.calls;
    const lastUpdater = calls[calls.length - 1][0] as (s: unknown) => unknown;
    const state = makeState([{ id: 'p1', git_info: makeGitInfo() }], 'p1');
    const next = lastUpdater(state) as { projects: { git_info: GitInfo }[] };
    expect(next.projects[0].git_info.changed_files).toEqual([
      { path: 'newer.ts', status: 'Modified', additions: 1, deletions: 0 },
    ]);
    // 轻量模式：并发刷新不触碰 gitStore
    expect(mockSetIgnoredFiles).not.toHaveBeenCalled();
  });
});

describe('createDebouncedGitRefresh', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('窗口内多次 schedule 同一 projectId 只执行一次，且用最新 worktreePath', () => {
    const debounced = createDebouncedGitRefresh(500);
    const run = vi.fn();

    // build 期间事件风暴：同一 projectId 在窗口内连续触发多次
    debounced.schedule('p1', '', run);
    debounced.schedule('p1', '', run);
    debounced.schedule('p1', '/wt/path', run);

    expect(run).not.toHaveBeenCalled();

    // 窗口尚未结束：仍不应执行
    vi.advanceTimersByTime(499);
    expect(run).not.toHaveBeenCalled();

    // 窗口结束：仅执行一次，且 worktreePath 为最新一次调度的值
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('/wt/path');
  });

  it('不同 projectId 的去抖窗口相互独立', () => {
    const debounced = createDebouncedGitRefresh(500);
    const runA = vi.fn();
    const runB = vi.fn();

    debounced.schedule('p1', '', runA);
    debounced.schedule('p2', '', runB);

    // 推进 300ms 后 p1 再次调度：p2 的窗口继续，p1 的窗口重置
    vi.advanceTimersByTime(300);
    debounced.schedule('p1', '', runA);

    vi.advanceTimersByTime(200);
    // p2 窗口（500ms）到期执行；p1 被重置后仍未到期
    expect(runB).toHaveBeenCalledTimes(1);
    expect(runA).not.toHaveBeenCalled();

    vi.advanceTimersByTime(300);
    expect(runA).toHaveBeenCalledTimes(1);
  });

  it('clear() 取消全部 pending 调度，之后不再执行', () => {
    const debounced = createDebouncedGitRefresh(500);
    const run = vi.fn();

    debounced.schedule('p1', '', run);
    debounced.schedule('p2', '', run);
    debounced.clear();

    vi.advanceTimersByTime(1000);
    expect(run).not.toHaveBeenCalled();
  });
});
