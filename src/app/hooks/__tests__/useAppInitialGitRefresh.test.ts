import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useAppInitialGitRefresh } from '../useAppInitialGitRefresh';

describe('useAppInitialGitRefresh', () => {
  it('refreshes git once for wsl and authed remote projects when ready', () => {
    const wslRefresh = vi.fn();
    const remoteRefresh = vi.fn();
    const { rerender } = renderHook(
      ({ initializing, wslEntries }) =>
        useAppInitialGitRefresh({
          initializing,
          wslEntries,
          remoteEntries: [{ id: 'r1', projects: [{ id: 'p2', git_info: undefined }] }],
          remoteAuthStore: { has: () => true },
          wslActionsWrap: { handleRefreshGit: wslRefresh },
          remoteActionsWrap: { handleRefreshGit: remoteRefresh },
        }),
      {
        initialProps: {
          initializing: true,
          wslEntries: [{ distro: 'Ubuntu', projects: [{ id: 'p1', git_info: undefined }] }],
        },
      },
    );

    expect(wslRefresh).not.toHaveBeenCalled();
    rerender({
      initializing: false,
      wslEntries: [{ distro: 'Ubuntu', projects: [{ id: 'p1', git_info: undefined }] }],
    });
    expect(wslRefresh).toHaveBeenCalledWith('Ubuntu', 'p1');
    expect(remoteRefresh).toHaveBeenCalledWith('r1', 'p2');
  });

  it('does not re-run after completion even when deps change (ref guard)', () => {
    const wslRefresh = vi.fn();
    const { rerender } = renderHook(
      ({ wslEntries }) =>
        useAppInitialGitRefresh({
          initializing: false,
          wslEntries,
          remoteEntries: [],
          remoteAuthStore: { has: () => true },
          wslActionsWrap: { handleRefreshGit: wslRefresh },
          remoteActionsWrap: { handleRefreshGit: vi.fn() },
        }),
      {
        initialProps: {
          wslEntries: [{ distro: 'Ubuntu', projects: [{ id: 'p1', git_info: undefined }] }],
        },
      },
    );
    expect(wslRefresh).toHaveBeenCalledTimes(1);

    wslRefresh.mockClear();
    rerender({
      wslEntries: [{ distro: 'Ubuntu', projects: [{ id: 'p2', git_info: undefined }] }],
    });
    expect(wslRefresh).not.toHaveBeenCalled();
  });

  it('skips remote entries without auth', () => {
    const remoteRefresh = vi.fn();
    renderHook(() =>
      useAppInitialGitRefresh({
        initializing: false,
        wslEntries: [],
        remoteEntries: [{ id: 'r1', projects: [{ id: 'p2', git_info: undefined }] }],
        remoteAuthStore: { has: () => false },
        wslActionsWrap: { handleRefreshGit: vi.fn() },
        remoteActionsWrap: { handleRefreshGit: remoteRefresh },
      }),
    );
    expect(remoteRefresh).not.toHaveBeenCalled();
  });

  it('skips projects that already have git_info', () => {
    const wslRefresh = vi.fn();
    renderHook(() =>
      useAppInitialGitRefresh({
        initializing: false,
        wslEntries: [{ distro: 'Ubuntu', projects: [{ id: 'p1', git_info: {} }] }],
        remoteEntries: [],
        remoteAuthStore: { has: () => true },
        wslActionsWrap: { handleRefreshGit: wslRefresh },
        remoteActionsWrap: { handleRefreshGit: vi.fn() },
      }),
    );
    expect(wslRefresh).not.toHaveBeenCalled();
  });
});
