import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GIT_CHANGED_EVENT, GIT_STATUS_SNAPSHOT_EVENT } from '@/shared/events';

import { fileLineChangesField } from '../../git-change';
import { useGitChangeEditor } from '../useGitChangeEditor';

const mocks = vi.hoisted(() => ({
  getFileDiff: vi.fn(),
  // 捕获 listen 注册的 handler，按事件名模拟触发
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
  unlistens: [] as Array<() => void>,
  // useFileChangedEvent 共享订阅的回调集合（mock 隔离模块单例）
  fileChangedCbs: new Set<(payload: unknown) => void>(),
}));

vi.mock('@/features/git/api/gitApi', () => ({
  getFileDiff: mocks.getFileDiff,
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((name: string, cb: (event: { payload: unknown }) => void) => {
    mocks.listeners.set(name, cb);
    const unlisten = () => {
      mocks.listeners.delete(name);
    };
    mocks.unlistens.push(unlisten);
    return Promise.resolve(unlisten);
  }),
  emit: vi.fn(() => Promise.resolve()),
  convertFileSrc: vi.fn((p: string) => p),
}));

vi.mock('@/shared/hooks/useFileChangedEvent', async () => {
  const { useEffect } = await import('react');
  return {
    useFileChangedEvent: (cb: (payload: unknown) => void) => {
      mocks.fileChangedCbs.add(cb);
      useEffect(
        () => () => {
          mocks.fileChangedCbs.delete(cb);
        },
        [cb],
      );
    },
  };
});

function emitFileChanged(payload: unknown) {
  for (const cb of mocks.fileChangedCbs) cb(payload);
}

const PROJECT_ID = 'p1';
const PROJECT_ROOT = '/repo';
const FILE_PATH = '/repo/src/a.ts';
const REPO_REL_PATH = 'src/a.ts';
const WORKTREE = null;

function baseParams(enabled: boolean) {
  return {
    enabled,
    projectId: PROJECT_ID,
    filePath: FILE_PATH,
    projectRoot: PROJECT_ROOT,
    worktreePath: WORKTREE,
    editorViewRef: { current: null } as { current: EditorView | null },
    editorViewEpoch: 0,
  };
}

function resolveAddedDiff() {
  return {
    hunks: [
      {
        old_start: 1,
        old_lines: 1,
        new_start: 1,
        new_lines: 1,
        lines: [{ Added: 'hello' }],
      },
    ],
  };
}

