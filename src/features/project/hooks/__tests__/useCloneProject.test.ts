import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { cloneGitProject, cancelProjectClone } from '../../api/projectApi';
import type { CloneProgress } from '../../types/clone';
import { useCloneProject } from '../useCloneProject';

const { cloneGitProjectMock, cancelProjectCloneMock } = vi.hoisted(() => ({
  cloneGitProjectMock: vi.fn(),
  cancelProjectCloneMock: vi.fn(),
}));

vi.mock('../../api/projectApi', () => ({
  cloneGitProject: cloneGitProjectMock,
  cancelProjectClone: cancelProjectCloneMock,
}));

// Capture the registered progress handler so tests can simulate backend events.
let progressHandler: ((p: CloneProgress) => void) | null = null;
vi.mock('@/shared/hooks/useTauriEvent', () => ({
  useTauriEvent: vi.fn((_event: string, handler: (p: CloneProgress) => void) => {
    progressHandler = handler;
  }),
}));

const LAST_DEST_KEY = 'neeko.clone.lastDestDir';

function fireProgress(payload: CloneProgress) {
  act(() => {
    progressHandler?.(payload);
  });
}

describe('useCloneProject', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    progressHandler = null;
    localStorage.clear();
  });

  it('prefills destParent from localStorage', () => {
    localStorage.setItem(LAST_DEST_KEY, '/Users/me/code');
    const { result } = renderHook(() => useCloneProject({ onSuccess: vi.fn() }));
    expect(result.current.destParent).toBe('/Users/me/code');
  });

  it('derives project name from URL until manually edited', () => {
    const { result } = renderHook(() => useCloneProject({ onSuccess: vi.fn() }));

    act(() => result.current.setUrl('https://github.com/owner/repo.git'));
    expect(result.current.name).toBe('repo');

    act(() => result.current.setName('my-name'));
    act(() => result.current.setUrl('https://github.com/owner/other.git'));
    expect(result.current.name).toBe('my-name');
  });

  it('rejects start with inline error when URL is invalid', () => {
    const { result } = renderHook(() => useCloneProject({ onSuccess: vi.fn() }));

    act(() => result.current.setUrl('not-a-url'));
    act(() => result.current.setDestParent('/tmp/code'));
    act(() => {
      void result.current.startClone();
    });

    expect(cloneGitProject).not.toHaveBeenCalled();
    expect(result.current.error).toBeTruthy();
    expect(result.current.status).toBe('idle');
  });

  it('rejects start when destParent is empty', () => {
    const { result } = renderHook(() => useCloneProject({ onSuccess: vi.fn() }));

    act(() => result.current.setUrl('https://github.com/owner/repo.git'));
    act(() => {
      void result.current.startClone();
    });

    expect(cloneGitProject).not.toHaveBeenCalled();
    expect(result.current.error).toBeTruthy();
  });

  it('startClone invokes API and calls onSuccess with the path', async () => {
    cloneGitProjectMock.mockResolvedValue({ path: '/tmp/code/repo' });
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useCloneProject({ onSuccess }));

    act(() => result.current.setUrl('https://github.com/owner/repo.git'));
    act(() => result.current.setDestParent('/tmp/code'));
    expect(result.current.name).toBe('repo');

    await act(async () => {
      await result.current.startClone();
    });

    expect(cloneGitProject).toHaveBeenCalledWith({
      url: 'https://github.com/owner/repo.git',
      destParent: '/tmp/code',
      name: 'repo',
    });
    expect(onSuccess).toHaveBeenCalledWith('/tmp/code/repo');
    expect(result.current.status).toBe('idle');
    expect(result.current.error).toBeNull();
  });

  it('keeps fields and sets error on failure', async () => {
    cloneGitProjectMock.mockRejectedValue(new Error('Repository not found'));
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useCloneProject({ onSuccess }));

    act(() => result.current.setUrl('https://github.com/owner/repo.git'));
    act(() => result.current.setDestParent('/tmp/code'));

    await act(async () => {
      await result.current.startClone();
    });

    expect(onSuccess).not.toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
    expect(result.current.error).toBe('Repository not found');
    expect(result.current.url).toBe('https://github.com/owner/repo.git');
    expect(result.current.destParent).toBe('/tmp/code');
  });

  it('treats backend cancel as neutral: back to idle without error banner', async () => {
    cloneGitProjectMock.mockRejectedValue(new Error('Clone cancelled'));
    const { result } = renderHook(() => useCloneProject({ onSuccess: vi.fn() }));

    act(() => result.current.setUrl('https://github.com/owner/repo.git'));
    act(() => result.current.setDestParent('/tmp/code'));

    await act(async () => {
      await result.current.startClone();
    });

    expect(result.current.status).toBe('idle');
    expect(result.current.error).toBeNull();
    expect(result.current.url).toBe('https://github.com/owner/repo.git');
  });

  it('cancel requests backend cancellation while cloning', async () => {
    cancelProjectCloneMock.mockResolvedValue(undefined);
    let resolveClone: (v: { path: string }) => void = () => {};
    cloneGitProjectMock.mockImplementation(
      () =>
        new Promise<{ path: string }>((resolve) => {
          resolveClone = resolve;
        }),
    );
    const { result } = renderHook(() => useCloneProject({ onSuccess: vi.fn() }));

    act(() => result.current.setUrl('https://github.com/owner/repo.git'));
    act(() => result.current.setDestParent('/tmp/code'));

    let clonePromise: Promise<void> = Promise.resolve();
    act(() => {
      clonePromise = result.current.startClone();
    });
    expect(result.current.status).toBe('cloning');
    expect(result.current.locked).toBe(true);

    await act(async () => {
      await result.current.cancel();
    });
    expect(cancelProjectClone).toHaveBeenCalled();

    act(() => {
      resolveClone({ path: '/tmp/code/repo' });
    });
    await act(async () => {
      await clonePromise;
    });
    expect(result.current.status).toBe('idle');
  });

  it('updates progress from backend events (no id filter — single clone slot)', async () => {
    cloneGitProjectMock.mockImplementation(
      () =>
        new Promise<{ path: string }>(() => {
          /* never resolves — simulates long clone */
        }),
    );
    const { result } = renderHook(() => useCloneProject({ onSuccess: vi.fn() }));

    act(() => result.current.setUrl('https://github.com/owner/repo.git'));
    act(() => result.current.setDestParent('/tmp/code'));
    act(() => {
      void result.current.startClone();
    });

    expect(result.current.progress).toBeNull();

    fireProgress({ clone_id: 'backend-uuid', phase: 'counting', percent: 12, message: '' });
    expect(result.current.progress?.percent).toBe(12);
    expect(result.current.progress?.phase).toBe('counting');

    fireProgress({
      clone_id: 'backend-uuid',
      phase: 'receiving',
      percent: 42,
      message: 'Receiving objects: 42%',
    });
    expect(result.current.progress?.percent).toBe(42);
    expect(result.current.progress?.phase).toBe('receiving');
  });

  it('pickDirectory stores selection in localStorage', async () => {
    const { open } = await import('@tauri-apps/plugin-dialog');
    vi.mocked(open).mockResolvedValue('/Users/me/projects');
    const { result } = renderHook(() => useCloneProject({ onSuccess: vi.fn() }));

    await act(async () => {
      await result.current.pickDirectory();
    });

    expect(result.current.destParent).toBe('/Users/me/projects');
    expect(localStorage.getItem(LAST_DEST_KEY)).toBe('/Users/me/projects');
  });

  it('awaits waitFor-compatible async clone flow', async () => {
    cloneGitProjectMock.mockResolvedValue({ path: '/tmp/code/repo' });
    const { result } = renderHook(() => useCloneProject({ onSuccess: vi.fn() }));
    act(() => result.current.setUrl('https://github.com/owner/repo.git'));
    act(() => result.current.setDestParent('/tmp/code'));
    await act(async () => {
      await result.current.startClone();
    });
    await waitFor(() => expect(result.current.status).toBe('idle'));
  });
});
