import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useGitStore } from '@/shared/store/gitStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorktreeStore } from '@/shared/store/worktreeStore';
import type {
  ConnectionContext,
  GitInfo,
  Project,
  ProjectCommands,
  ProjectView,
} from '@/shared/types';

import { useRefreshGitInfo } from '../useRefreshGitInfo';

function makeGitInfo(overrides?: Partial<GitInfo>): GitInfo {
  return {
    current_branch: 'main',
    branches: ['main'],
    worktrees: [],
    changed_files: [],
    is_clean: true,
    git_provider: 'git',
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
    refreshGitInfo: vi.fn().mockResolvedValue(makeGitInfo({ current_branch: 'dev' })),
    getAheadBehind: vi.fn().mockResolvedValue({ ahead: 1, behind: 2 }),
    ...overrides,
  } as unknown as ProjectCommands;
}

beforeEach(() => {
  useProjectStore.setState({
    projects: [makeProject()],
    activeProjectId: 'proj-1',
    activeProject: makeProject(),
  });
  useGitStore.setState({ aheadBehind: {} });
  useWorktreeStore.setState({ activeWorktreePath: null, activeWorktreeBranch: null });
});

describe('useRefreshGitInfo', () => {
  it('should_update_project_git_info_in_store', async () => {
    const commands = makeCommands();
    const { result } = renderHook(() =>
      useRefreshGitInfo(makeView(), commands, { type: 'local', projectId: 'proj-1' }),
    );

    await act(async () => {
      await result.current();
    });

    expect(commands.refreshGitInfo).toHaveBeenCalledTimes(1);
    const project = useProjectStore.getState().projects[0];
    expect(project?.git_info?.current_branch).toBe('dev');
    expect(useProjectStore.getState().activeProject?.git_info?.current_branch).toBe('dev');
  });

  it('should_sync_ahead_behind_to_git_store_per_connection_type', async () => {
    const cases: Array<{ conn: ConnectionContext; expectedKey: string }> = [
      { conn: { type: 'local', projectId: 'proj-1' }, expectedKey: 'local:proj-1' },
      {
        conn: { type: 'wsl', distro: 'Ubuntu', projectPath: '/test' },
        expectedKey: 'wsl:Ubuntu:proj-1',
      },
      {
        conn: {
          type: 'remote',
          host: 'example.com',
          port: 22,
          username: 'u',
          auth: { Password: 'secret' },
          projectPath: '/test',
        },
        expectedKey: 'remote:example.com:proj-1',
      },
    ];

    for (const { conn, expectedKey } of cases) {
      useGitStore.setState({ aheadBehind: {} });
      const commands = makeCommands();
      const { result } = renderHook(() => useRefreshGitInfo(makeView(), commands, conn));
      await act(async () => {
        await result.current();
      });
      expect(useGitStore.getState().aheadBehind[expectedKey]).toEqual({ ahead: 1, behind: 2 });
    }
  });

  it('should_not_throw_when_ahead_behind_fails', async () => {
    const commands = makeCommands({
      getAheadBehind: vi.fn().mockRejectedValue(new Error('boom')),
    });
    const { result } = renderHook(() =>
      useRefreshGitInfo(makeView(), commands, { type: 'local', projectId: 'proj-1' }),
    );

    await act(async () => {
      await expect(result.current()).resolves.toBeUndefined();
    });
    // git_info 仍应更新
    expect(useProjectStore.getState().projects[0]?.git_info?.current_branch).toBe('dev');
  });

  it('should_be_noop_without_project_or_commands', async () => {
    const { result } = renderHook(() =>
      useRefreshGitInfo(null, null, { type: 'local', projectId: 'proj-1' }),
    );
    await act(async () => {
      await result.current();
    });
    expect(useProjectStore.getState().projects[0]?.git_info?.current_branch).toBe('main');
  });

  it('should_keep_existing_branch_when_worktree_is_active', async () => {
    useWorktreeStore.setState({
      activeWorktreePath: '/test/wt',
      activeWorktreeBranch: 'wt-branch',
    });
    const commands = makeCommands();
    const { result } = renderHook(() =>
      useRefreshGitInfo(makeView(), commands, { type: 'local', projectId: 'proj-1' }),
    );

    await act(async () => {
      await result.current();
    });

    // worktree 激活时保留 local 主分支名，避免被 worktree 分支污染
    expect(useProjectStore.getState().projects[0]?.git_info?.current_branch).toBe('main');
    expect(useProjectStore.getState().projects[0]?.git_info?.changed_files).toEqual([]);
  });

  it('should_return_stable_callback_across_rerenders', async () => {
    const commands = makeCommands();
    const { result, rerender } = renderHook(
      ({ project }: { project: ProjectView }) =>
        useRefreshGitInfo(project, commands, { type: 'local', projectId: 'proj-1' }),
      { initialProps: { project: makeView() } },
    );
    const first = result.current;
    rerender({ project: makeView({ name: 'Renamed' }) });
    await waitFor(() => expect(result.current).toBe(first));
  });

  // ── 非 git 项目守卫（TDD Red）──────────────────────────────────────────────

  it('should_skip_git_commands_for_non_git_project', async () => {
    // 非 git 项目：store 中 git_info 为 null
    const nonGitProject = makeProject({ git_info: null });
    useProjectStore.setState({
      projects: [nonGitProject],
      activeProjectId: nonGitProject.id,
      activeProject: nonGitProject,
    });
    const commands = makeCommands();
    // view.gitInfo 为 null 表示非 git 项目
    const view = makeView({ gitInfo: null });
    const { result } = renderHook(() =>
      useRefreshGitInfo(view, commands, { type: 'local', projectId: nonGitProject.id }),
    );

    await act(async () => {
      await result.current();
    });

    // 非 git 项目不应调用 refreshGitInfo / getAheadBehind
    expect(commands.refreshGitInfo).not.toHaveBeenCalled();
    expect(commands.getAheadBehind).not.toHaveBeenCalled();
    // store 中 git_info 保持 null
    expect(useProjectStore.getState().projects[0]?.git_info).toBeNull();
  });
});
