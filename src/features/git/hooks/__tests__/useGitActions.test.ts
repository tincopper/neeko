import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { cancelGitSync } from '@/features/git/api/gitApi';
import { gitConsoleSessionId, useTaskStore } from '@/shared/store/taskStore';
import type { FileChange } from '@/shared/types';
import type { ProjectCommands } from '@/shared/types/activeProject';

import { hasConflictedSelected, useGitActions } from '../useGitActions';

vi.mock('@/features/git/api/gitApi', () => ({
  cancelGitSync: vi.fn().mockResolvedValue(undefined),
}));

function fc(
  path: string,
  status: FileChange['status'],
  xy?: { x?: string; y?: string },
): FileChange {
  return {
    path,
    status,
    additions: 1,
    deletions: 0,
    ...(xy?.x !== undefined ? { index_status: xy.x } : {}),
    ...(xy?.y !== undefined ? { worktree_status: xy.y } : {}),
  };
}

const REPO_PATH = '/repo/main';
const REPO_ID = 'p1';

/** Git Console 状态归 task store 所有：每个用例从空状态开始，避免跨用例串扰。 */
beforeEach(() => {
  useTaskStore.setState({ consoleSessions: [], activeConsoleId: null, consolePanelOpen: false });
});

function setup(overrides?: Partial<Parameters<typeof useGitActions>[0]>) {
  const commands = {
    commitFiles: vi.fn().mockResolvedValue({ success: true, hash: 'abc1234', message: 'm' }),
    push: vi.fn().mockResolvedValue({ Success: {} }),
    fetch: vi.fn().mockResolvedValue({ Success: {} }),
    pull: vi.fn().mockResolvedValue({ Success: {} }),
    stageFiles: vi.fn(),
    discardFiles: vi.fn().mockResolvedValue(undefined),
  } as unknown as ProjectCommands;
  const onRefreshGit = vi.fn().mockResolvedValue(undefined);
  const onShowToast = vi.fn();
  const onCommitMessageClear = vi.fn();
  const onSelectedFilesClear = vi.fn();
  const onSelectedFilesRemove = vi.fn();

  const { result } = renderHook(() =>
    useGitActions({
      commands,
      projectId: REPO_ID,
      projectPath: REPO_PATH,
      onRefreshGit,
      onShowToast,
      onCommitMessageClear,
      onSelectedFilesClear,
      onSelectedFilesRemove,
      selectedFiles: new Set<string>(),
      changedFiles: [],
      ...overrides,
    }),
  );

  return {
    result,
    commands,
    onRefreshGit,
    onShowToast,
    onCommitMessageClear,
    onSelectedFilesClear,
    onSelectedFilesRemove,
  };
}

describe('hasConflictedSelected', () => {
  it('选中冲突文件（AA）返回 true', () => {
    const changed = [fc('a.ts', 'Added', { x: 'A', y: 'A' })];
    expect(hasConflictedSelected(changed, new Set(['a.ts']))).toBe(true);
  });

  it('选中非冲突文件返回 false', () => {
    const changed = [
      fc('a.ts', 'Modified', { x: 'M', y: ' ' }),
      fc('b.ts', 'Untracked', { x: '?', y: '?' }),
    ];
    expect(hasConflictedSelected(changed, new Set(['a.ts', 'b.ts']))).toBe(false);
  });

  it('冲突文件未被选中时返回 false（不误伤其他选中文件）', () => {
    const changed = [fc('c.ts', 'Added', { x: 'A', y: 'U' })];
    expect(hasConflictedSelected(changed, new Set(['other.ts']))).toBe(false);
  });
});

