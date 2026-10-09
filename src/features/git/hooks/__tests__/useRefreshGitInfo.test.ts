import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useGitStore } from '@/shared/store/gitStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorkspaceStore } from '@/shared/store/workspaceStore';
import type {
  GitInfo,
  GitStatusSnapshot,
  Project,
  ProjectCommands,
  ProjectView,
} from '@/shared/types';
import { workspaceKeyOf } from '@/shared/utils/workspaceRef';

import { useRefreshGitInfo } from '../useRefreshGitInfo';

const MAIN_KEY = workspaceKeyOf('proj-1', null);
const WT_KEY = workspaceKeyOf('proj-1', '/test/wt');

function makeGitInfo(overrides?: Partial<GitInfo>): GitInfo {
  // GitInfo 只剩 per-project 元数据：分支 / 工作树清单 / provider。
  // 「改了哪些文件、是否干净」是 per 工作树 的事实，随 GitStatusSnapshot 走。
  return {
    current_branch: 'main',
    branches: ['main'],
    worktrees: [],
    git_provider: 'git',
    ...overrides,
  };
}

function makeSnapshot(overrides?: Partial<GitStatusSnapshot>): GitStatusSnapshot {
  return {
    workspace_key: MAIN_KEY,
    version: 1,
    project_id: 'proj-1',
    worktree_path: null,
    branch: 'dev',
    entries: [{ path: 'a.ts', status: 'Modified', additions: 1, deletions: 1 }],
    truncated: false,
    ahead: 1,
    behind: 2,
    ...overrides,
  };
}

function makeProject(overrides?: Partial<Project>): Project {
  return {
    id: 'proj-1',
    name: 'Test Project',
    path: '/test/proj',
    environment: { type: 'Local' },
    git_info: makeGitInfo(),
    terminal: { id: 't1', pid: null, status: 'Idle', history: [], agent: null },
    selected_agents: [],
    selected_ide: null,
    active_view: 'Terminal',
    collapsed: false,
    ...overrides,
  };
}

function makeView(overrides?: Partial<ProjectView>): ProjectView {
  return {
    type: 'Local',
    id: 'proj-1',
    name: 'Test Project',
    path: '/test/proj',
    gitInfo: null,
    selectedAgent: [],
    selectedIde: null,
    ...overrides,
  };
}

function makeCommands(overrides?: Partial<ProjectCommands>): ProjectCommands {
  return {
    refreshGitInfo: vi.fn().mockResolvedValue(makeGitInfo({ branches: ['main', 'dev'] })),
    refreshWorkspaceStatus: vi.fn().mockResolvedValue(makeSnapshot()),
    getAheadBehind: vi.fn().mockResolvedValue({ ahead: 1, behind: 2 }),
    ...overrides,
  } as unknown as ProjectCommands;
}

beforeEach(() => {
  useProjectStore.setState({
    projects: [makeProject()],
    activeProjectId: 'proj-1',
    activeProject: makeProject(),
    statuses: {},
  });
  useGitStore.setState({ aheadBehind: {} });
  useWorkspaceStore.setState({ byProject: {} });
});

