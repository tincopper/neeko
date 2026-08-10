// Unit tests for usePaneContextMenu: context menu state and items
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { usePaneContextMenu } from '../usePaneContextMenu';

describe('usePaneContextMenu', () => {
  const defaultParams = {
    groupId: 'left' as const,
    onCloseTab: vi.fn(),
    onCloseOtherTabs: vi.fn(),
    onCloseAllTabs: vi.fn(),
    onSplitRight: vi.fn(),
    onMoveToRight: vi.fn(),
    onMoveToLeft: vi.fn(),
    onUnpinTab: vi.fn(),
    onPinTab: vi.fn(),
    pinnedTabs: [],
    onFocusGroup: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initial state: no context menu', () => {
    const { result } = renderHook(() => usePaneContextMenu(defaultParams));

    expect(result.current.contextMenu).toBeNull();
    expect(result.current.contextMenuItems).toEqual([]);
  });

  it('handleTabContextMenu sets menu position and calls onFocusGroup', () => {
    const { result } = renderHook(() => usePaneContextMenu(defaultParams));
    const mockEvent = {
      clientX: 100,
      clientY: 200,
      preventDefault: vi.fn(),
    } as unknown as React.MouseEvent;

    act(() => {
      result.current.handleTabContextMenu('tab1', mockEvent);
    });

    expect(result.current.contextMenu).toEqual({ tabId: 'tab1', x: 100, y: 200 });
    expect(defaultParams.onFocusGroup).toHaveBeenCalled();
  });

  it('closeContextMenu resets menu state', () => {
    const { result } = renderHook(() => usePaneContextMenu(defaultParams));
    const mockEvent = {
      clientX: 100,
      clientY: 200,
      preventDefault: vi.fn(),
    } as unknown as React.MouseEvent;

    act(() => {
      result.current.handleTabContextMenu('tab1', mockEvent);
    });
    act(() => {
      result.current.closeContextMenu();
    });

    expect(result.current.contextMenu).toBeNull();
  });

  it('contextMenuItems: left group has Split Right and Move to Right', () => {
    const { result } = renderHook(() => usePaneContextMenu(defaultParams));
    const mockEvent = {
      clientX: 100,
      clientY: 200,
      preventDefault: vi.fn(),
    } as unknown as React.MouseEvent;

    act(() => {
      result.current.handleTabContextMenu('tab1', mockEvent);
    });

    const labels = result.current.contextMenuItems.map((i) => i.label);
    expect(labels).toContain('Close');
    expect(labels).toContain('Close Others');
    expect(labels).toContain('Close All');
    expect(labels).toContain('Split Right');
    expect(labels).toContain('Move to Right');
    expect(labels).toContain('Pin Tab');
  });

  it('contextMenuItems: right group has Move to Left instead of Split Right', () => {
    const params = { ...defaultParams, groupId: 'right' as const };
    const { result } = renderHook(() => usePaneContextMenu(params));
    const mockEvent = {
      clientX: 100,
      clientY: 200,
      preventDefault: vi.fn(),
    } as unknown as React.MouseEvent;

    act(() => {
      result.current.handleTabContextMenu('tab1', mockEvent);
    });

    const labels = result.current.contextMenuItems.map((i) => i.label);
    expect(labels).toContain('Move to Left');
    expect(labels).not.toContain('Split Right');
    expect(labels).not.toContain('Move to Right');
  });

  it('contextMenuItems: pinned group only shows Unpin Tab', () => {
    const params = { ...defaultParams, groupId: 'pinned' as const };
    const { result } = renderHook(() => usePaneContextMenu(params));
    const mockEvent = {
      clientX: 100,
      clientY: 200,
      preventDefault: vi.fn(),
    } as unknown as React.MouseEvent;

    act(() => {
      result.current.handleTabContextMenu('tab1', mockEvent);
    });

    const labels = result.current.contextMenuItems.map((i) => i.label);
    expect(labels).toEqual(['Unpin Tab']);
  });

  it('contextMenuItems: pinned tab in left group shows Unpin Tab', () => {
    const params = {
      ...defaultParams,
      pinnedTabs: [{ id: 'tab1' }],
    };
    const { result } = renderHook(() => usePaneContextMenu(params));
    const mockEvent = {
      clientX: 100,
      clientY: 200,
      preventDefault: vi.fn(),
    } as unknown as React.MouseEvent;

    act(() => {
      result.current.handleTabContextMenu('tab1', mockEvent);
    });

    const labels = result.current.contextMenuItems.map((i) => i.label);
    expect(labels).toContain('Unpin Tab');
    expect(labels).not.toContain('Pin Tab');
  });
});
