import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { CommitFileChange } from '@/shared/types';

import { useGitHistoryDiffActions } from '../useGitHistoryDiffActions';

function makeFiles(): CommitFileChange[] {
  return [
    { path: 'a.ts', status: 'M', additions: 1, deletions: 0 },
    { path: 'b.ts', status: 'A', additions: 2, deletions: 0 },
  ];
}

function setup(overrides?: Partial<Parameters<typeof useGitHistoryDiffActions>[0]>) {
  const openFileInDiff = vi.fn();
  const openCombined = vi.fn();
  const pinFile = vi.fn();
  const scrollToFile = vi.fn();
  const refreshOpenDiff = vi.fn();
  const hasSingleton = vi.fn().mockReturnValue(false);
  const setCombined = vi.fn();
  const setCurrentFileIdx = vi.fn();

  const { result } = renderHook(() =>
    useGitHistoryDiffActions({
      selectedHash: 'abc123',
      files: makeFiles(),
      combined: true,
      currentFileIdx: 0,
      openFileInDiff,
      openCombined,
      pinFile,
      scrollToFile,
      refreshOpenDiff,
      hasSingleton,
      setCombined,
      setCurrentFileIdx,
      ...overrides,
    }),
  );

  return {
    result,
    openFileInDiff,
    openCombined,
    pinFile,
    scrollToFile,
    refreshOpenDiff,
    hasSingleton,
    setCombined,
    setCurrentFileIdx,
  };
}

describe('useGitHistoryDiffActions', () => {
  it('should_open_single_file_diff_in_non_combined_mode', () => {
    const { result, openFileInDiff, setCurrentFileIdx } = setup({ combined: false });
    act(() => {
      result.current.handleOpenDiff('b.ts');
    });
    expect(openFileInDiff).toHaveBeenCalledWith('b.ts');
    expect(setCurrentFileIdx).toHaveBeenCalledWith(1);
  });

  it('should_scroll_in_combined_mode_when_singleton_exists', () => {
    const { result, scrollToFile, openCombined } = setup({
      hasSingleton: vi.fn().mockReturnValue(true),
    });
    act(() => {
      result.current.handleOpenDiff('b.ts');
    });
    expect(scrollToFile).toHaveBeenCalledWith('b.ts');
    expect(openCombined).not.toHaveBeenCalled();
  });

  it('should_open_combined_when_no_singleton_in_combined_mode', () => {
    const { result, openCombined } = setup();
    act(() => {
      result.current.handleOpenDiff('a.ts');
    });
    expect(openCombined).toHaveBeenCalledWith('a.ts');
  });

  it('should_toggle_combined_off_and_switch_to_single_file', () => {
    const { result, openFileInDiff, setCombined } = setup();
    act(() => {
      result.current.handleToggleCombined(false);
    });
    expect(setCombined).toHaveBeenCalledWith(false);
    expect(openFileInDiff).toHaveBeenCalledWith('a.ts');
  });

  it('should_toggle_combined_on_and_open_combined', () => {
    const { result, openCombined, setCombined } = setup({ combined: false });
    act(() => {
      result.current.handleToggleCombined(true);
    });
    expect(setCombined).toHaveBeenCalledWith(true);
    expect(openCombined).toHaveBeenCalledWith('a.ts');
  });

  it('should_pin_file', () => {
    const { result, pinFile } = setup();
    act(() => {
      result.current.handlePinFile('a.ts');
    });
    expect(pinFile).toHaveBeenCalledWith('a.ts');
  });

  it('should_refresh_singleton_when_files_arrive', () => {
    const { refreshOpenDiff } = setup({ hasSingleton: vi.fn().mockReturnValue(true) });
    // effect 在挂载时运行（files 已存在 + selectedHash 已存在 + singleton 存在）
    expect(refreshOpenDiff).toHaveBeenCalledWith({
      combined: true,
      preferredPath: 'a.ts',
    });
  });
});
