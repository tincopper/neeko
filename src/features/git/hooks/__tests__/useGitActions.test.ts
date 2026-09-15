import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { FileChange } from '@/shared/types';
import type { ProjectCommands } from '@/shared/types/activeProject';

import { hasConflictedSelected, useGitActions } from '../useGitActions';

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

function setup(overrides?: Partial<Parameters<typeof useGitActions>[0]>) {
  const commands = {
    commitFiles: vi.fn().mockResolvedValue({ success: true, hash: 'abc1234', message: 'm' }),
    push: vi.fn().mockResolvedValue({ Success: {} }),
    fetch: vi.fn(),
    pull: vi.fn(),
    stageFiles: vi.fn(),
    discardFile: vi.fn(),
    discardAll: vi.fn(),
  } as unknown as ProjectCommands;
  const onRefreshGit = vi.fn().mockResolvedValue(undefined);
  const onShowToast = vi.fn();
  const onCommitMessageClear = vi.fn();
  const onSelectedFilesClear = vi.fn();

  const { result } = renderHook(() =>
    useGitActions({
      commands,
      onRefreshGit,
      onShowToast,
      onCommitMessageClear,
      onSelectedFilesClear,
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
    expect(commands.commitFiles).toHaveBeenCalledWith(['mod.ts'], 'msg');
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
