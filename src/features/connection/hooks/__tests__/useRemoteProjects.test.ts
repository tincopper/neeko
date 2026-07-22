import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRemoteProjects } from '@/features/connection/hooks/useRemoteProjects';
import type { RemoteEntrySession, AuthMethod } from '@/shared/types';
import { useProjectStore } from '@/features/project/store';
import { useConnectionStore } from '@/features/connection/store';
import { useWorktreeStore } from '@/features/project/worktreeStore';

vi.mock('@/features/terminal/components/terminalCache', () => ({
  remoteCacheKey: (entryId: string, projectId: string) => `remote:${entryId}:${projectId}`,
  destroyRemoteCachesByPrefix: vi.fn(),
  destroyWslCachesByPrefix: vi.fn(),
  wslCacheKey: vi.fn(),
}));

function makeRemoteProject(id = 'rp1') {
  return {
    id,
    name: `proj-${id}`,
    path: `/home/user/${id}`,
    entry_id: 'entry-1',
    selected_agents: [] as string[],
    selected_ide: null as string | null,
    git_info: null as any,
    avatar_color: null as string | null,
  };
}

function makeRemoteEntry(overrides: Partial<RemoteEntrySession> = {}): RemoteEntrySession {
  return {
    id: 'entry-1',
    host: '192.168.1.1',
    port: 22,
    username: 'user',
    projects: [makeRemoteProject('rp1'), makeRemoteProject('rp2')],
    saved_auth: null,
    ...overrides,
  };
}