describe('useGitActions — checkout 与 untracked 目录展开', () => {
  it('checkout 成功后刷新分支数据', async () => {
    const commands = {
      checkoutBranch: vi.fn().mockResolvedValue(undefined),
    } as unknown as ProjectCommands;
    const { result, onRefreshGit } = setup({ commands });

    await act(async () => {
      await result.current.handleCheckoutBranch('main');
    });

    expect(commands.checkoutBranch).toHaveBeenCalledWith('main');
    expect(onRefreshGit).toHaveBeenCalled();
  });

  it('checkout 失败提示错误且不刷新', async () => {
    const commands = {
      checkoutBranch: vi.fn().mockRejectedValue(new Error('conflict')),
    } as unknown as ProjectCommands;
    const { result, onRefreshGit, onShowToast } = setup({ commands });

    await act(async () => {
      await result.current.handleCheckoutBranch('main');
    });

    expect(onRefreshGit).not.toHaveBeenCalled();
    expect(onShowToast).toHaveBeenCalledWith(expect.stringContaining('conflict'), 'error');
  });

  it('展开 untracked 目录成功时返回文件列表', async () => {
    const commands = {
      listUntrackedFiles: vi.fn().mockResolvedValue(['dir/a.ts', 'dir/b.ts']),
    } as unknown as ProjectCommands;
    const { result } = setup({ commands });

    let files: string[] = [];
    await act(async () => {
      files = await result.current.handleExpandUntrackedDir('dir');
    });

    expect(files).toEqual(['dir/a.ts', 'dir/b.ts']);
  });

  it('展开失败时 toast 后**重抛**（不得伪装成空目录，让展开 hook 保留目录占位）', async () => {
    const commands = {
      listUntrackedFiles: vi.fn().mockRejectedValue(new Error('boom')),
    } as unknown as ProjectCommands;
    const { result, onShowToast } = setup({ commands });

    await act(async () => {
      await expect(result.current.handleExpandUntrackedDir('dir')).rejects.toThrow('boom');
    });

    expect(onShowToast).toHaveBeenCalledWith(expect.stringContaining('boom'), 'error');
  });
});

describe('useGitActions — 提交前冲突拦截（W1 根治）', () => {
  it('handleCommit 无选中文件时不调用 commitFiles', async () => {
    const { result, commands, onShowToast } = setup();
    await act(async () => {
      await result.current.handleCommit('msg');
    });
    expect(commands.commitFiles).not.toHaveBeenCalled();
    expect(onShowToast).toHaveBeenCalledWith('No files selected. Check files to commit.', 'error');
  });

  it('handleCommit 选中冲突文件时阻止提交并提示', async () => {
    const { result, commands, onShowToast } = setup({
      selectedFiles: new Set(['conflict.ts']),
      changedFiles: [fc('conflict.ts', 'Added', { x: 'A', y: 'A' })],
    });
    await act(async () => {
      await result.current.handleCommit('msg');
    });
    expect(commands.commitFiles).not.toHaveBeenCalled();
    expect(onShowToast).toHaveBeenCalledWith(
      expect.stringContaining('unresolved merge conflict'),
      'error',
    );
  });

  it('handleCommit 选中普通文件时正常提交', async () => {
    const { result, commands, onShowToast, onRefreshGit, onSelectedFilesClear } = setup({
      selectedFiles: new Set(['mod.ts']),
      changedFiles: [fc('mod.ts', 'Modified', { x: ' ', y: 'M' })],
    });
    await act(async () => {
      await result.current.handleCommit('msg');
    });
    expect(commands.commitFiles).toHaveBeenCalledWith(['mod.ts'], 'msg', expect.any(String));
    expect(onRefreshGit).toHaveBeenCalled();
    expect(onSelectedFilesClear).toHaveBeenCalled();
    expect(onShowToast).toHaveBeenCalledWith(expect.stringContaining('Committed'), 'info');
  });

  it('handleCommitAndPush 选中冲突文件时阻止提交（commitFiles/push 均不调用）', async () => {
    const { result, commands, onShowToast } = setup({
      selectedFiles: new Set(['conflict.ts']),
      changedFiles: [fc('conflict.ts', 'Added', { x: 'A', y: 'A' })],
    });
    await act(async () => {
      await result.current.handleCommitAndPush('msg');
    });
    expect(commands.commitFiles).not.toHaveBeenCalled();
    expect(commands.push).not.toHaveBeenCalled();
    expect(onShowToast).toHaveBeenCalledWith(
      expect.stringContaining('unresolved merge conflict'),
      'error',
    );
  });
});

