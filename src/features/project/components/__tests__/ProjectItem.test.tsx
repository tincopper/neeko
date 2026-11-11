import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ProjectItem from '@/features/project/components/ProjectItem';
import type { ProjectItemActions } from '@/features/project/components/projectItemTypes';
import type { Project } from '@/shared/types';
import { invoke } from '@/testing/tauriCore';

function createProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p-1',
    name: 'neeko',
    path: '/tmp/neeko',
    git_info: {
      current_branch: 'main',
      branches: ['main', 'feature/a'],
      worktrees: [
        {
          path: '/tmp/neeko-worktrees/feature-a',
          branch: 'feature/a',
          head: 'abc',
        },
      ],
      // 未提交变更不在 GitInfo 里（per 工作树 的事实，经 projectStore.statuses 按单元投递）
    },
    terminal: {
      id: 't-1',
      pid: null,
      status: 'Idle',
      history: [],
      agent: null,
    },
    selected_agents: [],
    selected_ide: null,
    active_view: 'Terminal',
    collapsed: false,
    ...overrides,
  };
}

function createActions(overrides: Partial<ProjectItemActions> = {}): ProjectItemActions {
  return {
    onSelectProject: vi.fn(),
    onRemoveProject: vi.fn(),
    onSelectFile: vi.fn(),
    onRefreshGit: vi.fn(),
    onBackToMainTerminal: vi.fn(),
    onOpenDialog: vi.fn(),
    ...overrides,
  };
}

describe('ProjectItem', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(undefined);
  });

  it('点击组头只切换折叠状态，不触发项目选中', () => {
    const project = createProject({ collapsed: true });
    const onSelectProject = vi.fn();
    const actions = createActions({ onSelectProject });

    render(<ProjectItem project={project} isActive={false} actions={actions} />);

    expect(screen.queryByText('local')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('neeko'));

    expect(screen.getByText('local')).toBeInTheDocument();
    expect(onSelectProject).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith('set_project_collapsed', {
      projectId: 'p-1',
      collapsed: false,
    });
  });

  it('点击 local 行触发主项目选中', () => {
    const project = createProject();
    const onSelectProject = vi.fn();
    const actions = createActions({ onSelectProject });

    render(<ProjectItem project={project} isActive={false} actions={actions} />);

    fireEvent.click(screen.getByText('local'));

    expect(onSelectProject).toHaveBeenCalledWith('p-1');
  });

  it('点击 worktree 行触发 worktree terminal 打开', () => {
    const project = createProject();
    const onOpenWorktreeTerminal = vi.fn();
    const actions = createActions({ onOpenWorktreeTerminal });

    render(<ProjectItem project={project} isActive={false} actions={actions} />);

    fireEvent.click(screen.getByText('feature-a'));

    expect(onOpenWorktreeTerminal).toHaveBeenCalledWith(
      'p-1',
      '/tmp/neeko-worktrees/feature-a',
      'feature/a',
    );
  });

  it('非 Git 项目仍显示 local 行且不显示分支徽标', () => {
    const project = createProject({ git_info: null });
    const actions = createActions();

    render(<ProjectItem project={project} isActive={false} actions={actions} />);

    expect(screen.getByText('local')).toBeInTheDocument();
    expect(screen.queryByText('main')).not.toBeInTheDocument();
  });
});

describe('ProjectItem — 打开本项目的 Tasks（design §4.2c）', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(undefined);
  });

  it('右键菜单里有「Open Tasks」，点了转交 onOpenTasks(projectId)', () => {
    const project = createProject({ collapsed: false });
    const onOpenTasks = vi.fn();
    const actions = createActions({ onOpenTasks });

    render(<ProjectItem project={project} isActive={false} actions={actions} />);

    fireEvent.contextMenu(screen.getByTestId('project-group-header'));
    fireEvent.click(screen.getByText('Open Tasks'));

    expect(onOpenTasks).toHaveBeenCalledWith('p-1');
  });

  it('悬停按钮也能打开本项目 Tasks（与右键是同一个动作）', () => {
    const project = createProject({ collapsed: false });
    const onOpenTasks = vi.fn();
    const actions = createActions({ onOpenTasks });

    render(<ProjectItem project={project} isActive={false} actions={actions} />);

    fireEvent.click(screen.getByTitle('Open Tasks'));

    expect(onOpenTasks).toHaveBeenCalledWith('p-1');
  });

  it('没注入 onOpenTasks 时不渲染入口（不给一个点了没反应的按钮）', () => {
    const project = createProject({ collapsed: false });
    const actions = createActions();

    render(<ProjectItem project={project} isActive={false} actions={actions} />);

    expect(screen.queryByTitle('Open Tasks')).not.toBeInTheDocument();
    fireEvent.contextMenu(screen.getByTestId('project-group-header'));
    expect(screen.queryByText('Open Tasks')).not.toBeInTheDocument();
  });
});
