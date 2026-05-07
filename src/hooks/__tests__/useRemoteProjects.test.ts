import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRemoteProjects } from '../../hooks/useRemoteProjects';
import type { AuthMethod, RemoteEntrySession, RemoteProject } from '../../types';
import { useAppStore } from '../../store/appStore';

// mock terminal functions
vi.mock('../../components/terminal', () => ({
  remoteCacheKey: (entryId: string, projectId: string) => `remote:${entryId}:${projectId}`,
  destroyRemoteCachesByPrefix: vi.fn(),
}));

const makeRemoteProject = (overrides: {
  id: string;
  name: string;
  path: string;
  entry_id?: string;
}): RemoteProject => ({
  id: overrides.id,
  name: overrides.name,
  path: overrides.path,
  entry_id: overrides.entry_id ?? 'e1',
  selected_agent: null,
  selected_ide: null,
});

const makeRemoteEntry = (overrides: {
  id: string;
  host?: string;
  port?: number;
  username?: string;
  projects?: RemoteProject[];
  saved_auth?: string | null;
}): RemoteEntrySession => ({
  id: overrides.id,
  host: overrides.host ?? '192.168.1.100',
  port: overrides.port ?? 22,
  username: overrides.username ?? 'root',
  projects: overrides.projects ?? [],
  saved_auth: overrides.saved_auth,
});

