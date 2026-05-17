import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { useLocalProjects } from '../../hooks/useLocalProjects';
import { useAppStore } from '../../store/appStore';
import { createProject } from '../../testing/factories';

// mock destroyTerminalCache — 不验证内部调用
vi.mock('../../components/terminal', () => ({
  destroyTerminalCachesByPrefix: vi.fn(),
  refreshTerminal: vi.fn(),
  refreshSideTerminal: vi.fn(),
}));

const mockInvoke = vi.mocked(invoke);
const mockOpen = vi.mocked(open);

describe('useLocalProjects', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockOpen.mockReset();
  });

  it('初始状态为空', () => {
    mockInvoke.mockResolvedValue([]);
    const { result } = renderHook(() => useLocalProjects());

    expect(result.current.projects).toEqual([]);
    expect(result.current.activeProjectId).toBeNull();
    expect(result.current.activeProject).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.agents).toEqual([]);
  });

  it('loadProjects 获取项目列表', async () => {
    const projects = [createProject({ id: 'p1' }), createProject({ id: 'p2' })];
    mockInvoke.mockResolvedValue(projects);

    const { result } = renderHook(() => useLocalProjects());

    await act(async () => {
      await result.current.loadProjects();
    });

    expect(result.current.projects).toHaveLength(2);
    expect(mockInvoke).toHaveBeenCalledWith('list_projects');
  });

  it('loadAgents 获取 agent 列表', async () => {
    const agents = [{ id: 'claude', name: 'Claude', command: 'claude', args: [], icon: null, enabled: true }];
    mockInvoke.mockResolvedValue(agents);

    const { result } = renderHook(() => useLocalProjects());

    await act(async () => {
      await result.current.loadAgents();
    });

    expect(result.current.agents).toHaveLength(1);
    expect(mockInvoke).toHaveBeenCalledWith('list_agents');
  });

  it('handleConfirmAddProject 添加项目', async () => {
    const newProject = createProject({ id: 'new-1', name: 'new-project' });
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'add_project') return newProject;
      if (cmd === 'save_session') return undefined;
      if (cmd === 'list_projects') return [newProject];
      return undefined;
    });

    const { result } = renderHook(() => useLocalProjects());

    // 模拟 pendingPath 已设置
    act(() => {
      result.current.setPendingPath('/tmp/new-project');
    });

    await act(async () => {
      await result.current.handleConfirmAddProject(null, null);
    });

    expect(mockInvoke).toHaveBeenCalledWith('add_project', {
      path: '/tmp/new-project',
      agentId: null,
      ide: null,
    });
    expect(result.current.projects).toContainEqual(
      expect.objectContaining({ id: 'new-1' }),
    );
    expect(result.current.activeProjectId).toBe('new-1');
    expect(result.current.pendingPath).toBeNull();
  });

  it('没有 pendingPath 时不调用 add_project', async () => {
    mockInvoke.mockResolvedValue([]);

    const { result } = renderHook(() => useLocalProjects());

    await act(async () => {
      await result.current.handleConfirmAddProject('agent', 'code');
    });

    expect(mockInvoke).not.toHaveBeenCalledWith('add_project', expect.anything());
  });

  it('handleRemoveProject 移除项目', async () => {
    const projects = [
      createProject({ id: 'p1', name: 'proj1' }),
      createProject({ id: 'p2', name: 'proj2' }),
    ];
    mockInvoke.mockResolvedValue(projects);

    const { result } = renderHook(() => useLocalProjects());

    await act(async () => {
      await result.current.loadProjects();
    });

    mockInvoke.mockResolvedValue(undefined);

    await act(async () => {
      await result.current.handleRemoveProject('p1');
    });

    expect(mockInvoke).toHaveBeenCalledWith('remove_project', { projectId: 'p1' });
    expect(result.current.projects).toHaveLength(1);
    expect(result.current.projects[0].id).toBe('p2');
  });

  it('移除活跃项目时切换到第一个项目', async () => {
    const projects = [
      createProject({ id: 'p1' }),
      createProject({ id: 'p2' }),
    ];
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_projects') return projects;
      if (cmd === 'remove_project') return undefined;
      return undefined;
    });

    const { result } = renderHook(() => useLocalProjects());

    await act(async () => {
      await result.current.loadProjects();
    });

    act(() => {
      result.current.setActiveProjectId('p1');
    });

    await act(async () => {
      await result.current.handleRemoveProject('p1');
    });

    expect(result.current.activeProjectId).toBe('p2');
  });

  it('handleSelectProject 设置活跃项目', async () => {
    const project = createProject({ id: 'sel-1' });
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_projects') return [project];
      return undefined;
    });

    const { result } = renderHook(() => useLocalProjects());

    await act(async () => {
      await result.current.handleSelectProject('sel-1');
    });

    expect(result.current.activeProjectId).toBe('sel-1');
    expect(mockInvoke).toHaveBeenCalledWith('set_active_project', { projectId: 'sel-1' });

  });

  it('handleRefreshGit 刷新 git 信息', async () => {
    mockInvoke.mockResolvedValue([]);

    const { result } = renderHook(() => useLocalProjects());

    await act(async () => {
      await result.current.handleRefreshGit('p1');
    });

    expect(mockInvoke).toHaveBeenCalledWith('get_worktree_changed_files', { projectId: 'p1', worktreePath: '' });
  });

  it('handleOpenIde 不做任何操作当无 IDE', async () => {
    mockInvoke.mockResolvedValue([]);

    const { result } = renderHook(() => useLocalProjects());

    await act(async () => {
      await result.current.handleOpenIde({ id: 'p1', selected_ide: null });
    });

    expect(mockInvoke).not.toHaveBeenCalledWith('open_ide', expect.anything());
  });

  it('handleOpenIde 调用 open_ide', async () => {
    const project = createProject({
      id: 'p1',
      name: 'test',
      path: '/tmp/test',
      selected_ide: 'code',
    });
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_projects') return [project];
      return undefined;
    });

    const { result } = renderHook(() => useLocalProjects());

    await act(async () => {
      await result.current.loadProjects();
    });

    await act(async () => {
      await result.current.handleOpenIde({ id: 'p1', selected_ide: 'code' });
    });

    expect(mockInvoke).toHaveBeenCalledWith('open_ide', {
      ideCommand: 'code',
      projectPath: '/tmp/test',
    });
  });

  it.skip('handleSelectFile 在项目未激活时先激活项目再设 diff 视图', async () => {
    const project = createProject({ id: 'p-diff', name: 'diff-proj' });
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_projects') return [project];
      return undefined;
    });

    const { result } = renderHook(() => useLocalProjects());

    await act(async () => {
      await result.current.loadProjects();
    });

    // 此时 activeProjectId 为 null（项目从未被激活）
    expect(result.current.activeProjectId).toBeNull();

    await act(async () => {
      await result.current.handleSelectFile('p-diff', 'src/foo.ts');
    });

    // 激活项目
    expect(result.current.activeProjectId).toBe('p-diff');
    // 激活项目时必须先调用 set_view_terminal（使 activeProject 在 diff 前有效）
    const calls = mockInvoke.mock.calls.map((c) => c[0]);
    const terminalIdx = calls.lastIndexOf('set_view_terminal');
    const diffIdx = calls.lastIndexOf('set_view_diff');
    expect(terminalIdx).toBeGreaterThanOrEqual(0);
    expect(diffIdx).toBeGreaterThan(terminalIdx);
  });

  it('handleSelectFile 在项目已激活时创建 diff tab', async () => {
    const project = createProject({ id: 'p-active' });
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_projects') return [project];
      return undefined;
    });

    const { result } = renderHook(() => useLocalProjects());

    await act(async () => {
      await result.current.handleSelectProject('p-active');
    });

    mockInvoke.mockClear();

    await act(async () => {
      await result.current.handleSelectFile('p-active', 'src/bar.ts');
    });

    // 项目已激活，不应再调用 set_active_project
    expect(mockInvoke).not.toHaveBeenCalledWith('set_active_project', expect.anything());
    // 应在 store 中创建 diff tab
    const storeTabs = useAppStore.getState().tabs['p-active'];
    expect(storeTabs).toBeDefined();
    const diffTab = storeTabs?.tabs.find((t) => t.data.kind === 'diff');
    expect(diffTab).toBeDefined();
    expect(diffTab?.data.kind === 'diff' && diffTab.data.filePath).toBe('src/bar.ts');
  });

  it('activeProject 随 activeProjectId 同步', async () => {
    const projects = [createProject({ id: 'p1', name: '同步测试' })];
    mockInvoke.mockResolvedValue(projects);

    const { result } = renderHook(() => useLocalProjects());

    await act(async () => {
      await result.current.loadProjects();
    });

    act(() => {
      result.current.setActiveProjectId('p1');
    });

    await waitFor(() => {
      expect(result.current.activeProject?.name).toBe('同步测试');
    });

    act(() => {
      result.current.setActiveProjectId(null);
    });

    expect(result.current.activeProject).toBeNull();
  });

  describe('handleDragEnd', () => {
    it('列表内正常排序', async () => {
      const projects = [
        createProject({ id: 'p1', name: 'proj1' }),
        createProject({ id: 'p2', name: 'proj2' }),
        createProject({ id: 'p3', name: 'proj3' }),
      ];
      mockInvoke.mockResolvedValue(projects);

      const { result } = renderHook(() => useLocalProjects());

      await act(async () => {
        await result.current.loadProjects();
      });

      mockInvoke.mockResolvedValue(undefined);

      act(() => {
        result.current.handleDragEnd('p1', 'p3');
      });

      expect(result.current.projects.map(p => p.id)).toEqual(['p2', 'p3', 'p1']);
      expect(mockInvoke).toHaveBeenCalledWith('reorder_projects', {
        orderedIds: ['p2', 'p3', 'p1'],
      });
    });

    it('拖拽到相同位置不做任何操作', async () => {
      const projects = [
        createProject({ id: 'p1', name: 'proj1' }),
        createProject({ id: 'p2', name: 'proj2' }),
      ];
      mockInvoke.mockResolvedValue(projects);

      const { result } = renderHook(() => useLocalProjects());

      await act(async () => {
        await result.current.loadProjects();
      });

      mockInvoke.mockClear();

      act(() => {
        result.current.handleDragEnd('p1', 'p1');
      });

      expect(result.current.projects.map(p => p.id)).toEqual(['p1', 'p2']);
      expect(mockInvoke).not.toHaveBeenCalledWith('reorder_projects', expect.anything());
    });

    it('排序后调用 reorder_projects 持久化', async () => {
      const projects = [
        createProject({ id: 'p1', name: 'proj1' }),
        createProject({ id: 'p2', name: 'proj2' }),
      ];
      mockInvoke.mockResolvedValue(projects);

      const { result } = renderHook(() => useLocalProjects());

      await act(async () => {
        await result.current.loadProjects();
      });

      mockInvoke.mockResolvedValue(undefined);

      act(() => {
        result.current.handleDragEnd('p2', 'p1');
      });

      expect(mockInvoke).toHaveBeenCalledWith('reorder_projects', {
        orderedIds: ['p2', 'p1'],
      });
    });
  });
});
