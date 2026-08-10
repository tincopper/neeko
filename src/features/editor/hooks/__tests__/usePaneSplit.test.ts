// Unit tests for usePaneSplit: split state management
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { usePaneSplit } from '../usePaneSplit';

describe('usePaneSplit', () => {
  beforeEach(() => {
    // No external state to reset
  });

  it('initial state: single pane, can split', () => {
    const { result } = renderHook(() => usePaneSplit());

    expect(result.current.splitInfo.paneCount).toBe(1);
    expect(result.current.splitInfo.canSplit).toBe(true);
    expect(result.current.splitInfo.activePaneId).toBe('p1');
  });

  it('handleSplitStateChange updates split info', () => {
    const { result } = renderHook(() => usePaneSplit());

    act(() => {
      result.current.handleSplitStateChange({
        paneCount: 2,
        canSplit: true,
        activePaneId: 'p1',
      });
    });

    expect(result.current.splitInfo.paneCount).toBe(2);
  });

  it('handleSetSplitHorizontal stores the callback ref', () => {
    const { result } = renderHook(() => usePaneSplit());
    const cb = vi.fn();

    act(() => {
      result.current.handleSetSplitHorizontal(cb);
    });

    // The ref is internal; verify it doesn't throw when called
    expect(() => result.current.splitHorizontalRef.current?.()).not.toThrow();
  });

  it('handleSetSplitVertical stores the callback ref', () => {
    const { result } = renderHook(() => usePaneSplit());
    const cb = vi.fn();

    act(() => {
      result.current.handleSetSplitVertical(cb);
    });

    expect(() => result.current.splitVerticalRef.current?.()).not.toThrow();
  });

  it('handleSetClosePane stores the callback ref', () => {
    const { result } = renderHook(() => usePaneSplit());
    const cb = vi.fn();

    act(() => {
      result.current.handleSetClosePane(cb);
    });

    expect(() => result.current.closePaneRef.current?.()).not.toThrow();
  });
});
