import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { useAppCallbacks } from '../useAppCallbacks';
import { createProject } from '../../testing/factories';

// mock terminal utils
vi.mock('../../components/terminal', () => ({
  switchAgentInTerminal: vi.fn(),
  refreshTerminal: vi.fn(),
}));

const mockInvoke = vi.mocked(invoke);

/** 构造最小化的 useAppCallbacks 入参 */
function makeParams(overrides: Partial<Parameters<typeof useAppCallbacks>[0]> = {}) {
  const showToast = vi.fn();
  const setActiveProject = vi.fn();
  const setProjects = vi.fn();
  const setActiveWorktreePath = vi.fn();
  const setActiveWorktreeBranch = vi.fn();
  const setOpenedWorktrees = vi.fn();
  const saveWorktreeState = vi.fn();
  const setWorktreeDiffState = vi.fn();
  const saveSession = vi.fn();
  const setWslDiffState = vi.fn();
  const setRemoteDiffState = vi.fn();
  const setRemoteAuthStore = vi.fn();
  const setPendingAuthEntry = vi.fn();
  const setRemoteEntries = vi.fn();
  const setActiveRemoteKey = vi.fn();
  const setActiveRemoteProject = vi.fn();
  const setSettingsOpen = vi.fn();
  const handleAddProject = vi.fn();
  const setWslDialogOpen = vi.fn();
  const setRemoteDialogOpen = vi.fn();
  const setActiveProjectId = vi.fn();

  return {
    agentCommandOverrides: undefined,
    activeProject: null,
    activeProjectId: null,
    projects: [],
    setProjects,
    setActiveProject,
    handleOpenIde: vi.fn(),
    showToast,
    activeWorktreePath: null,
    setActiveWorktreePath,
    setActiveWorktreeBranch,
    setOpenedWorktrees,
    saveWorktreeState,
    setWorktreeDiffState,
    saveSession,
    setWslDiffState,
    setRemoteDiffState,
    pendingAuthEntry: null,
    setRemoteAuthStore,
    setPendingAuthEntry,
    setRemoteEntries,
    remoteEntries: [],
    setActiveRemoteKey,
    setActiveRemoteProject,
    setSettingsOpen,
    handleAddProject,
    setWslDialogOpen,
    setRemoteDialogOpen,
    setActiveProjectId,
    ...overrides,
  } as Parameters<typeof useAppCallbacks>[0];
}

describe('useAppCallbacks', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue(undefined);
  });

  describe('handleOpenWorktreeTerminal', () => {
    it('项目未激活时先激活项目再设置 worktree 路径', async () => {
      const params = makeParams();
      // activeProjectId 为 null，表示项目未激活
      params.activeProjectId = null;

      const { result } = renderHook(() => useAppCallbacks(params));

      await act(async () => {
        await result.current.handleOpenWorktreeTerminal(
          'p-wt',
          '/path/to/worktree',
          'feature/my-branch',
        );
      });

      // 应激活项目
      expect(params.setActiveProjectId).toHaveBeenCalledWith('p-wt');
      expect(mockInvoke).toHaveBeenCalledWith('set_active_project', { projectId: 'p-wt' });
      // 激活后应调用 set_view_terminal
      expect(mockInvoke).toHaveBeenCalledWith('set_view_terminal', { projectId: 'p-wt' });
      // 设置 worktree 状态
      expect(params.setActiveWorktreePath).toHaveBeenCalledWith('/path/to/worktree');
      expect(params.setActiveWorktreeBranch).toHaveBeenCalledWith('feature/my-branch');
    });

    it('项目已激活时直接设置 worktree 路径，不重复激活', async () => {
      const params = makeParams();
      params.activeProjectId = 'p-wt';

      const { result } = renderHook(() => useAppCallbacks(params));

      await act(async () => {
        await result.current.handleOpenWorktreeTerminal(
          'p-wt',
          '/path/to/worktree',
          'feature/my-branch',
        );
      });

      // 已激活，不应再调用 set_active_project
      expect(params.setActiveProjectId).not.toHaveBeenCalled();
      expect(mockInvoke).not.toHaveBeenCalledWith('set_active_project', expect.anything());
      // 直接设置 set_view_terminal（切换到终端视图以显示 WorktreeTerminalView）
      expect(mockInvoke).toHaveBeenCalledWith('set_view_terminal', { projectId: 'p-wt' });
      expect(params.setActiveWorktreePath).toHaveBeenCalledWith('/path/to/worktree');
    });
  });
});
