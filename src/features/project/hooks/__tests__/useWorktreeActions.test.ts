import { renderHook, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useWorkspaceState } from '@/features/project/hooks/useWorkspaceState';
import { useWorktreeActions } from '@/features/project/hooks/useWorktreeActions';
import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorkspaceStore, type WorkspaceState } from '@/shared/store/workspaceStore';
import { createProject } from '@/testing/factories';

const mockInvoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}));

const mockLoadOnboardingState = vi.hoisted(() => vi.fn());
vi.mock('@/features/project/api/onboardingApi', () => ({
  loadOnboardingState: mockLoadOnboardingState,
}));

const PROJECT = 'p-wt';
const OTHER_PROJECT = 'p-other';
const WT_PATH = '/path/to/worktree';
const WT_BRANCH = 'feature/test';

function unit(overrides: Partial<WorkspaceState> = {}): WorkspaceState {
  return { activePath: null, activeBranch: '', opened: [], ...overrides };
}

function seedStore(state: Record<string, unknown> = {}): void {
  useProjectStore.setState({
    projects: [createProject({ id: PROJECT }), createProject({ id: OTHER_PROJECT })],
    activeProjectId: null,
    activeProject: null,
    statuses: {},
    ...state,
  });
  useWorkspaceStore.setState({ byProject: {} });
  useEditorStore.setState({ tabs: {}, activeTabId: null });
}

