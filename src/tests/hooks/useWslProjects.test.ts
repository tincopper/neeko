import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWslProjects } from '../../hooks/useWslProjects';

// mock terminal functions
vi.mock('../../components/terminal', () => ({
  wslCacheKey: (distro: string, projectId: string) => `wsl:${distro}:${projectId}`,
  destroyWslCache: vi.fn(),
}));

describe('useWslProjects', () => {
  const mockSaveSession = vi.fn();

  beforeEach(() => {
    mockSaveSession.mockReset();
    mockSaveSession.mockResolvedValue(undefined);
  });

  it('初始状态为空', () => {
    const { result } = renderHook(() => useWslProjects(mockSaveSession));

    expect(result.current.wslEntries).toEqual([]);
    expect(result.current.activeWslKey).toBeNull();
    expect(result.current.activeWslProject).toBeNull();
    expect(result.current.wslDialogOpen).toBe(false);
    expect(result.current.wslAddToEntryId).toBeNull();
  });

  it('handleWSLEntryAdd 添加新 entry', async () => {
    const { result } = renderHook(() => useWslProjects(mockSaveSession));

    const entry = {
      id: 'entry-1',
      distro: 'Ubuntu',
      projects: [
        { id: 'wp1', name: 'ws-project', path: '/home/user/proj' },
      ],
    };

    await act(async () => {
      await result.current.handleWSLEntryAdd(entry);
    });

    expect(result.current.wslEntries).toHaveLength(1);
    expect(result.current.wslEntries[0].distro).toBe('Ubuntu');
    expect(mockSaveSession).toHaveBeenCalledWith([entry]);
  });

  it('handleWSLEntryAdd 更新已有 entry', async () => {
    const { result } = renderHook(() => useWslProjects(mockSaveSession));

    const entry = {
      id: 'entry-1',
      distro: 'Ubuntu',
      projects: [{ id: 'wp1', name: 'proj1', path: '/home/user/proj1' }],
    };

    await act(async () => {
      await result.current.handleWSLEntryAdd(entry);
    });

    const updated = {
      ...entry,
      projects: [
        ...entry.projects,
        { id: 'wp2', name: 'proj2', path: '/home/user/proj2' },
      ],
    };

    await act(async () => {
      await result.current.handleWSLEntryAdd(updated);
    });

    expect(result.current.wslEntries).toHaveLength(1); // 仍然是 1 个 entry
    expect(result.current.wslEntries[0].projects).toHaveLength(2);
  });

  it('handleCloseWslProject 关闭活跃项目', () => {
    const { result } = renderHook(() => useWslProjects(mockSaveSession));

    // 先添加 entry
    act(() => {
      result.current.setWslEntries([
        {
          id: 'e1',
          distro: 'Ubuntu',
          projects: [{ id: 'wp1', name: 'p1', path: '/tmp/p1' }],
        },
      ]);
    });

    act(() => {
      result.current.setActiveWslKey({ distro: 'Ubuntu', projectId: 'wp1' });
    });

    act(() => {
      result.current.setWslOpenSessions(new Set(['wp1']));
    });

    act(() => {
      result.current.handleCloseWslProject('e1', 'wp1');
    });

    expect(result.current.activeWslKey).toBeNull();
    expect(result.current.activeWslProject).toBeNull();
    expect(result.current.wslOpenSessions.has('wp1')).toBe(false);
  });

  it('handleRemoveWslProject 从 entry 中移除项目', async () => {
    const { result } = renderHook(() => useWslProjects(mockSaveSession));

    const entry = {
      id: 'e1',
      distro: 'Ubuntu',
      projects: [
        { id: 'wp1', name: 'p1', path: '/tmp/p1' },
        { id: 'wp2', name: 'p2', path: '/tmp/p2' },
      ],
    };

    act(() => {
      result.current.setWslEntries([entry]);
    });

    await act(async () => {
      await result.current.handleRemoveWslProject('e1', 'wp1');
    });

    expect(result.current.wslEntries[0].projects).toHaveLength(1);
    expect(result.current.wslEntries[0].projects[0].id).toBe('wp2');
    expect(mockSaveSession).toHaveBeenCalled();
  });

  it('handleRemoveWslEntry 移除整个 entry', async () => {
    const { result } = renderHook(() => useWslProjects(mockSaveSession));

    act(() => {
      result.current.setWslEntries([
        {
          id: 'e1',
          distro: 'Ubuntu',
          projects: [{ id: 'wp1', name: 'p1', path: '/tmp/p1' }],
        },
        {
          id: 'e2',
          distro: 'Debian',
          projects: [{ id: 'wp2', name: 'p2', path: '/tmp/p2' }],
        },
      ]);
    });

    await act(async () => {
      await result.current.handleRemoveWslEntry('e1');
    });

    expect(result.current.wslEntries).toHaveLength(1);
    expect(result.current.wslEntries[0].id).toBe('e2');
  });

  it('handleAddWslProject 打开对话框', () => {
    const { result } = renderHook(() => useWslProjects(mockSaveSession));

    act(() => {
      result.current.handleAddWslProject('e1');
    });

    expect(result.current.wslDialogOpen).toBe(true);
    expect(result.current.wslAddToEntryId).toBe('e1');
  });

  it('handleWslDialogClose 关闭对话框', () => {
    const { result } = renderHook(() => useWslProjects(mockSaveSession));

    act(() => {
      result.current.handleAddWslProject('e1');
    });

    act(() => {
      result.current.handleWslDialogClose();
    });

    expect(result.current.wslDialogOpen).toBe(false);
    expect(result.current.wslAddToEntryId).toBeNull();
  });
});