describe('useGitActions — handleConfirmDiscard（执行范围 = 确认过的集合）', () => {
  it('整组丢弃：把整组路径交给后端并刷新', async () => {
    const { result, commands, onRefreshGit, onSelectedFilesRemove } = setup();
    await act(async () => {
      await result.current.handleConfirmDiscard({
        paths: ['a.ts', 'b.ts'],
        scope: 'group',
        changeClass: 'tracked',
      });
    });

    expect(commands.discardFiles).toHaveBeenCalledWith(['a.ts', 'b.ts']);
    expect(onRefreshGit).toHaveBeenCalled();
    expect(onSelectedFilesRemove).toHaveBeenCalledWith(['a.ts', 'b.ts']);
  });

  it('选中丢弃：只传选中路径，且只摘掉这些路径的勾选（不清空其余）', async () => {
    const { result, commands, onSelectedFilesRemove, onSelectedFilesClear } = setup({
      selectedFiles: new Set(['a.ts', 'keep.ts']),
    });
    await act(async () => {
      await result.current.handleConfirmDiscard({
        paths: ['a.ts'],
        scope: 'selection',
        changeClass: 'tracked',
      });
    });

    expect(commands.discardFiles).toHaveBeenCalledWith(['a.ts']);
    expect(onSelectedFilesRemove).toHaveBeenCalledWith(['a.ts']);
    // 丢弃是局部操作，不得走 commit 那种整批清空
    expect(onSelectedFilesClear).not.toHaveBeenCalled();
  });

  it('unversioned 丢弃同样只走绝对路径集合（后端按仓库状态分类）', async () => {
    const { result, commands } = setup();
    await act(async () => {
      await result.current.handleConfirmDiscard({
        paths: ['new.ts'],
        scope: 'group',
        changeClass: 'unversioned',
      });
    });

    expect(commands.discardFiles).toHaveBeenCalledWith(['new.ts']);
  });

  it('空集合不发起 IPC（防御：静默 no-op 会让 UI 误报成功）', async () => {
    const { result, commands, onRefreshGit } = setup();
    await act(async () => {
      await result.current.handleConfirmDiscard({
        paths: [],
        scope: 'group',
        changeClass: 'tracked',
      });
    });

    expect(commands.discardFiles).not.toHaveBeenCalled();
    expect(onRefreshGit).not.toHaveBeenCalled();
  });

  it('失败也要刷新且提示错误（discard 非原子，部分成功必须反映到列表）', async () => {
    const commands = {
      discardFiles: vi.fn().mockRejectedValue(new Error('boom')),
    } as unknown as ProjectCommands;
    const onSelectedFilesRemove = vi.fn();
    const { result, onRefreshGit, onShowToast } = setup({ commands, onSelectedFilesRemove });

    await act(async () => {
      await result.current.handleConfirmDiscard({
        paths: ['a.ts'],
        scope: 'file',
        changeClass: 'tracked',
      });
    });

    expect(onShowToast).toHaveBeenCalledWith(expect.stringContaining('boom'), 'error');
    // 失败不清勾选（状态与实际保持一致），但**必须**刷新以回到仓库真实状态
    expect(onSelectedFilesRemove).not.toHaveBeenCalled();
    expect(onRefreshGit).toHaveBeenCalled();
  });

  it('刷新本身失败时不吞掉：仍然报错并复位 loading', async () => {
    const { result, onShowToast } = setup({
      onRefreshGit: vi.fn().mockRejectedValue(new Error('refresh failed')),
    });

    await act(async () => {
      await result.current.handleConfirmDiscard({
        paths: ['a.ts'],
        scope: 'file',
        changeClass: 'tracked',
      });
    });

    expect(onShowToast).toHaveBeenCalledWith(expect.stringContaining('refresh failed'), 'error');
    expect(result.current.loading).toBe(false);
  });
});