function createDeps() {
  return {
    activateWorkspace: vi.fn(),
    markWorkspaceOpened: vi.fn(),
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

  describe('handleOpenWorktreeTerminal', () => {
    it('首次访问 worktree 时不调用 set_view_terminal（显示引导页）', async () => {
      seedStore({ activeProjectId: PROJECT, activeProject: createProject({ id: PROJECT }) });
      const deps = createDeps();
      const { result } = renderHook(() => useWorktreeActions(deps));

      await act(async () => {
        await result.current.handleOpenWorktreeTerminal(PROJECT, WT_PATH, WT_BRANCH);
      });

      expect(mockInvoke).not.toHaveBeenCalledWith('set_view_terminal', expect.anything());
      expect(deps.activateWorkspace).toHaveBeenCalledWith(PROJECT, WT_PATH, WT_BRANCH);
      expect(deps.markWorkspaceOpened).toHaveBeenCalledWith(PROJECT, WT_PATH, WT_BRANCH);
      expect(deps.saveWorktreeState).toHaveBeenCalledWith(PROJECT, WT_PATH);
    });

    it('回访 worktree 时调用 set_view_terminal（自动创建终端）', async () => {
      seedStore({ activeProjectId: PROJECT, activeProject: createProject({ id: PROJECT }) });
      mockLoadOnboardingState.mockResolvedValue({ completedSteps: ['terminal'] });
      const deps = createDeps();
      const { result } = renderHook(() => useWorktreeActions(deps));

      await act(async () => {
        await result.current.handleOpenWorktreeTerminal(PROJECT, WT_PATH, WT_BRANCH);
      });

      expect(mockInvoke).toHaveBeenCalledWith('set_view_terminal', { projectId: PROJECT });
      expect(deps.activateWorkspace).toHaveBeenCalledWith(PROJECT, WT_PATH, WT_BRANCH);
    });

    it('引导状态按 project + worktree 维度读取（同一项目不同工作树不共用引导进度）', async () => {
      seedStore({ activeProjectId: PROJECT, activeProject: createProject({ id: PROJECT }) });
      const deps = createDeps();
      const { result } = renderHook(() => useWorktreeActions(deps));

      await act(async () => {
        await result.current.handleOpenWorktreeTerminal(PROJECT, WT_PATH, WT_BRANCH);
      });

      expect(mockLoadOnboardingState).toHaveBeenCalledWith(`${PROJECT}::${WT_PATH}`);
    });

    it('项目未激活时先切项目（set_active_project），且不再重复调用', async () => {
      seedStore({ activeProjectId: OTHER_PROJECT });
      const deps = createDeps();
      const { result } = renderHook(() => useWorktreeActions(deps));

      await act(async () => {
        await result.current.handleOpenWorktreeTerminal(PROJECT, WT_PATH, WT_BRANCH);
      });

      expect(mockInvoke).toHaveBeenCalledWith('set_active_project', { projectId: PROJECT });
      // 只切一次：不得出现「先切项目再重复广播」
      expect(mockInvoke.mock.calls.filter((call) => call[0] === 'set_active_project')).toHaveLength(
        1,
      );
      expect(useProjectStore.getState().activeProjectId).toBe(PROJECT);
      expect(deps.saveWorktreeState).toHaveBeenCalledWith(PROJECT, WT_PATH);
    });

    it('项目已激活时不重复调用 set_active_project，首次访问也不自动创建终端', async () => {
      seedStore({ activeProjectId: PROJECT, activeProject: createProject({ id: PROJECT }) });
      const deps = createDeps();
      const { result } = renderHook(() => useWorktreeActions(deps));

      await act(async () => {
        await result.current.handleOpenWorktreeTerminal(PROJECT, WT_PATH, WT_BRANCH);
      });

      expect(mockInvoke).not.toHaveBeenCalledWith('set_active_project', expect.anything());
      expect(mockInvoke).not.toHaveBeenCalledWith('set_view_terminal', expect.anything());
      expect(deps.activateWorkspace).toHaveBeenCalledTimes(1);
    });

    // 回归契约（曾是生产缺陷）：mutator 曾经由 useWorktreeState(activeProjectId) 的渲染期
    // 闭包绑定项目 —— handleOpenWorktreeTerminal 里 `setState({activeProjectId})` 不会让
    // 回调重新绑定（同一次事件里没有重渲染），从项目卡片直接点开**另一个项目**的 worktree
    // 时激活态被写进旧项目的 byProject（跨项目串写）。修复 = mutator 显式接收 projectId；
    // 本用例走**真实接线**（useWorktreeState + useWorktreeActions 组合渲染）钉住端到端行为。
    it('跨项目打开 worktree 时激活态写在被打开的项目上，不污染原激活项目', async () => {
      seedStore({
        activeProjectId: OTHER_PROJECT,
        activeProject: createProject({ id: OTHER_PROJECT }),
      });
      const saveWorktreeState = vi.fn();
      const { result } = renderHook(() => {
        const activeId = useProjectStore((s) => s.activeProjectId);
        const st = useWorkspaceState(activeId);
        return useWorktreeActions({
          activateWorkspace: st.activateWorkspace,
          markWorkspaceOpened: st.markWorkspaceOpened,
          saveWorktreeState,
        });
      });

      await act(async () => {
        await result.current.handleOpenWorktreeTerminal(PROJECT, WT_PATH, WT_BRANCH);
      });

      expect(useWorkspaceStore.getState().byProject[OTHER_PROJECT]).toBeUndefined();
      expect(useWorkspaceStore.getState().byProject[PROJECT]).toMatchObject({
        activePath: WT_PATH,
      });
    });
  });

  describe('handleBackToMainTerminal — 激活态按项目读取（无全局镜像）', () => {
    it('该项目有激活 worktree 时切回主仓并落盘 + 切终端视图', () => {
      useWorkspaceStore.setState({
        byProject: { [PROJECT]: unit({ activePath: WT_PATH, activeBranch: WT_BRANCH }) },
      });
      const deps = createDeps();
      const { result } = renderHook(() => useWorktreeActions(deps));

      act(() => {
        result.current.handleBackToMainTerminal(PROJECT);
      });

      expect(deps.activateWorkspace).toHaveBeenCalledWith(PROJECT, null, '');
      expect(deps.saveWorktreeState).toHaveBeenCalledWith(PROJECT, null);
      expect(mockInvoke).toHaveBeenCalledWith('set_view_terminal', { projectId: PROJECT });
    });

    it('该项目没有激活 worktree 时完全不做事（主仓视图没有「返回主仓」）', () => {
      const deps = createDeps();
      const { result } = renderHook(() => useWorktreeActions(deps));

      act(() => {
        result.current.handleBackToMainTerminal(PROJECT);
      });

      expect(deps.activateWorkspace).not.toHaveBeenCalled();
      expect(deps.saveWorktreeState).not.toHaveBeenCalled();
      expect(mockInvoke).not.toHaveBeenCalledWith('set_view_terminal', expect.anything());
    });

    it('别的项目有激活 worktree 时，本项目「返回主仓」不得误伤那个项目', () => {
      useWorkspaceStore.setState({
        byProject: { [OTHER_PROJECT]: unit({ activePath: WT_PATH, activeBranch: WT_BRANCH }) },
      });
      const deps = createDeps();
      const { result } = renderHook(() => useWorktreeActions(deps));

      act(() => {
        result.current.handleBackToMainTerminal(PROJECT);
      });

      expect(deps.activateWorkspace).not.toHaveBeenCalled();
      expect(useWorkspaceStore.getState().byProject[OTHER_PROJECT]).toMatchObject({
        activePath: WT_PATH,
      });
    });

    it('主仓路径以 null 判定，空串不得当作 worktree 激活', () => {
      useWorkspaceStore.setState({ byProject: { [PROJECT]: unit({ activePath: '' }) } });
      const deps = createDeps();
      const { result } = renderHook(() => useWorktreeActions(deps));

      act(() => {
        result.current.handleBackToMainTerminal(PROJECT);
      });

      expect(deps.activateWorkspace).not.toHaveBeenCalled();
    });
  });
});
