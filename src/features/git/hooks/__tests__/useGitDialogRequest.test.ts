import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ProjectView } from '@/shared/types/activeProject';

import { useGitDialogRequest } from '../useGitDialogRequest';

const project = {
  id: 'p1',
  path: '/repo/main',
  gitInfo: { branches: ['main', 'dev'], current_branch: 'main' },
} as unknown as ProjectView;

describe('useGitDialogRequest — 分支/worktree 对话开关', () => {
  it('有 onOpenDialog 时委托宿主打开，不落本地状态', () => {
    const onOpenDialog = vi.fn();
    const { result } = renderHook(() => useGitDialogRequest({ project, onOpenDialog }));

    act(() => result.current.open('new-branch'));

    expect(onOpenDialog).toHaveBeenCalledWith('new-branch', expect.anything());
    expect(result.current.dialog).toBeNull();
  });

  it('无 onOpenDialog 时落本地 GitDialog 状态（携带项目分支与路径）', () => {
    const { result } = renderHook(() => useGitDialogRequest({ project }));

    act(() => result.current.open('new-worktree'));

    expect(result.current.dialog).toEqual({
      type: 'new-worktree',
      projectId: 'p1',
      branches: ['main', 'dev'],
      projectPath: '/repo/main',
    });
  });

  it('close 清空本地状态', () => {
    const { result } = renderHook(() => useGitDialogRequest({ project }));
    act(() => result.current.open('new-branch'));

    act(() => result.current.close());

    expect(result.current.dialog).toBeNull();
  });
});
