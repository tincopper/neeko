import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useGitHistorySelection } from '../useGitHistorySelection';

describe('useGitHistorySelection', () => {
  it('should_default_to_first_commit_view_state', () => {
    const { result } = renderHook(() => useGitHistorySelection());
    expect(result.current.selectedHash).toBeNull();
    expect(result.current.selectedExpanded).toBe(false);
    expect(result.current.combined).toBe(true);
    expect(result.current.currentFileIdx).toBe(0);
    expect(result.current.searchQuery).toBe('');
  });

  it('should_select_commit_and_reset_file_index', () => {
    const { result } = renderHook(() => useGitHistorySelection());
    act(() => {
      result.current.handleSelectCommit('abc123');
    });
    expect(result.current.selectedHash).toBe('abc123');
    expect(result.current.selectedExpanded).toBe(true);
    expect(result.current.currentFileIdx).toBe(0);
  });

  it('should_toggle_expanded_when_selecting_same_commit', () => {
    const { result } = renderHook(() => useGitHistorySelection());
    act(() => {
      result.current.handleSelectCommit('abc123');
    });
    act(() => {
      result.current.handleSelectCommit('abc123');
    });
    expect(result.current.selectedExpanded).toBe(false);
  });

  it('should_select_new_commit_and_switch_to_expanded', () => {
    const { result } = renderHook(() => useGitHistorySelection());
    act(() => {
      result.current.handleSelectCommit('abc123');
    });
    act(() => {
      result.current.handleSelectCommit('abc123');
    });
    act(() => {
      result.current.handleSelectCommit('def456');
    });
    expect(result.current.selectedHash).toBe('def456');
    expect(result.current.selectedExpanded).toBe(true);
    expect(result.current.currentFileIdx).toBe(0);
  });

  it('should_expose_state_setters', () => {
    const { result } = renderHook(() => useGitHistorySelection());
    act(() => {
      result.current.setSearchQuery('query');
      result.current.setCombined(false);
      result.current.setCurrentFileIdx(2);
    });
    expect(result.current.searchQuery).toBe('query');
    expect(result.current.combined).toBe(false);
    expect(result.current.currentFileIdx).toBe(2);
  });
});