describe('useRemoteProjects', () => {
  const mockSaveSession = vi.fn().mockResolvedValue(undefined);
  const mockShowToast = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useProjectStore.setState({ activeProjectId: null, activeProject: null });
    useConnectionStore.setState({
      remoteEntries: [],
      wslEntries: [],
      remoteAuthStore: new Map(),
      pendingAuthEntry: null,
    });
    useWorktreeStore.setState({
      activeWorktreePath: null,
      openedWorktrees: [],
      worktreeStateMap: {},
    });
  });

  // The old wrapper useRemoteProjects now calls new useConnectionProjects which
  // returns unified property names: entries, setEntries, handleEntryAdd, etc.
  // Auth-related fields (remoteAuthStore, etc.) are still included for Remote.

  it('初始状态为空', () => {
    const { result } = renderHook(() => useRemoteProjects(mockSaveSession, mockShowToast));

    expect(result.current.entries).toEqual([]);
    expect(result.current.dialogOpen).toBe(false);
    expect(result.current.pendingAuthEntry).toBeNull();
  });

  it('handleEntryAdd 添加新 entry', async () => {
    const { result } = renderHook(() => useRemoteProjects(mockSaveSession, mockShowToast));
    const entry = makeRemoteEntry({ id: 'new-entry' });

    await act(async () => {
      await result.current.handleEntryAdd(entry, null);
    });

    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0].id).toBe('new-entry');
    expect(mockSaveSession).toHaveBeenCalled();
  });

  it('handleEntryAdd 更新已有 entry', async () => {
    const { result } = renderHook(() => useRemoteProjects(mockSaveSession, mockShowToast));
    const entry = makeRemoteEntry({ id: 'entry-1', host: '10.0.0.1' });

    await act(async () => {
      await result.current.handleEntryAdd(entry, null);
    });

    // Update
    const updated = { ...entry, host: '10.0.0.2' };
    await act(async () => {
      await result.current.handleEntryAdd(updated, null);
    });

    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0].host).toBe('10.0.0.2');
  });

  it('handleEntryAdd 保存 auth 到 store', async () => {
    const { result } = renderHook(() => useRemoteProjects(mockSaveSession, mockShowToast));
    const entry = makeRemoteEntry({ id: 'new-entry' });
    const auth: AuthMethod = { Password: 'secret' };

    await act(async () => {
      await result.current.handleEntryAdd(entry, auth);
    });

    expect(result.current.remoteAuthStore.get('new-entry')).toEqual(auth);
  });

  it('handleEntryAdd 有 saved_auth 时写入 entry', async () => {
    const { result } = renderHook(() => useRemoteProjects(mockSaveSession, mockShowToast));
    const entry = makeRemoteEntry({ id: 'new-entry' });

    await act(async () => {
      await result.current.handleEntryAdd(entry, null, 'encoded-auth');
    });

    expect(result.current.entries[0].saved_auth).toBe('encoded-auth');
  });

  it('handleCloseProject 关闭活跃项目', () => {
    useProjectStore.setState({
      activeProjectId: 'rp1',
      activeProject: { id: 'rp1' } as any,
    });

    const { result } = renderHook(() => useRemoteProjects(mockSaveSession, mockShowToast));

    act(() => {
      result.current.setEntries([makeRemoteEntry()]);
    });

    act(() => {
      result.current.handleCloseProject('entry-1', 'rp1');
    });

    const state = useProjectStore.getState();
    expect(state.activeProjectId).toBeNull();
  });

  it('handleRemoveProject 从 entry 中移除项目', async () => {
    const { result } = renderHook(() => useRemoteProjects(mockSaveSession, mockShowToast));
    const entry = makeRemoteEntry();

    act(() => {
      result.current.setEntries([entry]);
    });

    await act(async () => {
      await result.current.handleRemoveProject('entry-1', 'rp1');
    });

    expect(result.current.entries[0].projects).toHaveLength(1);
    expect(result.current.entries[0].projects.find((p: any) => p.id === 'rp1')).toBeUndefined();
  });

  it('handleRemoveEntry 移除整个 entry 并清理 auth', async () => {
    const { result } = renderHook(() => useRemoteProjects(mockSaveSession, mockShowToast));
    const auth: AuthMethod = { Password: 'secret' };
    const entry = makeRemoteEntry({ id: 'entry-1' });

    // First add with auth
    await act(async () => {
      await result.current.handleEntryAdd(entry, auth);
    });

    // Now remove
    await act(async () => {
      await result.current.handleRemoveEntry('entry-1');
    });

    expect(result.current.entries).toHaveLength(0);
    expect(result.current.remoteAuthStore.has('entry-1')).toBe(false);
  });

  it('handleAddProject 打开对话框', () => {
    const { result } = renderHook(() => useRemoteProjects(mockSaveSession, mockShowToast));

    act(() => {
      result.current.handleAddProject('entry-1');
    });

    expect(result.current.dialogOpen).toBe(true);
    expect(result.current.addToEntryId).toBe('entry-1');
  });

  it('handleDialogClose 关闭对话框', () => {
    const { result } = renderHook(() => useRemoteProjects(mockSaveSession, mockShowToast));

    act(() => {
      result.current.handleAddProject('entry-1');
    });
    act(() => {
      result.current.handleDialogClose();
    });

    expect(result.current.dialogOpen).toBe(false);
    expect(result.current.addToEntryId).toBeNull();
  });

  it('pendingAuthEntry 在无 auth 时触发', () => {
    const host = '192.168.1.1';
    useProjectStore.setState({
      activeProjectId: 'rp1',
      activeProject: {
        id: 'rp1',
        environment: { type: 'Remote', host, port: 22, username: 'user', auth: { Password: 'x' } },
      } as any,
    });

    const { result } = renderHook(() => useRemoteProjects(mockSaveSession, mockShowToast));

    act(() => {
      result.current.setEntries([makeRemoteEntry()]);
    });

    expect(result.current.pendingAuthEntry).toBeTruthy();
    expect(result.current.pendingAuthEntry?.host).toBe(host);
  });

  describe('handleDragEnd', () => {
    function createSortableEntry() {
      return makeRemoteEntry({
        id: 'e1',
        projects: [
          makeRemoteProject('p1'),
          makeRemoteProject('p2'),
          makeRemoteProject('p3'),
        ],
      });
    }

    it('同一 entry 内正常排序', () => {
      const { result } = renderHook(() => useRemoteProjects(mockSaveSession, mockShowToast));

      act(() => {
        result.current.setEntries([createSortableEntry()]);
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
      const { result } = renderHook(() => useRemoteProjects(mockSaveSession, mockShowToast));

      act(() => {
        result.current.setEntries([createSortableEntry()]);
      });
      act(() => {
        result.current.handleDragEnd('e1', 'p1', 'p1');
      });

      expect(result.current.entries[0].projects).toHaveLength(3);
    });

    it('跨 entry 拖拽被忽略', () => {
      const { result } = renderHook(() => useRemoteProjects(mockSaveSession, mockShowToast));

      act(() => {
        result.current.setEntries([
          makeRemoteEntry({ id: 'e1', projects: [makeRemoteProject('p1')] }),
          makeRemoteEntry({ id: 'e2', projects: [makeRemoteProject('p2')] }),
        ]);
      });
      act(() => {
        result.current.handleDragEnd('e1', 'p1', 'e2');
      });

      expect(result.current.entries[0].projects).toHaveLength(1);
    });

    it('排序后调用 saveSession 持久化', () => {
      const { result } = renderHook(() => useRemoteProjects(mockSaveSession, mockShowToast));

      act(() => {
        result.current.setEntries([createSortableEntry()]);
      });
      act(() => {
        result.current.handleDragEnd('e1', 'p1', 'p3');
      });

      expect(mockSaveSession).toHaveBeenCalledTimes(1);
    });
  });

  describe('restoreAuthFromEntries', () => {
    it('从 saved_auth 恢复 remoteAuthStore', () => {
      // Encode the auth JSON to base64 (matching the production code using btoa/atob)
      const authPayload: AuthMethod = { Password: 'restored-pwd' };
      const encoded = btoa(JSON.stringify(authPayload));

      const { result } = renderHook(() => useRemoteProjects(mockSaveSession, mockShowToast));

      const entry = makeRemoteEntry({ id: 'restored-entry', saved_auth: encoded });
      result.current.restoreAuthFromEntries([entry]);

      const restored = useConnectionStore.getState().remoteAuthStore.get('restored-entry');
      expect(restored).toEqual(authPayload);
    });
  });
});
