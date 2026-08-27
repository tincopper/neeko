import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/shared/store/projectStore', () => ({
  useProjectStore: { setState: vi.fn() },
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

describe('refreshGitFileStates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('includeIgnored: true 时获取 changed_files 与 ignored_files 并 patch 到指定项目', async () => {
    mockGetWorktreeChangedFiles.mockResolvedValue([
      { path: 'new.ts', status: 'Untracked', additions: 0, deletions: 0 },
    ]);
    mockGetIgnoredFiles.mockResolvedValue(['.env', 'dist']);
    mockSetState.mockImplementation((updater) => {
      const state = makeState(
        [
          { id: 'p1', git_info: makeGitInfo() },
          { id: 'p2', git_info: makeGitInfo() },
        ],
        'p1',
      );
      const next = updater(state as never) as typeof state;
      // 目标项目被 patch（changed_files + ignored_files）
      expect(next.projects[0].git_info.changed_files).toHaveLength(1);
      expect(next.projects[0].git_info.changed_files[0].status).toBe('Untracked');
      expect(next.projects[0].git_info.is_clean).toBe(false);
      expect(next.projects[0].git_info.ignored_files).toEqual(['.env', 'dist']);
      // 其他项目不受影响
      expect(next.projects[1].git_info.changed_files).toHaveLength(0);
      expect(next.projects[1].git_info.ignored_files).toBeUndefined();
      // activeProject 同步更新
      expect(next.activeProject?.id).toBe('p1');
    });

    await refreshGitFileStates('p1', '', { includeIgnored: true });
    expect(mockGetWorktreeChangedFiles).toHaveBeenCalledWith('p1', '');
    expect(mockGetIgnoredFiles).toHaveBeenCalledWith('p1', '');
    expect(mockSetState).toHaveBeenCalledTimes(1);
  });

  it('默认（轻量模式）不拉取 ignored_files，且不覆盖既有灰显集合', async () => {
    mockGetWorktreeChangedFiles.mockResolvedValue([
      { path: 'a.ts', status: 'Modified', additions: 1, deletions: 0 },
    ]);
    mockSetState.mockImplementation((updater) => {
      const state = {
        projects: [
          {
            id: 'p1',
            git_info: { ...makeGitInfo(), ignored_files: ['.env'] },
          },
        ],
        activeProjectId: 'p1',
        activeProject: null,
      };
      const next = updater(state) as typeof state;
      // 关键回归（S0-2）：常规刷新不得清掉启动时加载的 ignored 集合
      expect(next.projects[0].git_info.ignored_files).toEqual(['.env']);
      expect(next.projects[0].git_info.changed_files).toHaveLength(1);
    });

    await refreshGitFileStates('p1', '');
    expect(mockGetWorktreeChangedFiles).toHaveBeenCalledWith('p1', '');
    expect(mockGetIgnoredFiles).not.toHaveBeenCalled();
    expect(mockSetState).toHaveBeenCalledTimes(1);
  });

  it('worktree 路径透传给两个 API（includeIgnored: true）', async () => {
    mockGetWorktreeChangedFiles.mockResolvedValue([]);
    mockGetIgnoredFiles.mockResolvedValue([]);
    await refreshGitFileStates('p1', '/wt/path', { includeIgnored: true });
    expect(mockGetWorktreeChangedFiles).toHaveBeenCalledWith('p1', '/wt/path');
    expect(mockGetIgnoredFiles).toHaveBeenCalledWith('p1', '/wt/path');
  });

  it('get_ignored_files 失败时回退为空列表（非 git 仓库，仅 includeIgnored: true 时相关）', async () => {
    mockGetWorktreeChangedFiles.mockResolvedValue([]);
    mockGetIgnoredFiles.mockRejectedValue(new Error('not a repo'));
    mockSetState.mockImplementation((updater) => {
      const state = makeState([{ id: 'p1', git_info: makeGitInfo() }], 'p1');
      const next = updater(state as never) as typeof state;
      expect(next.projects[0].git_info.ignored_files).toEqual([]);
    });
    await refreshGitFileStates('p1', '', { includeIgnored: true });
    expect(mockSetState).toHaveBeenCalledTimes(1);
  });

  it('changed_files 失败时静默忽略（不抛出、不 patch）', async () => {
    mockGetWorktreeChangedFiles.mockRejectedValue(new Error('boom'));
    mockGetIgnoredFiles.mockResolvedValue([]);
    await expect(refreshGitFileStates('p1', '')).resolves.toBeUndefined();
    expect(mockSetState).not.toHaveBeenCalled();
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

    // 第一次 setState 触发时（B 的快照）→ 解析 A，使 A 的 setState
    // 必定在 B 之后执行。这样无论 Node 微任务如何调度，陈旧结果都会
    // 在新结果之后抵达，fixed 实现能正确跳过 A 的 setState。
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
