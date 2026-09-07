import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  versionGateAccepts: vi.fn(() => true),
}));

vi.mock('@/shared/store/projectStore', () => ({
  useProjectStore: { setState: vi.fn() },
  // G2 version gate 已由 projectStore 单测覆盖；此处放行以聚焦本模块逻辑
  versionGateAccepts: mocks.versionGateAccepts,
}));

vi.mock('../../api/gitApi', () => ({
  getWorktreeChangedFilesVersioned: vi.fn(),
}));

import { useProjectStore } from '@/shared/store/projectStore';
import type { FileChange, ChangedFilesPayload, GitInfo } from '@/shared/types';

import { getWorktreeChangedFilesVersioned } from '../../api/gitApi';
import { refreshGitFileStates, createDebouncedGitRefresh } from '../gitStatus';

const mockGetWorktreeChangedFiles = vi.mocked(getWorktreeChangedFilesVersioned);
const mockSetState = vi.mocked(useProjectStore.setState);

const payload = (files: FileChange[], version = 0): ChangedFilesPayload => ({ files, version });

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

  it('worktree 路径透传给变更快照 API', async () => {
    mockGetWorktreeChangedFiles.mockResolvedValue(payload([]));
    const takeUpdater = captureUpdater();

    await refreshGitFileStates('p1', '/wt/path');

    expect(mockGetWorktreeChangedFiles).toHaveBeenCalledWith('p1', '/wt/path');
    expect(takeUpdater()).not.toBeNull();
  });

  it('changed_files 失败时静默忽略（不抛出、不 patch）', async () => {
    mockGetWorktreeChangedFiles.mockRejectedValue(new Error('boom'));
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
    let resolveA!: (v: ChangedFilesPayload) => void;
    let resolveB!: (v: ChangedFilesPayload) => void;
    const promiseA = new Promise<ChangedFilesPayload>((r) => {
      resolveA = r;
    });
    const promiseB = new Promise<ChangedFilesPayload>((r) => {
      resolveB = r;
    });
    mockGetWorktreeChangedFiles
      .mockReturnValueOnce(promiseA as never)
      .mockReturnValueOnce(promiseB as never);

    let firstSetStateResolve!: () => void;
    const firstSetStateDone = new Promise<void>((r) => {
      firstSetStateResolve = r;
    });
    let setStateCount = 0;
    mockSetState.mockImplementation(() => {
      setStateCount += 1;
      if (setStateCount === 1) {
        resolveA(payload([{ path: 'stale.ts', status: 'Modified', additions: 0, deletions: 0 }]));
        firstSetStateResolve();
      }
    });

    const callA = refreshGitFileStates('p1', '');
    const callB = refreshGitFileStates('p1', '');

    // B 先返回（build 后期发出，捕获更新快照）
    resolveB(payload([{ path: 'newer.ts', status: 'Modified', additions: 1, deletions: 0 }]));

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