describe('useRefreshGitInfo', () => {
  it('should_update_project_git_info_in_store', async () => {
    const commands = makeCommands();
    const { result } = renderHook(() => useRefreshGitInfo(makeView(), commands));

    await act(async () => {
      await result.current();
    });

    expect(commands.refreshGitInfo).toHaveBeenCalledTimes(1);
    // 分支清单 = per-project 元数据
    expect(useProjectStore.getState().projects[0]?.git_info?.branches).toEqual(['main', 'dev']);
    // current_branch = **主仓单元**快照的 branch 投影（唯一写者是 applyStatus）
    expect(useProjectStore.getState().projects[0]?.git_info?.current_branch).toBe('dev');
    expect(useProjectStore.getState().activeProject?.git_info?.current_branch).toBe('dev');
    // 变更条目落在该单元的槽位里
    expect(useProjectStore.getState().statuses[MAIN_KEY]?.entries).toHaveLength(1);
  });

  it('不再单独触发 getAheadBehind（ahead/behind 随权威快照单通道投递）', async () => {
    const commands = makeCommands();
    const { result } = renderHook(() => useRefreshGitInfo(makeView(), commands));

    await act(async () => {
      await result.current();
    });

    // 单通道契约：刷新路径不再拉第二份 ahead/behind，键空间保持空
    expect(commands.getAheadBehind).not.toHaveBeenCalled();
    expect(useGitStore.getState().aheadBehind).toEqual({});
    // 快照仍然被应用（status 写入不受影响）
    expect(useProjectStore.getState().statuses[MAIN_KEY]).toBeDefined();
  });

  it('worktree 单元：刷新只写该单元的 status 槽，主仓槽不被动到', async () => {
    // 该 hook 的 commands 绑定「当前激活单元」，写入侧必须跟着快照自带的身份走
    const commands = makeCommands({
      refreshWorkspaceStatus: vi
        .fn()
        .mockResolvedValue(makeSnapshot({ workspace_key: WT_KEY, worktree_path: '/test/wt' })),
    });
    const { result } = renderHook(() => useRefreshGitInfo(makeView(), commands));

    await act(async () => {
      await result.current();
    });

    const store = useProjectStore.getState();
    expect(store.statuses[WT_KEY]).toBeDefined();
    expect(store.statuses[MAIN_KEY]).toBeUndefined();
  });

  it('should_be_noop_without_project_or_commands', async () => {
    const { result } = renderHook(() => useRefreshGitInfo(null, null));
    await act(async () => {
      await result.current();
    });
    expect(useProjectStore.getState().projects[0]?.git_info?.current_branch).toBe('main');
    expect(useProjectStore.getState().statuses).toEqual({});
  });

  it('refreshes the active worktree unit without touching main checkout state', async () => {
    useWorkspaceStore.setState({
      byProject: { 'proj-1': { activePath: '/test/wt', activeBranch: 'wt-branch', opened: [] } },
    });
    useProjectStore.setState({
      statuses: {
        [MAIN_KEY]: makeSnapshot({ version: 4, branch: 'main', entries: [] }),
      },
    });
    // 命令端口按「当前视图单元」绑定：这里回的是 worktree 单元的快照
    const commands = makeCommands({
      refreshWorkspaceStatus: vi.fn().mockResolvedValue(
        makeSnapshot({
          workspace_key: WT_KEY,
          version: 1,
          worktree_path: '/test/wt',
          branch: 'wt-branch',
          entries: [{ path: 'wt-only.ts', status: 'Added', additions: 2, deletions: 0 }],
        }),
      ),
    });
    const { result } = renderHook(() => useRefreshGitInfo(makeView(), commands));

    await act(async () => {
      await result.current();
    });

    const store = useProjectStore.getState();
    // worktree 单元写自己的槽位
    expect(store.statuses[WT_KEY]?.entries[0]?.path).toBe('wt-only.ts');
    // 主仓槽位不被覆盖（旧实现共用一个槽 → worktree 刷新会盖掉主仓，反之亦然）
    expect(store.statuses[MAIN_KEY]?.version).toBe(4);
    expect(store.statuses[MAIN_KEY]?.entries).toEqual([]);
    // 项目卡片的 current_branch 仍是主仓 HEAD，不被 worktree 分支污染
    // （不再是「worktree 激活时保留主分支」的特例，而是 worktree 单元根本不写这个字段）
    expect(store.projects[0]?.git_info?.current_branch).toBe('main');
  });

  it('should_return_stable_callback_across_rerenders', async () => {
    const commands = makeCommands();
    const { result, rerender } = renderHook(
      ({ project }: { project: ProjectView }) => useRefreshGitInfo(project, commands),
      { initialProps: { project: makeView() } },
    );
    const first = result.current;
    rerender({ project: makeView({ name: 'Renamed' }) });
    await waitFor(() => expect(result.current).toBe(first));
  });

  // ── 非 git 项目守卫 ──────────────────────────────────────────────────────

  it('should_skip_git_commands_for_non_git_project', async () => {
    const nonGitProject = makeProject({ git_info: null });
    useProjectStore.setState({
      projects: [nonGitProject],
      activeProjectId: nonGitProject.id,
      activeProject: nonGitProject,
    });
    const commands = makeCommands();
    const view = makeView({ gitInfo: null });
    const { result } = renderHook(() => useRefreshGitInfo(view, commands));

    await act(async () => {
      await result.current();
    });

    expect(commands.refreshGitInfo).not.toHaveBeenCalled();
    expect(commands.getAheadBehind).not.toHaveBeenCalled();
    expect(useProjectStore.getState().projects[0]?.git_info).toBeNull();
  });
});
