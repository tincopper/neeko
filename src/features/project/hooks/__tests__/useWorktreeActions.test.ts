import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useWorktreeActions } from '@/features/project/hooks/useWorktreeActions';
import { useProjectStore } from '@/shared/store/projectStore';

const mockInvoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}));

const mockLoadOnboardingState = vi.hoisted(() => vi.fn());
vi.mock('@/features/project/api/onboardingApi', () => ({
  loadOnboardingState: mockLoadOnboardingState,
}));

function createProject(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p-wt',
    name: 'test-project',
    path: '/path/to/project',
    environment: { type: 'Local' },
    selected_ide: null,
    selected_agents: [],
    git_info: {
      current_branch: 'main',
      branches: ['main'],
      worktrees: [{ path: '/path/to/worktree', branch: 'feature/test' }],
      changed_files: [],
      is_clean: true,
      git_provider: '',
    },
    ...overrides,
  };
}

function seedStore(state: Record<string, unknown> = {}) {
  useProjectStore.setState({
    projects: [createProject()],
    activeProjectId: null,
    activeProject: null,
    ...state,
  });
}

function createDeps() {
  return {
    setActiveWorktreePath: vi.fn(),
    setActiveWorktreeBranch: vi.fn(),
    setOpenedWorktrees: vi.fn(),
    saveWorktreeState: vi.fn(),
  };
}

describe('useWorktreeActions', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue(undefined);
    mockLoadOnboardingState.mockReset();
    mockLoadOnboardingState.mockResolvedValue(null);
    seedStore();
  });

  it('首次访问 worktree 时不调用 set_view_terminal（显示引导页）', async () => {
    const deps = createDeps();
    const { result } = renderHook(() => useWorktreeActions(deps));

    await act(async () => {
      await result.current.handleOpenWorktreeTerminal('p-wt', '/path/to/worktree', 'feature/test');
    });

    expect(useProjectStore.getState().activeProjectId).toBe('p-wt');
    expect(mockInvoke).toHaveBeenCalledWith('set_active_project', { projectId: 'p-wt' });
    expect(mockInvoke).not.toHaveBeenCalledWith('set_view_terminal', expect.anything());
    expect(deps.setActiveWorktreePath).toHaveBeenCalledWith('/path/to/worktree');
    expect(deps.setActiveWorktreeBranch).toHaveBeenCalledWith('feature/test');
    expect(deps.saveWorktreeState).toHaveBeenCalledWith('p-wt', '/path/to/worktree');
  });

  it('回访 worktree 时调用 set_view_terminal（自动创建终端）', async () => {
    mockLoadOnboardingState.mockResolvedValue({ completedSteps: ['terminal'] });
    const deps = createDeps();
    const { result } = renderHook(() => useWorktreeActions(deps));

    await act(async () => {
      await result.current.handleOpenWorktreeTerminal('p-wt', '/path/to/worktree', 'feature/test');
    });

    expect(mockInvoke).toHaveBeenCalledWith('set_view_terminal', { projectId: 'p-wt' });
    expect(deps.setActiveWorktreePath).toHaveBeenCalledWith('/path/to/worktree');
  });

  it('项目已激活且首次访问 worktree 时不会重复调用 set_active_project 也不会自动创建终端', async () => {
    seedStore({
      activeProjectId: 'p-wt',
      activeProject: createProject({ id: 'p-wt' }),
    });
    const deps = createDeps();
    const { result } = renderHook(() => useWorktreeActions(deps));

    await act(async () => {
      await result.current.handleOpenWorktreeTerminal('p-wt', '/path/to/worktree', 'feature/test');
    });

    expect(mockInvoke).not.toHaveBeenCalledWith('set_active_project', expect.anything());
    expect(mockInvoke).not.toHaveBeenCalledWith('set_view_terminal', expect.anything());
  });
});
