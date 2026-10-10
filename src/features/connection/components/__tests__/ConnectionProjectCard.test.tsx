import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import ConnectionProjectCard from '@/features/connection/components/ConnectionProjectCard';
import { useGitStore } from '@/shared/store/gitStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorkspaceStore } from '@/shared/store/workspaceStore';
import type { FileChange, GitStatusSnapshot, WSLProject } from '@/shared/types';
import { WorkspaceSession } from '@/shared/utils/workspaceRef';
import { invoke } from '@/testing/tauriCore';

/** 某Workspace的权威 status（主仓 worktree_path = null）。 */
function makeSnapshot(
  projectId: string,
  worktreePath: string | null,
  entries: FileChange[],
): GitStatusSnapshot {
  return {
    workspace_key: WorkspaceSession.of(projectId, worktreePath ?? null).key,
    version: 1,
    project_id: projectId,
    worktree_path: worktreePath,
    branch: 'main',
    entries,
    truncated: false,
  };
}

const MODIFIED: FileChange = {
  path: 'src/A.tsx',
  status: 'Modified',
  additions: 4,
  deletions: 1,
};

function makeWslProject(overrides: Partial<WSLProject> = {}): WSLProject {
  return {
    id: 'wsl-p1',
    name: 'demo',
    path: '/home/user/demo',
    distro: 'Ubuntu',
    entry_id: 'entry-1',
    selected_agents: [],
    selected_ide: null,
    git_info: {
      current_branch: 'main',
      branches: ['main'],
      worktrees: [
        {
          path: '/home/user/wts/feature-x',
          branch: 'feature/x',
          head: 'abc',
        },
      ],
      // 注意：GitInfo 不再有 changed_files / is_clean —— 未提交变更属于每个工作树，
      // 经 projectStore.statuses[WorkspaceSession.of(projectId, (worktreePath) ?? null).key] 按单元投递。
    },
    ...overrides,
  };
}

