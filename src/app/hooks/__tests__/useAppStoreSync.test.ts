import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useProjectStore } from '@/shared/store/projectStore';

import { useAppStoreSync } from '../useAppStoreSync';

function makeParams(overrides: Partial<Parameters<typeof useAppStoreSync>[0]> = {}) {
  return {
    isTerminalView: false,
    activeWorktreePath: null,
    selectProject: vi.fn(),
    handleOpenIdeCallback: vi.fn(),
    handleSetProjectIde: vi.fn(),
    ...overrides,
  };
}

describe('useAppStoreSync', () => {
  it('writes view state and action refs into projectStore', () => {
    const selectProject = vi.fn();
    const handleOpenIdeCallback = vi.fn();
    const handleSetProjectIde = vi.fn();
    renderHook(() =>
      useAppStoreSync(makeParams({ selectProject, handleOpenIdeCallback, handleSetProjectIde })),
    );

    const s = useProjectStore.getState();
    expect(s.isTerminalView).toBe(false);
    expect(s.selectProject).toBe(selectProject);
    expect(s.openIde).toBe(handleOpenIdeCallback);
    expect(s.setProjectIde).toBe(handleSetProjectIde);
  });

  it('marks terminal view when a worktree path is active', () => {
    renderHook(() => useAppStoreSync(makeParams({ activeWorktreePath: '/repo/.git/wt' })));
    expect(useProjectStore.getState().isTerminalView).toBe(true);
  });

  it('refreshes store when deps change', () => {
    const { rerender } = renderHook(
      ({ isTerminalView }) => useAppStoreSync(makeParams({ isTerminalView })),
      {
        initialProps: { isTerminalView: false },
      },
    );
    expect(useProjectStore.getState().isTerminalView).toBe(false);
    rerender({ isTerminalView: true });
    expect(useProjectStore.getState().isTerminalView).toBe(true);
  });
});