describe('useGitActions — Git Console 接线', () => {
  const runId = gitConsoleSessionId(REPO_PATH);

  const gitRun = () => useTaskStore.getState().consoleSessions.find((s) => s.id === runId);

  it('handleCommit 打开仓库级 Console、透传 runId，成功后收尾为 idle', async () => {
    const { result, commands } = setup({
      selectedFiles: new Set(['mod.ts']),
      changedFiles: [fc('mod.ts', 'Modified', { x: ' ', y: 'M' })],
    });
    await act(async () => {
      await result.current.handleCommit('msg');
    });

    expect(commands.commitFiles).toHaveBeenCalledWith(['mod.ts'], 'msg', runId);
    const run = gitRun();
    expect(run?.source).toBe('git');
    expect(run?.status).toBe('idle');
    expect(run?.output).toContain('$ git commit');
    expect(useTaskStore.getState().consolePanelOpen).toBe(true);
  });

  it('handleCommit 失败时错误落进 Console 并标 failed（缓冲区保留）', async () => {
    const commands = {
      commitFiles: vi.fn().mockRejectedValue(new Error('hook failed')),
    } as unknown as ProjectCommands;
    const { result } = setup({
      commands,
      selectedFiles: new Set(['mod.ts']),
      changedFiles: [fc('mod.ts', 'Modified', { x: ' ', y: 'M' })],
    });
    await act(async () => {
      await result.current.handleCommit('msg');
    });

    const run = gitRun();
    expect(run?.status).toBe('failed');
    expect(run?.output).toContain('hook failed');
  });

  it('handlePush 透传 runId；成功收尾为 idle', async () => {
    const { result, commands } = setup();
    await act(async () => {
      await result.current.handlePush();
    });

    expect(commands.push).toHaveBeenCalledWith(false, runId);
    const run = gitRun();
    expect(run?.status).toBe('idle');
    expect(run?.output).toContain('$ git push');
  });

  it('同一仓库的多次操作复用同一 tab，并追加新的命令头', async () => {
    const { result } = setup();
    await act(async () => {
      await result.current.handlePush();
    });
    await act(async () => {
      await result.current.handleFetch();
    });

    const runs = useTaskStore.getState().consoleSessions.filter((s) => s.id === runId);
    expect(runs).toHaveLength(1);
    expect(runs[0].output).toContain('$ git push');
    expect(runs[0].output).toContain('$ git fetch');
  });

  it('AuthRequired 时标注等待认证且不算失败（凭据对话接管）', async () => {
    const commands = {
      push: vi.fn().mockResolvedValue({
        AuthRequired: { remote_url: 'https://x/y.git', username_hint: null, ssh: false },
      }),
    } as unknown as ProjectCommands;
    const { result } = setup({ commands });
    await act(async () => {
      await result.current.handlePush();
    });

    const run = gitRun();
    expect(run?.status).toBe('idle');
    expect(run?.output).toContain('[authentication required]');
  });

  it('handleCommitAndPush：commit 与 push 共享一个 runId、一段 output', async () => {
    const { result, commands } = setup({
      selectedFiles: new Set(['mod.ts']),
      changedFiles: [fc('mod.ts', 'Modified', { x: ' ', y: 'M' })],
    });
    await act(async () => {
      await result.current.handleCommitAndPush('msg');
    });

    expect(commands.commitFiles).toHaveBeenCalledWith(['mod.ts'], 'msg', runId);
    expect(commands.push).toHaveBeenCalledWith(false, runId);
    const run = gitRun();
    expect(run?.status).toBe('idle');
    expect(run?.output).toContain('$ git commit && git push');
  });

  it('去墙钟：push 悬挂 200s 也不判失败（对齐 VS Code 的无超时模型）', async () => {
    vi.useFakeTimers();
    try {
      const commands = {
        push: vi.fn().mockReturnValue(new Promise<never>(() => {})),
      } as unknown as ProjectCommands;
      const { result, onShowToast } = setup({ commands });

      await act(async () => {
        void result.current.handlePush();
        await Promise.resolve();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200_000);
      });

      expect(onShowToast).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('用户取消：先置 stopping，命令 reject 后按 [Stopped] 收尾且不弹错误 toast', async () => {
    let rejectPush!: (reason: unknown) => void;
    const commands = {
      push: vi.fn().mockReturnValue(
        new Promise((_resolve, reject) => {
          rejectPush = reject;
        }),
      ),
    } as unknown as ProjectCommands;
    const { result, onShowToast } = setup({ commands });

    let pushPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      pushPromise = result.current.handlePush();
      await Promise.resolve();
    });
    expect(gitRun()?.status).toBe('running');

    // 面板 Cancel 按钮 = store 置 stopping + 调后端取消（单飞：取消当前唯一那个）
    await act(async () => {
      await useTaskStore.getState().cancelGitConsole(runId);
    });
    expect(cancelGitSync).toHaveBeenCalledTimes(1);
    expect(cancelGitSync).toHaveBeenCalledWith(runId);
    expect(gitRun()?.status).toBe('stopping');

    await act(async () => {
      rejectPush(new Error('git command cancelled: git push'));
      await pushPromise;
    });

    const run = gitRun();
    expect(run?.status).toBe('idle');
    expect(run?.output).toContain('[Stopped]');
    expect(onShowToast).not.toHaveBeenCalled();
  });
});