describe('useGitChangeEditor', () => {
  beforeEach(() => {
    mocks.getFileDiff.mockReset();
    mocks.listeners.clear();
    mocks.unlistens.length = 0;
    mocks.fileChangedCbs.clear();
  });

  it('enabled=false → extensions 为空数组且不触发 fetch', () => {
    const { result } = renderHook(() => useGitChangeEditor(baseParams(false)));
    expect(result.current).toEqual([]);
    expect(mocks.getFileDiff).not.toHaveBeenCalled();
  });

  it('enabled=true + fetch 成功 → 派发后 field 内容正确', async () => {
    mocks.getFileDiff.mockResolvedValue({
      hunks: [
        {
          old_start: 1,
          old_lines: 1,
          new_start: 1,
          new_lines: 1,
          lines: [{ Added: 'hello' }],
        },
      ],
    });

    // 模拟真实时序：首拉时 view 尚未创建（epoch=0），创建后 epoch 变更补派发
    let epoch = 0;
    const editorViewRef = { current: null as EditorView | null };
    const { result, rerender } = renderHook(() =>
      useGitChangeEditor({ ...baseParams(true), editorViewRef, editorViewEpoch: epoch }),
    );

    expect(result.current.length).toBeGreaterThan(0);

    await waitFor(() => {
      // 绝对 tab.filePath 必须剥根为仓库相对路径（get_file_diff path_guard 拒绝绝对路径）
      expect(mocks.getFileDiff).toHaveBeenCalledWith(PROJECT_ID, REPO_REL_PATH, WORKTREE, false);
    });
    // 首拉完成但 view 为 null → 数据缓存在 hook 内
    await waitFor(() => {
      expect(mocks.getFileDiff).toHaveBeenCalledTimes(1);
    });

    const view = new EditorView({
      state: EditorState.create({
        doc: 'hello\nworld\n',
        extensions: result.current,
      }),
    });
    editorViewRef.current = view;
    epoch = 1;
    rerender();

    await waitFor(() => {
      expect(view.state.field(fileLineChangesField)).toEqual([{ line: 1, kind: 'added' }]);
    });
    // 同 key 补派发不重复 fetch
    expect(mocks.getFileDiff).toHaveBeenCalledTimes(1);

    view.destroy();
  });

  it('worktree 激活 → 以 worktree 根剥根，worktreePath 原样透传', async () => {
    mocks.getFileDiff.mockResolvedValue(resolveAddedDiff());
    const wt = '/repo/.git/wt/feature';
    const editorViewRef = { current: null as EditorView | null };
    renderHook(() =>
      useGitChangeEditor({
        ...baseParams(true),
        filePath: `${wt}/src/a.ts`,
        projectRoot: PROJECT_ROOT,
        worktreePath: wt,
        editorViewRef,
      }),
    );
    await waitFor(() => {
      expect(mocks.getFileDiff).toHaveBeenCalledWith(PROJECT_ID, REPO_REL_PATH, wt, false);
    });
  });

  it('非 fs 身份（jdt:/dap-source:）→ 不触发 fetch', async () => {
    const editorViewRef = { current: null as EditorView | null };
    const { result } = renderHook(() =>
      useGitChangeEditor({
        ...baseParams(true),
        filePath: 'jdt:/java.base/java/lang/System.java',
        editorViewRef,
      }),
    );
    expect(result.current.length).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 10));
    expect(mocks.getFileDiff).not.toHaveBeenCalled();
  });

  it('projectRoot 缺失且路径为绝对路径 → 不触发 fetch', async () => {
    const editorViewRef = { current: null as EditorView | null };
    renderHook(() =>
      useGitChangeEditor({
        ...baseParams(true),
        projectRoot: null,
        editorViewRef,
      }),
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(mocks.getFileDiff).not.toHaveBeenCalled();
  });

  it('fetch 失败 → field 保持 []，不抛未捕获异常', async () => {
    mocks.getFileDiff.mockRejectedValue(new Error('boom'));

    let epoch = 0;
    const editorViewRef = { current: null as EditorView | null };
    const { result, rerender } = renderHook(() =>
      useGitChangeEditor({ ...baseParams(true), editorViewRef, editorViewEpoch: epoch }),
    );

    await waitFor(() => {
      expect(mocks.getFileDiff).toHaveBeenCalled();
    });
    await new Promise((r) => setTimeout(r, 0));

    const view = new EditorView({
      state: EditorState.create({ doc: 'x\n', extensions: result.current }),
    });
    editorViewRef.current = view;
    epoch = 1;
    rerender();

    await waitFor(() => {
      expect(view.state.field(fileLineChangesField)).toEqual([]);
    });
    view.destroy();
  });
});

