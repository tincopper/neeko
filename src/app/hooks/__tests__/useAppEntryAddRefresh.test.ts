import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { AuthMethod, RemoteEntrySession, WSLEntrySession } from '@/shared/types';

import { useAppEntryAddRefresh } from '../useAppEntryAddRefresh';

function makeWslEntry(projectId = 'p1', withGitInfo = true): WSLEntrySession {
  return {
    id: 'wsl-1',
    distro: 'Ubuntu',
    projects: [{ id: projectId, git_info: withGitInfo ? ({} as never) : undefined }],
  } as unknown as WSLEntrySession;
}

function makeRemoteEntry(
  entryId = 'r1',
  projectId = 'p2',
  withGitInfo = false,
): RemoteEntrySession {
  return {
    id: entryId,
    host: 'host',
    port: 22,
    username: 'user',
    projects: [{ id: projectId, git_info: withGitInfo ? ({} as never) : undefined }],
  } as unknown as RemoteEntrySession;
}

describe('useAppEntryAddRefresh', () => {
  it('refreshes git for wsl projects missing git_info after add', async () => {
    const handleWSLEntryAdd = vi.fn().mockResolvedValue(undefined);
    const handleRefreshGit = vi.fn();
    const { result } = renderHook(() =>
      useAppEntryAddRefresh({
        handleWSLEntryAdd,
        wslActionsWrap: { handleRefreshGit },
        handleRemoteEntryAdd: vi.fn(),
        remoteAuthStore: { has: () => true },
        remoteActionsWrap: { handleRefreshGit: vi.fn() },
      }),
    );

    await act(async () => {
      await result.current.handleWslEntryAddRefresh(makeWslEntry('p1', false));
    });
    expect(handleWSLEntryAdd).toHaveBeenCalledTimes(1);
    expect(handleRefreshGit).toHaveBeenCalledWith('Ubuntu', 'p1');
  });

  it('skips wsl git refresh when project already has git_info', async () => {
    const handleRefreshGit = vi.fn();
    const { result } = renderHook(() =>
      useAppEntryAddRefresh({
        handleWSLEntryAdd: vi.fn().mockResolvedValue(undefined),
        wslActionsWrap: { handleRefreshGit },
        handleRemoteEntryAdd: vi.fn(),
        remoteAuthStore: { has: () => true },
        remoteActionsWrap: { handleRefreshGit: vi.fn() },
      }),
    );

    await act(async () => {
      await result.current.handleWslEntryAddRefresh(makeWslEntry('p1', true));
    });
    expect(handleRefreshGit).not.toHaveBeenCalled();
  });

  it('refreshes remote git only when auth is present', async () => {
    const handleRemoteEntryAdd = vi.fn().mockResolvedValue(undefined);
    const remoteRefreshGit = vi.fn();
    const remoteAuthStore = { has: vi.fn((id: string) => id === 'r1') };
    const { result } = renderHook(() =>
      useAppEntryAddRefresh({
        handleWSLEntryAdd: vi.fn(),
        wslActionsWrap: { handleRefreshGit: vi.fn() },
        handleRemoteEntryAdd,
        remoteAuthStore: remoteAuthStore as { has: (id: string) => boolean },
        remoteActionsWrap: { handleRefreshGit: remoteRefreshGit },
      }),
    );

    await act(async () => {
      await result.current.handleRemoteEntryAddRefresh(makeRemoteEntry('r1', 'p2', false), null);
    });
    expect(handleRemoteEntryAdd).toHaveBeenCalledTimes(1);
    expect(remoteRefreshGit).toHaveBeenCalledWith('r1', 'p2');

    remoteRefreshGit.mockClear();
    await act(async () => {
      await result.current.handleRemoteEntryAddRefresh(makeRemoteEntry('r2', 'p3', false), null);
    });
    expect(remoteRefreshGit).not.toHaveBeenCalled();
  });

  it('passes explicit auth to remote refresh even without store auth', async () => {
    const remoteRefreshGit = vi.fn();
    const { result } = renderHook(() =>
      useAppEntryAddRefresh({
        handleWSLEntryAdd: vi.fn(),
        wslActionsWrap: { handleRefreshGit: vi.fn() },
        handleRemoteEntryAdd: vi.fn().mockResolvedValue(undefined),
        remoteAuthStore: { has: () => false },
        remoteActionsWrap: { handleRefreshGit: remoteRefreshGit },
      }),
    );

    const auth: AuthMethod = { type: 'password', secret: 'x' };
    await act(async () => {
      await result.current.handleRemoteEntryAddRefresh(makeRemoteEntry('r1', 'p2', false), auth);
    });
    expect(remoteRefreshGit).toHaveBeenCalledWith('r1', 'p2');
  });
});
