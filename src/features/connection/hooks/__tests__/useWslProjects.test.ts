import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWslProjects } from '@/features/connection/hooks/useWslProjects';
import type { WSLEntrySession } from '@/shared/types';

// mock terminal functions
vi.mock('@/features/terminal/components/terminalCache', () => ({
  wslCacheKey: (distro: string, projectId: string) => `wsl:${distro}:${projectId}`,
  destroyWslCachesByPrefix: vi.fn(),
}));

const makeWslProject = (overrides: {
  id: string;
  name: string;
  path: string;
  distro?: string;
  entry_id?: string;
}) => ({
  id: overrides.id,
  name: overrides.name,
  path: overrides.path,
  distro: overrides.distro ?? 'Ubuntu',
  entry_id: overrides.entry_id ?? 'entry-1',
  selected_agent: null,
  selected_ide: null,
});

const makeWslEntry = (overrides: {
  id: string;
  distro: string;
  projects: ReturnType<typeof makeWslProject>[];
}): WSLEntrySession => ({
  id: overrides.id,
  distro: overrides.distro,
  projects: overrides.projects,
});

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

    const entry = makeWslEntry({
      id: 'entry-1',
      distro: 'Ubuntu',
      projects: [makeWslProject({ id: 'wp1', name: 'ws-project', path: '/home/user/proj' })],
    });

    await act(async () => {
      await result.current.handleWSLEntryAdd(entry);
    });

    expect(result.current.wslEntries).toHaveLength(1);
    expect(result.current.wslEntries[0].distro).toBe('Ubuntu');
    expect(mockSaveSession).toHaveBeenCalledWith([entry]);
  });

  it('handleWSLEntryAdd 更新已有 entry', async () => {
    const { result } = renderHook(() => useWslProjects(mockSaveSession));

    const entry = makeWslEntry({
      id: 'entry-1',
      distro: 'Ubuntu',
      projects: [makeWslProject({ id: 'wp1', name: 'proj1', path: '/home/user/proj1' })],
    });

    await act(async () => {
      await result.current.handleWSLEntryAdd(entry);
    });

    const updated: WSLEntrySession = {
      ...entry,
      projects: [
        ...entry.projects,
        makeWslProject({ id: 'wp2', name: 'proj2', path: '/home/user/proj2' }),
      ],
    };

    await act(async () => {
      await result.current.handleWSLEntryAdd(updated);
    });

    expect(result.current.wslEntries).toHaveLength(1);
    expect(result.current.wslEntries[0].projects).toHaveLength(2);
  });

  it('handleCloseWslProject 关闭活跃项目', () => {
    const { result } = renderHook(() => useWslProjects(mockSaveSession));

    act(() => {
      result.current.setWslEntries([
        makeWslEntry({
          id: 'e1',
          distro: 'Ubuntu',
          projects: [makeWslProject({ id: 'wp1', name: 'p1', path: '/tmp/p1' })],
        }),
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

    const entry = makeWslEntry({
      id: 'e1',
      distro: 'Ubuntu',
      projects: [
        makeWslProject({ id: 'wp1', name: 'p1', path: '/tmp/p1' }),
        makeWslProject({ id: 'wp2', name: 'p2', path: '/tmp/p2' }),
      ],
    });

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
        makeWslEntry({
          id: 'e1',
          distro: 'Ubuntu',
          projects: [makeWslProject({ id: 'wp1', name: 'p1', path: '/tmp/p1' })],
        }),
        makeWslEntry({
          id: 'e2',
          distro: 'Debian',
          projects: [makeWslProject({ id: 'wp2', name: 'p2', path: '/tmp/p2' })],
        }),
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

  describe('handleWslDragEnd', () => {
    it('同一 entry 内正常排序', async () => {
      const { result } = renderHook(() => useWslProjects(mockSaveSession));

      const entry = makeWslEntry({
        id: 'e1',
        distro: 'Ubuntu',
        projects: [
          makeWslProject({ id: 'wp1', name: 'p1', path: '/tmp/p1' }),
          makeWslProject({ id: 'wp2', name: 'p2', path: '/tmp/p2' }),
          makeWslProject({ id: 'wp3', name: 'p3', path: '/tmp/p3' }),
        ],
      });

      act(() => {
        result.current.setWslEntries([entry]);
      });

      await act(async () => {
        result.current.handleWslDragEnd('e1', 'wp1', 'wp3');
      });

      expect(result.current.wslEntries[0].projects.map(p => p.id)).toEqual(['wp2', 'wp3', 'wp1']);
      expect(mockSaveSession).toHaveBeenCalled();
    });

    it('拖拽到相同位置不做任何操作', async () => {
      const { result } = renderHook(() => useWslProjects(mockSaveSession));

      const entry = makeWslEntry({
        id: 'e1',
        distro: 'Ubuntu',
        projects: [
          makeWslProject({ id: 'wp1', name: 'p1', path: '/tmp/p1' }),
          makeWslProject({ id: 'wp2', name: 'p2', path: '/tmp/p2' }),
        ],
      });

      act(() => {
        result.current.setWslEntries([entry]);
      });

      mockSaveSession.mockClear();

      await act(async () => {
        result.current.handleWslDragEnd('e1', 'wp1', 'wp1');
      });

      expect(result.current.wslEntries[0].projects.map(p => p.id)).toEqual(['wp1', 'wp2']);
      expect(mockSaveSession).not.toHaveBeenCalled();
    });

    it('跨 entry 拖拽被忽略', async () => {
      const { result } = renderHook(() => useWslProjects(mockSaveSession));

      const entries = [
        makeWslEntry({
          id: 'e1',
          distro: 'Ubuntu',
          projects: [
            makeWslProject({ id: 'wp1', name: 'p1', path: '/tmp/p1' }),
          ],
        }),
        makeWslEntry({
          id: 'e2',
          distro: 'Debian',
          projects: [
            makeWslProject({ id: 'wp2', name: 'p2', path: '/tmp/p2' }),
          ],
        }),
      ];

      act(() => {
        result.current.setWslEntries(entries);
      });

      // Drag wp1 into e2 (entryId='e2') — should be a no-op since wp1 isn't in e2
      await act(async () => {
        result.current.handleWslDragEnd('e2', 'wp1', 'wp2');
      });

      // wp1 still in e1, wp2 still in e2 — no cross-entry movement
      expect(result.current.wslEntries[0].projects[0].id).toBe('wp1');
      expect(result.current.wslEntries[1].projects[0].id).toBe('wp2');
    });

    it('排序后调用 saveSession 持久化', async () => {
      const { result } = renderHook(() => useWslProjects(mockSaveSession));

      const entry = makeWslEntry({
        id: 'e1',
        distro: 'Ubuntu',
        projects: [
          makeWslProject({ id: 'wp1', name: 'p1', path: '/tmp/p1' }),
          makeWslProject({ id: 'wp2', name: 'p2', path: '/tmp/p2' }),
        ],
      });

      act(() => {
        result.current.setWslEntries([entry]);
      });

      mockSaveSession.mockClear();

      await act(async () => {
        result.current.handleWslDragEnd('e1', 'wp2', 'wp1');
      });

      expect(mockSaveSession).toHaveBeenCalledTimes(1);
      // Verify the new order is passed to saveSession
      const savedEntries = mockSaveSession.mock.calls[0][0];
      expect(savedEntries[0].projects.map(p => p.id)).toEqual(['wp2', 'wp1']);
    });
  });
});
