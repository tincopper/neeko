import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type FocusCb = (event: { payload: boolean }) => void;

const { focusHandlers, invokeSpy } = vi.hoisted(() => ({
  focusHandlers: [] as FocusCb[],
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

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeSpy,
  convertFileSrc: vi.fn((path: string) => `asset://localhost/${path}`),
}));

import { useProjectStore } from '@/shared/store/projectStore';

import { useGitStatusEventsSync } from '../useGitStatusEventsSync';

const DEBOUNCE_MS = 500;

describe('useGitStatusEventsSync — 窗口聚焦刷新', () => {
  beforeEach(() => {
    focusHandlers.length = 0;
    invokeSpy.mockReset();
    invokeSpy.mockImplementation((cmd: string) => {
      if (cmd === 'get_worktree_changed_files') {
        return Promise.resolve({ files: [], version: 1 });
      }
      if (cmd === 'get_git_branch_info') {
        return Promise.resolve({ current_branch: 'main', branches: [], worktrees: [] });
      }
      if (cmd === 'get_ahead_behind') {
        return Promise.resolve(null);
      }
      return Promise.resolve(null);
    });
    useProjectStore.setState({
      activeProjectId: 'p1',
      projects: [{ id: 'p1' }],
      activeProject: null,
    } as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('focused=true 时对活跃项目调度一次 git status 刷新', async () => {
    renderHook(() => useGitStatusEventsSync());
    await waitFor(() => expect(focusHandlers.length).toBe(1));

    act(() => {
      focusHandlers[0]({ payload: true });
    });

    await waitFor(
      () =>
        expect(invokeSpy).toHaveBeenCalledWith(
          'get_worktree_changed_files',
          expect.objectContaining({ projectId: 'p1' }),
        ),
      { timeout: DEBOUNCE_MS + 2000 },
    );
  });

  it('focused=false 时不触发刷新', async () => {
    renderHook(() => useGitStatusEventsSync());
    await waitFor(() => expect(focusHandlers.length).toBe(1));

    act(() => {
      focusHandlers[0]({ payload: false });
    });

    await new Promise((r) => setTimeout(r, DEBOUNCE_MS + 200));
    expect(invokeSpy).not.toHaveBeenCalledWith('get_worktree_changed_files', expect.anything());
  });

  it('无 activeProjectId 时不触发刷新', async () => {
    useProjectStore.setState({ activeProjectId: null, projects: [], activeProject: null } as never);
    renderHook(() => useGitStatusEventsSync());
    await waitFor(() => expect(focusHandlers.length).toBe(1));

    act(() => {
      focusHandlers[0]({ payload: true });
    });

    await new Promise((r) => setTimeout(r, DEBOUNCE_MS + 200));
    expect(invokeSpy).not.toHaveBeenCalledWith('get_worktree_changed_files', expect.anything());
  });
});
