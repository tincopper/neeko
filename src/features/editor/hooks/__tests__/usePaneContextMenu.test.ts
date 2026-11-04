// Unit tests for usePaneContextMenu: context menu state and items
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { usePaneContextMenu } from '../usePaneContextMenu';

describe('usePaneContextMenu', () => {
  const defaultParams = {
    paneId: 'left' as const,
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
    const params = { ...defaultParams, paneId: 'right' as const };
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
    const params = { ...defaultParams, paneId: 'pinned' as const };
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

/**
 * P1：tab → 槽位 / 回中心的菜单项。
 *
 * 判据是「只在合法时出现」：pinned tab 一律不出现（R9 明确拒绝而非静默 unpin）；
 * 「已经在的那个 surface」不出现（那是 no-op，列出来只会让菜单变吵）。
 */
describe('usePaneContextMenu — tab 停靠入口（P1）', () => {
  const mouseEvent = {
    clientX: 10,
    clientY: 20,
    preventDefault: vi.fn(),
  } as unknown as React.MouseEvent;

  function labelsFor(
    paneId: 'left' | 'right' | 'pinned' | 'dockLeft' | 'dockRight',
    extra: Record<string, unknown> = {},
    tabId = 'tab1',
  ): string[] {
    const params = {
      paneId,
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
      onMoveTabToSlot: vi.fn(),
      ...extra,
    };
    const { result } = renderHook(() => usePaneContextMenu(params));
    act(() => {
      result.current.handleTabContextMenu(tabId, mouseEvent);
    });
    return result.current.contextMenuItems
      .map((item) => ('label' in item ? item.label : ''))
      .filter(Boolean);
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('中心 pane：出现左右 dock 项，不出现「Move to Center」', () => {
    const labels = labelsFor('left');
    expect(labels).toContain('Move to Left Dock');
    expect(labels).toContain('Move to Right Dock');
    expect(labels).not.toContain('Move to Center');
  });

  it('dockLeft：出现「回中心」+ 右 dock，不出现「移到左 dock」（已在该处）', () => {
    const labels = labelsFor('dockLeft');
    expect(labels).toContain('Move to Center');
    expect(labels).toContain('Move to Right Dock');
    expect(labels).not.toContain('Move to Left Dock');
    // 中心分屏操作在 dock 内无意义
    expect(labels).not.toContain('Split Right');
    expect(labels).not.toContain('Move to Right');
  });

  it('dockRight：出现「回中心」+ 左 dock，不出现「移到右 dock」', () => {
    const labels = labelsFor('dockRight');
    expect(labels).toContain('Move to Center');
    expect(labels).toContain('Move to Left Dock');
    expect(labels).not.toContain('Move to Right Dock');
  });

  it('pinned tab：不出现任何 dock 项（R9 拒绝，不静默 unpin）', () => {
    const labels = labelsFor('left', { pinnedTabs: [{ id: 'tab1' }] });
    expect(labels).not.toContain('Move to Left Dock');
    expect(labels).not.toContain('Move to Right Dock');
    expect(labels).toContain('Unpin Tab');
  });

  it('未接线（无 onMoveTabToSlot）→ 不出现 dock 项', () => {
    const labels = labelsFor('left', { onMoveTabToSlot: undefined });
    expect(labels).not.toContain('Move to Left Dock');
    expect(labels).not.toContain('Move to Right Dock');
  });

  it('点击菜单项 → 以 (tabId, target) 调编排入口', () => {
    const onMoveTabToSlot = vi.fn();
    const params = {
      paneId: 'dockRight' as const,
      onCloseTab: vi.fn(),
      pinnedTabs: [],
      onFocusGroup: vi.fn(),
      onMoveTabToSlot,
    };
    const { result } = renderHook(() => usePaneContextMenu(params));
    act(() => {
      result.current.handleTabContextMenu('tab1', mouseEvent);
    });
    const item = result.current.contextMenuItems.find(
      (entry) => 'label' in entry && entry.label === 'Move to Center',
    );
    expect(item && 'action' in item).toBe(true);
    act(() => {
      if (item && 'action' in item) item.action();
    });
    expect(onMoveTabToSlot).toHaveBeenCalledWith('tab1', 'center');
  });
});
