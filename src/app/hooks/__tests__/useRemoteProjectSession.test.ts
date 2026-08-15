import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useConnectionStore } from '@/shared/store/connectionStore';
import { useProjectStore } from '@/shared/store/projectStore';
import type { AuthMethod, Project } from '@/shared/types';

import { useRemoteProjectSession } from '../useRemoteProjectSession';

function makeRemoteProject(id = 'p1', host = 'h1'): Project {
  return {
    id,
    name: 'P',
    path: '/p',
    environment: { type: 'Remote', host, port: 22, username: 'u', auth: { type: 'password' } },
  } as unknown as Project;
}

function makeParams(overrides: Partial<Parameters<typeof useRemoteProjectSession>[0]> = {}) {
  return {
    activeProject: null,
    remoteAuthStore: new Map<string, AuthMethod>(),
    activeRemoteWorktreePath: null,
    setRemoteOpenSessions: vi.fn(),
    setPendingAuthEntry: vi.fn(),
    ...overrides,
  };
}

describe('useRemoteProjectSession', () => {
  beforeEach(() => {
    useConnectionStore.setState({ remoteEntries: [] });
    useProjectStore.setState({ activeProject: null });
  });

  it('returns no remote prop for a non-remote project', () => {
    const activeProject = { id: 'p1', environment: { type: 'Local' } } as unknown as Project;
    const { result } = renderHook(() => useRemoteProjectSession(makeParams({ activeProject })));
    expect(result.current.remoteProjectProp).toBeNull();
    expect(result.current.needsRemoteAuth).toBe(false);
  });

  it('flags needsRemoteAuth when the remote entry lacks credentials', () => {
    useConnectionStore.setState({
      remoteEntries: [{ id: 'r1', host: 'h1', port: 22, username: 'u' }] as never,
    });
    const { result } = renderHook(() =>
      useRemoteProjectSession(makeParams({ activeProject: makeRemoteProject() })),
    );
    expect(result.current.needsRemoteAuth).toBe(true);
    expect(result.current.remoteProjectProp).toBeNull();
  });

  it('builds remoteProjectProp when credentials exist', () => {
    useConnectionStore.setState({
      remoteEntries: [{ id: 'r1', host: 'h1', port: 22, username: 'u' }] as never,
    });
    const auth: AuthMethod = { type: 'password', secret: 's' };
    const { result } = renderHook(() =>
      useRemoteProjectSession(
        makeParams({
          activeProject: makeRemoteProject(),
          remoteAuthStore: new Map([['r1', auth]]),
        }),
      ),
    );
    expect(result.current.needsRemoteAuth).toBe(false);
    expect(result.current.remoteProjectProp).toMatchObject({
      entryId: 'r1',
      projectId: 'p1',
      projectName: 'P',
      host: 'h1',
      port: 22,
      username: 'u',
      auth,
    });
  });

  it('handleEnterCredentials opens pending auth for the matching entry', () => {
    useConnectionStore.setState({
      remoteEntries: [{ id: 'r1', host: 'h1', port: 22, username: 'u' }] as never,
    });
    useProjectStore.setState({ activeProject: makeRemoteProject() });
    const setPendingAuthEntry = vi.fn();
    const { result } = renderHook(() =>
      useRemoteProjectSession(makeParams({ setPendingAuthEntry })),
    );
    act(() => result.current.handleEnterCredentials());
    expect(setPendingAuthEntry).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1' }));
  });

  it('onRemoteSessionReady adds the pid to open sessions', () => {
    const setRemoteOpenSessions = vi.fn((updater) => updater(new Set(['a'])));
    const { result } = renderHook(() =>
      useRemoteProjectSession(makeParams({ setRemoteOpenSessions })),
    );
    act(() => result.current.onRemoteSessionReady('pid-9'));
    expect(setRemoteOpenSessions).toHaveBeenCalled();
    const updater = setRemoteOpenSessions.mock.calls[0][0];
    expect([...updater(new Set(['a']))]).toEqual(['a', 'pid-9']);
  });
});