describe('useGitChangeEditor — 事件刷新 + 生命周期', () => {
  beforeEach(() => {
    mocks.getFileDiff.mockReset();
    mocks.listeners.clear();
    mocks.unlistens.length = 0;
    mocks.fileChangedCbs.clear();
  });

  it('git-status-snapshot / git-changed → 去抖后再次 fetch', async () => {
    vi.useFakeTimers();
    mocks.getFileDiff.mockResolvedValue(resolveAddedDiff());

    const editorViewRef = { current: null as EditorView | null };
    const { unmount } = renderHook(() =>
      useGitChangeEditor({ ...baseParams(true), editorViewRef, editorViewEpoch: 0 }),
    );

    // 首拉（微任务，fake timers 下 advance 0ms 即可冲刷）
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(mocks.getFileDiff).toHaveBeenCalledTimes(1);
    // 监听已注册（listen mock 同步 set）
    expect(mocks.listeners.has(GIT_STATUS_SNAPSHOT_EVENT)).toBe(true);
    expect(mocks.listeners.has(GIT_CHANGED_EVENT)).toBe(true);

    // 同项目 snapshot 事件 ×2（去抖合并为一次）
    act(() => {
      mocks.listeners.get(GIT_STATUS_SNAPSHOT_EVENT)?.({
        payload: {
          version: 1,
          project_id: PROJECT_ID,
          branch: 'main',
          entries: [],
          truncated: false,
        },
      });
      mocks.listeners.get(GIT_STATUS_SNAPSHOT_EVENT)?.({
        payload: {
          version: 2,
          project_id: PROJECT_ID,
          branch: 'main',
          entries: [],
          truncated: false,
        },
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    // 去抖窗口内不 fetch
    expect(mocks.getFileDiff).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(mocks.getFileDiff).toHaveBeenCalledTimes(2);

    // 其他项目的 snapshot 忽略
    act(() => {
      mocks.listeners.get(GIT_STATUS_SNAPSHOT_EVENT)?.({
        payload: { version: 3, project_id: 'other', branch: 'x', entries: [], truncated: false },
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(mocks.getFileDiff).toHaveBeenCalledTimes(2);

    // git-changed（payload = projectId 字符串）→ 去抖重拉
    act(() => {
      mocks.listeners.get(GIT_CHANGED_EVENT)?.({ payload: PROJECT_ID });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(mocks.getFileDiff).toHaveBeenCalledTimes(3);

    // 其他项目 git-changed 忽略
    act(() => {
      mocks.listeners.get(GIT_CHANGED_EVENT)?.({ payload: 'other' });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(mocks.getFileDiff).toHaveBeenCalledTimes(3);

    unmount();
    vi.useRealTimers();
  });

  it('file-changed path 匹配 → 重拉；不匹配 → 不拉', async () => {
    vi.useFakeTimers();
    mocks.getFileDiff.mockResolvedValue(resolveAddedDiff());

    const editorViewRef = { current: null as EditorView | null };
    const { unmount } = renderHook(() =>
      useGitChangeEditor({ ...baseParams(true), editorViewRef, editorViewEpoch: 0 }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(mocks.getFileDiff).toHaveBeenCalledTimes(1);
    // 共享订阅已挂上（mock 的 useFileChangedEvent）
    expect(mocks.fileChangedCbs.size).toBeGreaterThan(0);

    // 不匹配路径 → 不重拉
    act(() => {
      emitFileChanged({ project_id: PROJECT_ID, paths: ['src/other.ts'] });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(mocks.getFileDiff).toHaveBeenCalledTimes(1);

    // 其他项目 → 不重拉
    act(() => {
      emitFileChanged({ project_id: 'other', paths: [REPO_REL_PATH] });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(mocks.getFileDiff).toHaveBeenCalledTimes(1);

    // 项目相对路径事件 + 绝对 tab 路径 → 身份匹配命中，重拉
    act(() => {
      emitFileChanged({ project_id: PROJECT_ID, paths: [REPO_REL_PATH] });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(mocks.getFileDiff).toHaveBeenCalledTimes(2);

    // 绝对路径事件（watcher strip_prefix 回退）→ 同样命中
    act(() => {
      emitFileChanged({ project_id: PROJECT_ID, paths: [FILE_PATH] });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(mocks.getFileDiff).toHaveBeenCalledTimes(3);

    unmount();
    vi.useRealTimers();
  });

  it('卸载后 emit → 不再 dispatch；卸载解除监听', async () => {
    vi.useFakeTimers();
    mocks.getFileDiff.mockResolvedValue(resolveAddedDiff());

    const editorViewRef = { current: null as EditorView | null };
    const { unmount } = renderHook(() =>
      useGitChangeEditor({ ...baseParams(true), editorViewRef, editorViewEpoch: 0 }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(mocks.getFileDiff).toHaveBeenCalledTimes(1);

    unmount();

    // 卸载后监听应已解除
    expect(mocks.listeners.has(GIT_STATUS_SNAPSHOT_EVENT)).toBe(false);
    expect(mocks.listeners.has(GIT_CHANGED_EVENT)).toBe(false);
    expect(mocks.fileChangedCbs.size).toBe(0);

    // 卸载后 emit（handler 已删，无从触发）→ fetch 次数不变
    const residual = mocks.getFileDiff.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(mocks.getFileDiff).toHaveBeenCalledTimes(residual);

    vi.useRealTimers();
  });

  it('enabled 翻转 true→false → 扩展变 []', () => {
    mocks.getFileDiff.mockResolvedValue(resolveAddedDiff());

    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useGitChangeEditor(baseParams(enabled)),
      { initialProps: { enabled: true } },
    );
    expect(result.current.length).toBeGreaterThan(0);

    rerender({ enabled: false });
    expect(result.current).toEqual([]);
  });
});
