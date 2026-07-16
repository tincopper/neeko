import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWslProjects } from '@/features/connection/hooks/useWslProjects';
import { useProjectStore } from '@/features/project/store';
import type { WSLEntrySession } from '@/shared/types';

vi.mock('@/features/terminal/components/terminalCache', () => ({
  wslCacheKey: (distro: string, projectId: string) => `wsl:${distro}:${projectId}`,
  destroyWslCachesByPrefix: vi.fn(),
  destroyRemoteCachesByPrefix: vi.fn(),
  remoteCacheKey: vi.fn(),
}));

function makeWslEntry(overrides: Partial<WSLEntrySession> = {}): WSLEntrySession {
  return {
    id: 'e1',
    distro: 'Ubuntu',
    projects: [
      { id: 'p1', name: 'proj-p1', path: '/home/user/p1', entry_id: 'e1', selected_agent: null, selected_ide: null, git_info: null, avatar_color: null },
      { id: 'p2', name: 'proj-p2', path: '/home/user/p2', entry_id: 'e1', selected_agent: null, selected_ide: null, git_info: null, avatar_color: null },
      { id: 'p3', name: 'proj-p3', path: '/home/user/p3', entry_id: 'e1', selected_agent: null, selected_ide: null, git_info: null, avatar_color: null },
    ],
    ...overrides,
  };
}

describe('useWslProjects', () => {
  const mockSaveSession = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    useProjectStore.setState({ activeProjectId: null, activeProject: null });
  });

  // The old wrapper useWslProjects now calls new useConnectionProjects which
  // returns unified property names: entries, setEntries, handleEntryAdd, etc.
  // (instead of wslEntries, setWslEntries, handleWSLEntryAdd, etc.)

  it('初始状态为空', () => {
    const { result } = renderHook(() => useWslProjects(mockSaveSession));

    expect(result.current.entries).toEqual([]);
    expect(result.current.dialogOpen).toBe(false);
    expect(result.current.addToEntryId).toBeNull();
  });

  it('handleEntryAdd 添加新 entry', async () => {
    const { result } = renderHook(() => useWslProjects(mockSaveSession));
    const entry = makeWslEntry({ id: 'new-entry' });

    await act(async () => {
      await result.current.handleEntryAdd(entry);
    });

    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0].id).toBe('new-entry');
    expect(mockSaveSession).toHaveBeenCalled();
  });

  it('handleEntryAdd 更新已有 entry', async () => {
    const { result } = renderHook(() => useWslProjects(mockSaveSession));

    // First add
    const entry = makeWslEntry({ id: 'e1', distro: 'Ubuntu' });
    await act(async () => {
      await result.current.handleEntryAdd(entry);
    });

    // Then update
    const updated = { ...entry, distro: 'Debian' };
    await act(async () => {
      await result.current.handleEntryAdd(updated);
    });

    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0].distro).toBe('Debian');
  });

  it('handleCloseProject 关闭活跃项目', () => {
    useProjectStore.setState({
      activeProjectId: 'p1',
      activeProject: { id: 'p1' } as any,
    });

    const { result } = renderHook(() => useWslProjects(mockSaveSession));

    act(() => {
      result.current.setEntries([makeWslEntry()]);
    });

    act(() => {
      result.current.handleCloseProject('e1', 'p1');
    });

    const state = useProjectStore.getState();
    expect(state.activeProjectId).toBeNull();
  });

  it('handleRemoveProject 从 entry 中移除项目', async () => {
    const { result } = renderHook(() => useWslProjects(mockSaveSession));
    const entry = makeWslEntry();

    act(() => {
      result.current.setEntries([entry]);
    });

    await act(async () => {
      await result.current.handleRemoveProject('e1', 'p1');
    });

    expect(result.current.entries[0].projects).toHaveLength(2);
    expect(result.current.entries[0].projects.find((p: any) => p.id === 'p1')).toBeUndefined();
  });

  it('handleRemoveEntry 移除整个 entry', async () => {
    const { result } = renderHook(() => useWslProjects(mockSaveSession));

    act(() => {
      result.current.setEntries([
        makeWslEntry({ id: 'e1' }),
        makeWslEntry({ id: 'e2' }),
      ]);
    });

    await act(async () => {
      await result.current.handleRemoveEntry('e1');
    });

    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0].id).toBe('e2');
  });

  it('handleAddProject 打开对话框', () => {
    const { result } = renderHook(() => useWslProjects(mockSaveSession));

    act(() => {
      result.current.handleAddProject('e1');
    });

    expect(result.current.dialogOpen).toBe(true);
    expect(result.current.addToEntryId).toBe('e1');
  });

  it('handleDialogClose 关闭对话框', () => {
    const { result } = renderHook(() => useWslProjects(mockSaveSession));

    act(() => {
      result.current.handleAddProject('e1');
    });
    act(() => {
      result.current.handleDialogClose();
    });

    expect(result.current.dialogOpen).toBe(false);
    expect(result.current.addToEntryId).toBeNull();
  });

  describe('handleDragEnd', () => {
    it('同一 entry 内正常排序', () => {
      const { result } = renderHook(() => useWslProjects(mockSaveSession));
      const entry = makeWslEntry({
        id: 'e1',
        projects: [
          { id: 'p1', name: 'A', path: '/a', entry_id: 'e1', selected_agent: null, selected_ide: null, git_info: null, avatar_color: null },
          { id: 'p2', name: 'B', path: '/b', entry_id: 'e1', selected_agent: null, selected_ide: null, git_info: null, avatar_color: null },
          { id: 'p3', name: 'C', path: '/c', entry_id: 'e1', selected_agent: null, selected_ide: null, git_info: null, avatar_color: null },
        ],
      });

      act(() => {
        result.current.setEntries([entry]);
      });
      act(() => {
        result.current.handleDragEnd('e1', 'p1', 'p3');
      });

      const projects = result.current.entries[0].projects;
      expect(projects[0].id).toBe('p2');
      expect(projects[1].id).toBe('p3');
      expect(projects[2].id).toBe('p1');
    });

    it('拖拽到相同位置不做任何操作', () => {
      const { result } = renderHook(() => useWslProjects(mockSaveSession));
      const entry = makeWslEntry();

      act(() => {
        result.current.setEntries([entry]);
      });
      act(() => {
        result.current.handleDragEnd('e1', 'p1', 'p1');
      });

      expect(result.current.entries[0].projects).toHaveLength(3);
    });

    it('跨 entry 拖拽被忽略', () => {
      const { result } = renderHook(() => useWslProjects(mockSaveSession));
      const entries = [
        makeWslEntry({ id: 'e1', projects: [{ id: 'p1', name: 'A', path: '/a', entry_id: 'e1', selected_agent: null, selected_ide: null, git_info: null, avatar_color: null }] }),
        makeWslEntry({ id: 'e2', projects: [{ id: 'p2', name: 'B', path: '/b', entry_id: 'e2', selected_agent: null, selected_ide: null, git_info: null, avatar_color: null }] }),
      ];

      act(() => {
        result.current.setEntries(entries);
      });
      act(() => {
        result.current.handleDragEnd('e1', 'p1', 'e2');
      });

      expect(result.current.entries[0].projects).toHaveLength(1);
    });

    it('排序后调用 saveSession 持久化', () => {
      const { result } = renderHook(() => useWslProjects(mockSaveSession));
      const entry = makeWslEntry();

      act(() => {
        result.current.setEntries([entry]);
      });
      act(() => {
        result.current.handleDragEnd('e1', 'p1', 'p3');
      });

      expect(mockSaveSession).toHaveBeenCalledTimes(1);
    });
  });
});
