import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CommitEntry, CommitFileChange } from '@/shared/types';

import { useGitLogKeyboardNav } from '../useGitLogKeyboardNav';

function makeCommits(): CommitEntry[] {
  return [
    {
      hash: 'aaa',
      short_hash: 'aaa',
      author: 'a',
      timestamp: 't1',
      message: 'first',
      refs: '',
      parents: [],
    },
    {
      hash: 'bbb',
      short_hash: 'bbb',
      author: 'a',
      timestamp: 't2',
      message: 'second',
      refs: '',
      parents: [],
    },
    {
      hash: 'ccc',
      short_hash: 'ccc',
      author: 'a',
      timestamp: 't3',
      message: 'third',
      refs: '',
      parents: [],
    },
  ];
}

function makeFiles(): CommitFileChange[] {
  return [
    { path: 'a.ts', status: 'M', additions: 1, deletions: 0 },
    { path: 'b.ts', status: 'A', additions: 2, deletions: 0 },
  ];
}

function fireKey(key: string, target?: HTMLElement): void {
  const event = new KeyboardEvent('keydown', { key, bubbles: true });
  if (target) {
    target.dispatchEvent(event);
  } else {
    window.dispatchEvent(event);
  }
}

const baseOptions = {
  enabled: true,
  commits: makeCommits(),
  selectedHash: 'aaa',
  files: makeFiles(),
  currentFileIdx: 0,
  combined: true,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useGitLogKeyboardNav', () => {
  it('should_move_to_next_commit_with_capital_J', () => {
    const onSelectCommit = vi.fn();
    renderHook(() => useGitLogKeyboardNav({ ...baseOptions, onSelectCommit }));
    fireKey('J');
    expect(onSelectCommit).toHaveBeenCalledWith('bbb');
  });

  it('should_select_first_commit_with_J_when_none_selected', () => {
    const onSelectCommit = vi.fn();
    renderHook(() => useGitLogKeyboardNav({ ...baseOptions, selectedHash: null, onSelectCommit }));
    fireKey('J');
    expect(onSelectCommit).toHaveBeenCalledWith('aaa');
  });

  it('should_move_to_previous_commit_with_capital_K', () => {
    const onSelectCommit = vi.fn();
    renderHook(() => useGitLogKeyboardNav({ ...baseOptions, selectedHash: 'bbb', onSelectCommit }));
    fireKey('K');
    expect(onSelectCommit).toHaveBeenCalledWith('aaa');
  });

  it('should_move_between_files_with_lowercase_j_and_k', () => {
    const onOpenFileDiff = vi.fn();
    const { rerender } = renderHook(
      ({ idx }: { idx: number }) =>
        useGitLogKeyboardNav({ ...baseOptions, currentFileIdx: idx, onOpenFileDiff }),
      { initialProps: { idx: 0 } },
    );

    fireKey('j');
    expect(onOpenFileDiff).toHaveBeenCalledWith('b.ts');

    rerender({ idx: 1 });
    fireKey('k');
    expect(onOpenFileDiff).toHaveBeenCalledWith('a.ts');
  });

  it('should_toggle_combined_with_c', () => {
    const onToggleCombined = vi.fn();
    renderHook(() => useGitLogKeyboardNav({ ...baseOptions, onToggleCombined }));
    fireKey('c');
    expect(onToggleCombined).toHaveBeenCalledWith(false);
  });

  it('should_not_fire_handlers_when_disabled', () => {
    const onSelectCommit = vi.fn();
    const onToggleCombined = vi.fn();
    renderHook(() =>
      useGitLogKeyboardNav({ ...baseOptions, enabled: false, onSelectCommit, onToggleCombined }),
    );
    fireKey('J');
    fireKey('c');
    expect(onSelectCommit).not.toHaveBeenCalled();
    expect(onToggleCombined).not.toHaveBeenCalled();
  });

  it('should_ignore_keys_when_typing_in_input', () => {
    const onSelectCommit = vi.fn();
    renderHook(() => useGitLogKeyboardNav({ ...baseOptions, onSelectCommit }));

    const input = document.createElement('input');
    document.body.appendChild(input);
    try {
      fireKey('J', input);
    } finally {
      document.body.removeChild(input);
    }
    expect(onSelectCommit).not.toHaveBeenCalled();
  });
});