describe('useRemoteProjects', () => {
  const mockSaveSession = vi.fn();
  const mockShowToast = vi.fn();

  const resetStore = () => {
    useAppStore.setState({
      projects: [],
      activeProjectId: null,
      activeProject: null,
      isTerminalView: false,
      wslEntries: [],
      activeWslKey: null,
      activeWslProject: null,
      remoteEntries: [],
      activeRemoteKey: null,
      activeRemoteProject: null,
      remoteAuthStore: new Map(),
      pendingAuthEntry: null,
      activeWorktreePath: null,
      openedWorktrees: [],
      wslOpenedWt: [],
      activeWslWorktreePath: null,
      remoteOpenedWt: [],
      activeRemoteWorktreePath: null,
      worktreeState: {},
      selectProject: vi.fn(),
      selectWslProject: vi.fn(),
      selectRemoteProject: vi.fn(),
      openIde: vi.fn(),
    });
  };

  beforeEach(() => {
    mockSaveSession.mockReset();
    mockShowToast.mockReset();
    mockSaveSession.mockResolvedValue(undefined);
    resetStore();
  });

  it('初始状态为空', () => {
    const { result } = renderHook(() => useRemoteProjects(mockSaveSession, mockShowToast));

    expect(result.current.remoteEntries).toEqual([]);
    expect(result.current.activeRemoteKey).toBeNull();
    expect(result.current.activeRemoteProject).toBeNull();
    expect(result.current.remoteDialogOpen).toBe(false);
    expect(result.current.pendingAuthEntry).toBeNull();
  });

  it('handleRemoteEntryAdd 添加新 entry', async () => {
    const { result } = renderHook(() => useRemoteProjects(mockSaveSession, mockShowToast));

    const entry = makeRemoteEntry({
      id: 'remote-1',
      host: '192.168.1.100',
      projects: [makeRemoteProject({ id: 'rp1', name: 'app', path: '/opt/app' })],
    });

    await act(async () => {
      await result.current.handleRemoteEntryAdd(entry, null);
    });

    expect(result.current.remoteEntries).toHaveLength(1);
    expect(result.current.remoteEntries[0].host).toBe('192.168.1.100');
    expect(mockSaveSession).toHaveBeenCalledWith(undefined, [entry]);
  });

  it('handleRemoteEntryAdd 更新已有 entry', async () => {
    const { result } = renderHook(() => useRemoteProjects(mockSaveSession, mockShowToast));

    const entry = makeRemoteEntry({
      id: 'remote-1',
      host: '192.168.1.100',
      projects: [makeRemoteProject({ id: 'rp1', name: 'app', path: '/opt/app' })],
    });

    await act(async () => {
      await result.current.handleRemoteEntryAdd(entry, null);
    });

    const updated: RemoteEntrySession = {
      ...entry,
      projects: [
        ...entry.projects,
        makeRemoteProject({ id: 'rp2', name: 'api', path: '/opt/api' }),
      ],
    };

    await act(async () => {
      await result.current.handleRemoteEntryAdd(updated, null);
    });

    expect(result.current.remoteEntries).toHaveLength(1);
    expect(result.current.remoteEntries[0].projects).toHaveLength(2);
  });

  it('handleRemoteEntryAdd 保存 auth 到 store', async () => {
    const { result } = renderHook(() => useRemoteProjects(mockSaveSession, mockShowToast));

    const entry = makeRemoteEntry({ id: 'remote-1' });

    const auth: AuthMethod = { Password: 'secret' };

    await act(async () => {
      await result.current.handleRemoteEntryAdd(entry, auth);
    });

    expect(result.current.remoteAuthStore.has('remote-1')).toBe(true);
  });

  it('handleRemoteEntryAdd 有 saved_auth 时写入 entry', async () => {
    const { result } = renderHook(() => useRemoteProjects(mockSaveSession, mockShowToast));

    const entry = makeRemoteEntry({ id: 'remote-1' });

    await act(async () => {
      await result.current.handleRemoteEntryAdd(entry, null, 'encoded-auth');
    });

    expect(result.current.remoteEntries[0].saved_auth).toBe('encoded-auth');
  });

  it('handleCloseRemoteProject 关闭活跃项目', () => {
    const { result } = renderHook(() => useRemoteProjects(mockSaveSession, mockShowToast));

    act(() => {
      result.current.setRemoteEntries([
        makeRemoteEntry({
          id: 'e1',
          host: 'host1',
          projects: [makeRemoteProject({ id: 'rp1', name: 'p1', path: '/opt/p1' })],
        }),
      ]);
    });

    act(() => {
      result.current.setActiveRemoteKey({ host: 'host1', projectId: 'rp1' });
    });

    act(() => {
      result.current.setRemoteOpenSessions(new Set(['rp1']));
    });

    act(() => {
      result.current.handleCloseRemoteProject('e1', 'rp1');
    });

    expect(result.current.activeRemoteKey).toBeNull();
    expect(result.current.activeRemoteProject).toBeNull();
    expect(result.current.remoteOpenSessions.has('rp1')).toBe(false);
  });

  it('handleRemoveRemoteProject 从 entry 中移除项目', async () => {
    const { result } = renderHook(() => useRemoteProjects(mockSaveSession, mockShowToast));

    act(() => {
      result.current.setRemoteEntries([
        makeRemoteEntry({
          id: 'e1',
          host: 'host1',
          projects: [
            makeRemoteProject({ id: 'rp1', name: 'p1', path: '/opt/p1' }),
            makeRemoteProject({ id: 'rp2', name: 'p2', path: '/opt/p2' }),
          ],
        }),
      ]);
    });

    await act(async () => {
      await result.current.handleRemoveRemoteProject('e1', 'rp1');
    });

    expect(result.current.remoteEntries[0].projects).toHaveLength(1);
    expect(result.current.remoteEntries[0].projects[0].id).toBe('rp2');
  });

  it('handleRemoveRemoteEntry 移除整个 entry 并清理 auth', async () => {
    const { result } = renderHook(() => useRemoteProjects(mockSaveSession, mockShowToast));

    const entry = makeRemoteEntry({
      id: 'e1',
      host: 'host1',
      projects: [makeRemoteProject({ id: 'rp1', name: 'p1', path: '/opt/p1' })],
    });

    await act(async () => {
      await result.current.handleRemoteEntryAdd(entry, { Password: 'test' });
    });

    await act(async () => {
      await result.current.handleRemoveRemoteEntry('e1');
    });

    expect(result.current.remoteEntries).toHaveLength(0);
    expect(result.current.remoteAuthStore.has('e1')).toBe(false);
  });

  it('handleAddRemoteProject 打开对话框', () => {
    const { result } = renderHook(() => useRemoteProjects(mockSaveSession, mockShowToast));

    act(() => {
      result.current.handleAddRemoteProject('e1');
    });

    expect(result.current.remoteDialogOpen).toBe(true);
    expect(result.current.remoteAddToEntryId).toBe('e1');
  });

  it('handleRemoteDialogClose 关闭对话框', () => {
    const { result } = renderHook(() => useRemoteProjects(mockSaveSession, mockShowToast));

    act(() => {
      result.current.handleAddRemoteProject('e1');
    });

    act(() => {
      result.current.handleRemoteDialogClose();
    });

    expect(result.current.remoteDialogOpen).toBe(false);
    expect(result.current.remoteAddToEntryId).toBeNull();
  });

  it('restoreAuthFromEntries 从 saved_auth 恢复 auth', () => {
    const { result } = renderHook(() => useRemoteProjects(mockSaveSession, mockShowToast));

    const authData = { Password: 'test123' };
    const encoded = btoa(JSON.stringify(authData));

    const entries = [
      makeRemoteEntry({ id: 'e1', host: 'host1', saved_auth: encoded }),
    ];

    act(() => {
      result.current.restoreAuthFromEntries(entries);
    });

    expect(result.current.remoteAuthStore.has('e1')).toBe(true);
  });

  it('restoreAuthFromEntries 忽略无效的 saved_auth', () => {
    const { result } = renderHook(() => useRemoteProjects(mockSaveSession, mockShowToast));

    const entries = [
      makeRemoteEntry({ id: 'e1', host: 'host1', saved_auth: 'invalid-base64!!!' }),
    ];

    act(() => {
      result.current.restoreAuthFromEntries(entries);
    });

    expect(result.current.remoteAuthStore.has('e1')).toBe(false);
  });

  it('pendingAuthEntry 在无 auth 时触发', () => {
    const { result } = renderHook(() => useRemoteProjects(mockSaveSession, mockShowToast));

    act(() => {
      result.current.setRemoteEntries([
        makeRemoteEntry({
          id: 'e1',
          host: 'host1',
          projects: [makeRemoteProject({ id: 'rp1', name: 'p1', path: '/opt/p1' })],
        }),
      ]);
    });

    act(() => {
      result.current.setActiveRemoteProject({
        entry: makeRemoteEntry({ id: 'e1', host: 'host1' }),
        project: makeRemoteProject({ id: 'rp1', name: 'p1', path: '/opt/p1' }),
      });
    });

    expect(result.current.pendingAuthEntry).not.toBeNull();
    expect(result.current.pendingAuthEntry?.id).toBe('e1');
  });

  describe('handleRemoteDragEnd', () => {
    it('同一 entry 内正常排序', async () => {
      const { result } = renderHook(() => useRemoteProjects(mockSaveSession, mockShowToast));

      act(() => {
        result.current.setRemoteEntries([
          makeRemoteEntry({
            id: 'e1',
            host: 'host1',
            projects: [
              makeRemoteProject({ id: 'rp1', name: 'p1', path: '/opt/p1' }),
              makeRemoteProject({ id: 'rp2', name: 'p2', path: '/opt/p2' }),
              makeRemoteProject({ id: 'rp3', name: 'p3', path: '/opt/p3' }),
            ],
          }),
        ]);
      });

      await act(async () => {
        result.current.handleRemoteDragEnd('e1', 'rp1', 'rp3');
      });

      expect(result.current.remoteEntries[0].projects.map(p => p.id)).toEqual(['rp2', 'rp3', 'rp1']);
      expect(mockSaveSession).toHaveBeenCalled();
    });

    it('拖拽到相同位置不做任何操作', async () => {
      const { result } = renderHook(() => useRemoteProjects(mockSaveSession, mockShowToast));

      act(() => {
        result.current.setRemoteEntries([
          makeRemoteEntry({
            id: 'e1',
            host: 'host1',
            projects: [
              makeRemoteProject({ id: 'rp1', name: 'p1', path: '/opt/p1' }),
              makeRemoteProject({ id: 'rp2', name: 'p2', path: '/opt/p2' }),
            ],
          }),
        ]);
      });

      mockSaveSession.mockClear();

      await act(async () => {
        result.current.handleRemoteDragEnd('e1', 'rp1', 'rp1');
      });

      expect(result.current.remoteEntries[0].projects.map(p => p.id)).toEqual(['rp1', 'rp2']);
      expect(mockSaveSession).not.toHaveBeenCalled();
    });

    it('跨 entry 拖拽被忽略', async () => {
      const { result } = renderHook(() => useRemoteProjects(mockSaveSession, mockShowToast));

      act(() => {
        result.current.setRemoteEntries([
          makeRemoteEntry({
            id: 'e1',
            host: 'host1',
            projects: [
              makeRemoteProject({ id: 'rp1', name: 'p1', path: '/opt/p1' }),
            ],
          }),
          makeRemoteEntry({
            id: 'e2',
            host: 'host2',
            projects: [
              makeRemoteProject({ id: 'rp2', name: 'p2', path: '/opt/p2' }),
            ],
          }),
        ]);
      });

      // Drag rp1 into e2 — should be a no-op since rp1 isn't in e2
      await act(async () => {
        result.current.handleRemoteDragEnd('e2', 'rp1', 'rp2');
      });

      // rp1 still in e1, rp2 still in e2
      expect(result.current.remoteEntries[0].projects[0].id).toBe('rp1');
      expect(result.current.remoteEntries[1].projects[0].id).toBe('rp2');
    });

    it('排序后调用 saveSession 持久化', async () => {
      const { result } = renderHook(() => useRemoteProjects(mockSaveSession, mockShowToast));

      act(() => {
        result.current.setRemoteEntries([
          makeRemoteEntry({
            id: 'e1',
            host: 'host1',
            projects: [
              makeRemoteProject({ id: 'rp1', name: 'p1', path: '/opt/p1' }),
              makeRemoteProject({ id: 'rp2', name: 'p2', path: '/opt/p2' }),
            ],
          }),
        ]);
      });

      mockSaveSession.mockClear();

      await act(async () => {
        result.current.handleRemoteDragEnd('e1', 'rp2', 'rp1');
      });

      expect(mockSaveSession).toHaveBeenCalledTimes(1);
      // Verify the new order is passed to saveSession(undefined, newEntries)
      const savedEntries = mockSaveSession.mock.calls[0][1];
      expect(savedEntries[0].projects.map(p => p.id)).toEqual(['rp2', 'rp1']);
    });
  });
});
