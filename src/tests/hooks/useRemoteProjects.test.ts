import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRemoteProjects } from '../../hooks/useRemoteProjects';

// mock terminal functions
vi.mock('../../components/terminal', () => ({
  remoteCacheKey: (entryId: string, projectId: string) => `remote:${entryId}:${projectId}`,
  destroyRemoteCache: vi.fn(),
}));

describe('useRemoteProjects', () => {
  const mockSaveSession = vi.fn();

  beforeEach(() => {
    mockSaveSession.mockReset();
    mockSaveSession.mockResolvedValue(undefined);
  });

  it('初始状态为空', () => {
    const { result } = renderHook(() => useRemoteProjects(mockSaveSession));

    expect(result.current.remoteEntries).toEqual([]);
    expect(result.current.activeRemoteKey).toBeNull();
    expect(result.current.activeRemoteProject).toBeNull();
    expect(result.current.remoteDialogOpen).toBe(false);
    expect(result.current.pendingAuthEntry).toBeNull();
  });

  it('handleRemoteEntryAdd 添加新 entry', async () => {
    const { result } = renderHook(() => useRemoteProjects(mockSaveSession));

    const entry = {
      id: 'remote-1',
      host: '192.168.1.100',
      name: 'production',
      authMethod: 'password' as const,
      saved_auth: null,
      projects: [
        { id: 'rp1', name: 'app', path: '/opt/app' },
      ],
    };

    await act(async () => {
      await result.current.handleRemoteEntryAdd(entry, null);
    });

    expect(result.current.remoteEntries).toHaveLength(1);
    expect(result.current.remoteEntries[0].host).toBe('192.168.1.100');
    expect(mockSaveSession).toHaveBeenCalledWith(undefined, [entry]);
  });

  it('handleRemoteEntryAdd 更新已有 entry', async () => {
    const { result } = renderHook(() => useRemoteProjects(mockSaveSession));

    const entry = {
      id: 'remote-1',
      host: '192.168.1.100',
      name: 'prod',
      authMethod: 'password' as const,
      saved_auth: null,
      projects: [{ id: 'rp1', name: 'app', path: '/opt/app' }],
    };

    await act(async () => {
      await result.current.handleRemoteEntryAdd(entry, null);
    });

    const updated = {
      ...entry,
      projects: [
        ...entry.projects,
        { id: 'rp2', name: 'api', path: '/opt/api' },
      ],
    };

    await act(async () => {
      await result.current.handleRemoteEntryAdd(updated, null);
    });

    expect(result.current.remoteEntries).toHaveLength(1);
    expect(result.current.remoteEntries[0].projects).toHaveLength(2);
  });

  it('handleRemoteEntryAdd 保存 auth 到 store', async () => {
    const { result } = renderHook(() => useRemoteProjects(mockSaveSession));

    const entry = {
      id: 'remote-1',
      host: '192.168.1.100',
      name: 'prod',
      authMethod: 'password' as const,
      saved_auth: null,
      projects: [],
    };

    const auth = { password: 'secret' };

    await act(async () => {
      await result.current.handleRemoteEntryAdd(entry, auth as any);
    });

    expect(result.current.remoteAuthStore.has('remote-1')).toBe(true);
  });

  it('handleRemoteEntryAdd 有 saved_auth 时写入 entry', async () => {
    const { result } = renderHook(() => useRemoteProjects(mockSaveSession));

    const entry = {
      id: 'remote-1',
      host: '192.168.1.100',
      name: 'prod',
      authMethod: 'key' as const,
      saved_auth: null,
      projects: [],
    };

    await act(async () => {
      await result.current.handleRemoteEntryAdd(entry, null, 'encoded-auth');
    });

    expect(result.current.remoteEntries[0].saved_auth).toBe('encoded-auth');
  });

  it('handleCloseRemoteProject 关闭活跃项目', () => {
    const { result } = renderHook(() => useRemoteProjects(mockSaveSession));

    act(() => {
      result.current.setRemoteEntries([
        {
          id: 'e1',
          host: 'host1',
          name: 'prod',
          authMethod: 'password' as const,
          saved_auth: null,
          projects: [{ id: 'rp1', name: 'p1', path: '/opt/p1' }],
        },
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
    const { result } = renderHook(() => useRemoteProjects(mockSaveSession));

    act(() => {
      result.current.setRemoteEntries([
        {
          id: 'e1',
          host: 'host1',
          name: 'prod',
          authMethod: 'password' as const,
          saved_auth: null,
          projects: [
            { id: 'rp1', name: 'p1', path: '/opt/p1' },
            { id: 'rp2', name: 'p2', path: '/opt/p2' },
          ],
        },
      ]);
    });

    await act(async () => {
      await result.current.handleRemoveRemoteProject('e1', 'rp1');
    });

    expect(result.current.remoteEntries[0].projects).toHaveLength(1);
    expect(result.current.remoteEntries[0].projects[0].id).toBe('rp2');
  });

  it('handleRemoveRemoteEntry 移除整个 entry 并清理 auth', async () => {
    const { result } = renderHook(() => useRemoteProjects(mockSaveSession));

    const entry = {
      id: 'e1',
      host: 'host1',
      name: 'prod',
      authMethod: 'password' as const,
      saved_auth: null,
      projects: [{ id: 'rp1', name: 'p1', path: '/opt/p1' }],
    };

    await act(async () => {
      await result.current.handleRemoteEntryAdd(entry, { password: 'test' } as any);
    });

    await act(async () => {
      await result.current.handleRemoveRemoteEntry('e1');
    });

    expect(result.current.remoteEntries).toHaveLength(0);
    expect(result.current.remoteAuthStore.has('e1')).toBe(false);
  });

  it('handleAddRemoteProject 打开对话框', () => {
    const { result } = renderHook(() => useRemoteProjects(mockSaveSession));

    act(() => {
      result.current.handleAddRemoteProject('e1');
    });

    expect(result.current.remoteDialogOpen).toBe(true);
    expect(result.current.remoteAddToEntryId).toBe('e1');
  });

  it('handleRemoteDialogClose 关闭对话框', () => {
    const { result } = renderHook(() => useRemoteProjects(mockSaveSession));

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
    const { result } = renderHook(() => useRemoteProjects(mockSaveSession));

    // Base64 编码的 JSON auth
    const authData = { password: 'test123' };
    const encoded = btoa(JSON.stringify(authData));

    const entries = [
      {
        id: 'e1',
        host: 'host1',
        name: 'prod',
        authMethod: 'password' as const,
        saved_auth: encoded,
        projects: [],
      },
    ];

    act(() => {
      result.current.restoreAuthFromEntries(entries as any);
    });

    expect(result.current.remoteAuthStore.has('e1')).toBe(true);
  });

  it('restoreAuthFromEntries 忽略无效的 saved_auth', () => {
    const { result } = renderHook(() => useRemoteProjects(mockSaveSession));

    const entries = [
      {
        id: 'e1',
        host: 'host1',
        name: 'prod',
        authMethod: 'password' as const,
        saved_auth: 'invalid-base64!!!',
        projects: [],
      },
    ];

    act(() => {
      result.current.restoreAuthFromEntries(entries as any);
    });

    expect(result.current.remoteAuthStore.has('e1')).toBe(false);
  });

  it('pendingAuthEntry 在无 auth 时触发', () => {
    const { result } = renderHook(() => useRemoteProjects(mockSaveSession));

    act(() => {
      result.current.setRemoteEntries([
        {
          id: 'e1',
          host: 'host1',
          name: 'prod',
          authMethod: 'password' as const,
          saved_auth: null,
          projects: [{ id: 'rp1', name: 'p1', path: '/opt/p1' }],
        },
      ]);
    });

    act(() => {
      result.current.setActiveRemoteProject({
        entry: {
          id: 'e1',
          host: 'host1',
          name: 'prod',
          authMethod: 'password' as const,
          saved_auth: null,
          projects: [],
        },
        project: { id: 'rp1', name: 'p1', path: '/opt/p1' },
      } as any);
    });

    expect(result.current.pendingAuthEntry).not.toBeNull();
    expect(result.current.pendingAuthEntry?.id).toBe('e1');
  });
});
