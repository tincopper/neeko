import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import ConnectionProjectCard from '@/features/connection/components/ConnectionProjectCard';
import { useGitStore } from '@/shared/store/gitStore';
import { useWorktreeStore } from '@/shared/store/worktreeStore';
import type { WSLProject } from '@/shared/types';
import { invoke } from '@/testing/tauriCore';

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
      changed_files: [{ path: 'src/A.tsx', status: 'Modified', additions: 4, deletions: 1 }],
      is_clean: false,
    },
    ...overrides,
  };
}

describe('ConnectionProjectCard (WSL)', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue([]);
    // reset store
    useWorktreeStore.setState({
      activeWslWorktreePath: null,
      activeRemoteWorktreePath: null,
    });
    useGitStore.setState({
      aheadBehind: {},
    });
  });

  it('展开后渲染 local 主终端行（branch + 聚合 +A -D）和 worktree 行', async () => {
    const project = makeWslProject();
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
    useGitStore.setState({
      aheadBehind: { 'wsl:Ubuntu:wsl-p1': { ahead: 3, behind: 0 } },
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

  it('active worktree 与 isActive 都成立时 local 行不显示 ↑N', async () => {
    const project = makeWslProject();
    useWorktreeStore.setState({
      activeWorktreePath: '/home/user/wts/feature-x',
    });
    useGitStore.setState({
      aheadBehind: { 'wsl:Ubuntu:wsl-p1': { ahead: 3, behind: 0 } },
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
  });
});