describe('ConnectionProjectCard (WSL)', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue([]);
    // reset store（工作树单元状态只有 byProject 一份表示）
    useWorkspaceStore.setState({ byProject: {} });
    useProjectStore.setState({ statuses: {} });
    useGitStore.setState({
      aheadBehind: {},
    });
  });

  it('展开后渲染 local 主终端行（branch + 聚合 +A -D）和 worktree 行', async () => {
    const project = makeWslProject();
    useProjectStore.getState().applyStatus(makeSnapshot(project.id, null, [MODIFIED]));
    render(
      <ConnectionProjectCard
        project={project}
        entryId="entry-1"
        source={{ type: 'wsl', distro: 'Ubuntu' }}
        isActive={false}
        onSelectProject={vi.fn()}
        onRemoveProject={vi.fn()}
      />,
    );
    // 等待 mount 后异步 worktree/分支数据加载完成（同时 flush 其 setState）
    await waitFor(() => {
      expect(screen.getByText('local')).toBeInTheDocument();
    });

    // git_info 存在 → 自动展开
    expect(screen.getByText('local')).toBeInTheDocument();
    // worktree 目录名
    expect(screen.getByText('feature-x')).toBeInTheDocument();
    // local 行 changed_files 聚合：+4 -1
    expect(screen.getByText('+4')).toBeInTheDocument();
    expect(screen.getByText('-1')).toBeInTheDocument();
  });

  it('点击 local 行触发 onSelectProject (传入 distro + project)', async () => {
    const project = makeWslProject();
    const onSelectProject = vi.fn();
    render(
      <ConnectionProjectCard
        project={project}
        entryId="entry-1"
        source={{ type: 'wsl', distro: 'Ubuntu' }}
        isActive={false}
        onSelectProject={onSelectProject}
        onRemoveProject={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText('local')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('local'));
    expect(onSelectProject).toHaveBeenCalledWith(project.id);
  });

  it('点击 worktree 行触发 onOpenWorktreeTerminal (传入 distro)', async () => {
    const project = makeWslProject();
    const onOpenWorktreeTerminal = vi.fn();
    render(
      <ConnectionProjectCard
        project={project}
        entryId="entry-1"
        source={{ type: 'wsl', distro: 'Ubuntu' }}
        isActive={false}
        onSelectProject={vi.fn()}
        onRemoveProject={vi.fn()}
        onOpenWorktreeTerminal={onOpenWorktreeTerminal}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText('feature-x')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('feature-x'));
    expect(onOpenWorktreeTerminal).toHaveBeenCalledWith(
      'Ubuntu',
      '/home/user/wts/feature-x',
      'feature/x',
    );
  });

  it('active + 无 active worktree 时 local 行显示 ↑N（来自 store 的 aheadBehind）', async () => {
    const project = makeWslProject();
    // 键 = Workspace身份（主仓单元）。旧键是 `wsl:Ubuntu:wsl-p1` —— 三个写入点各用一种
    // connectionId 约定，读侧拼不出写侧的键，徽标因此时有时无。
    useGitStore.setState({
      aheadBehind: { [WorkspaceSession.of(project.id, null).key]: { ahead: 3, behind: 0 } },
    });
    render(
      <ConnectionProjectCard
        project={project}
        entryId="entry-1"
        source={{ type: 'wsl', distro: 'Ubuntu' }}
        isActive
        onSelectProject={vi.fn()}
        onRemoveProject={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText('↑3')).toBeInTheDocument();
    });

    expect(screen.getByText('↑3')).toBeInTheDocument();
  });

  it('active worktree 与 isActive 都成立时 local 行不显示 ↑N（显示的是该 worktree 的视图）', async () => {
    const project = makeWslProject();
    const wtPath = '/home/user/wts/feature-x';
    useWorkspaceStore.getState().setActiveWorkspace(project.id, wtPath);
    // 两个单元的键都给值：主仓的数字**不得**泄漏到 worktree 视图的 local 行上
    useGitStore.setState({
      aheadBehind: {
        [WorkspaceSession.of(project.id, null).key]: { ahead: 3, behind: 0 },
        [WorkspaceSession.of(project.id, wtPath ?? null).key]: { ahead: 9, behind: 0 },
      },
    });
    render(
      <ConnectionProjectCard
        project={project}
        entryId="entry-1"
        source={{ type: 'wsl', distro: 'Ubuntu' }}
        isActive
        onSelectProject={vi.fn()}
        onRemoveProject={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(screen.queryByText('↑3')).not.toBeInTheDocument();
    });
    expect(screen.queryByText('↑9')).not.toBeInTheDocument();
  });

  /**
   * 本次根因的钉死用例：未提交变更是 **per 工作树** 的事实。旧实现把 changed_files 挂在
   * per-project 的 git_info 上，worktree 的条目因此会串到主仓行（反之亦然）。
   * worktree 行的条目来自按单元的状态命令；主仓单元在 store 里**没有**条目（未知）。
   * 断言 `+4` 只出现 **1 次**：若主仓行泄漏 worktree 条目，它会出现在两行里（=2）。
   */
  it('worktree 单元的变更不泄漏到 local 主终端行（按 workspace_key 分域）', async () => {
    const project = makeWslProject();
    const wtPath = '/home/user/wts/feature-x';
    vi.mocked(invoke).mockImplementation(async (cmd) =>
      cmd === 'get_workspace_status' ? makeSnapshot(project.id, wtPath, [MODIFIED]) : [],
    );
    render(
      <ConnectionProjectCard
        project={project}
        entryId="entry-1"
        source={{ type: 'wsl', distro: 'Ubuntu' }}
        isActive
        onSelectProject={vi.fn()}
        onRemoveProject={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(screen.getAllByText('+4')).toHaveLength(1);
    });
    expect(screen.getAllByText('-1')).toHaveLength(1);
    expect(screen.getByText('local')).toBeInTheDocument();
  });
});
