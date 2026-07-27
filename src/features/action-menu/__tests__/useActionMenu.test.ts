import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useActionMenu } from '../hooks/useActionMenu';
import type { ActionRegistryItem, ActionContext } from '../types/actionMenu';

const mockItems: ActionRegistryItem[] = [
  {
    id: 'new-terminal',
    group: 'terminal',
    label: 'New Terminal',
    description: 'Open a new terminal tab',
    icon: {} as any,
    keywords: ['terminal'],
    execute: vi.fn(),
  },
  {
    id: 'open-file',
    group: 'file',
    label: 'Open File…',
    description: 'Search and open a file',
    icon: {} as any,
    keywords: ['open'],
    execute: vi.fn(),
  },
  {
    id: 'new-file',
    group: 'file',
    label: 'New File…',
    description: 'Create a new file',
    icon: {} as any,
    keywords: ['new', 'file'],
    visible: () => true,
    execute: vi.fn(),
  },
];

const ctx: ActionContext = {
  projectId: 'proj-1',
  tabKey: 'proj-1',
  agents: [],
  recentFiles: [],
  closeMenu: vi.fn(),
};

describe('useActionMenu', () => {
  it('should_return_all_filtered_items_on_init', () => {
    const { result } = renderHook(() => useActionMenu(mockItems, ctx));
    expect(result.current.filtered).toHaveLength(3);
    expect(result.current.query).toBe('');
    expect(result.current.selectedIndex).toBe(0);
  });

  it('should_filter_when_query_changes', () => {
    const { result } = renderHook(() => useActionMenu(mockItems, ctx));

    act(() => {
      result.current.setQuery('Create');
    });

    expect(result.current.filtered).toHaveLength(1);
    expect(result.current.filtered[0].id).toBe('new-file');
    expect(result.current.selectedIndex).toBe(0);
  });

  it('should_reset_selected_index_on_query_change', () => {
    const { result } = renderHook(() => useActionMenu(mockItems, ctx));

    act(() => {
      result.current.setSelectedIndex(2);
    });
    expect(result.current.selectedIndex).toBe(2);

    act(() => {
      result.current.setQuery('file');
    });
    expect(result.current.selectedIndex).toBe(0);
  });

  it('should_move_selection_down_on_arrow_down', () => {
    const { result } = renderHook(() => useActionMenu(mockItems, ctx));

    act(() => {
      result.current.handleKeyDown({ key: 'ArrowDown', preventDefault: vi.fn() } as any);
    });

    expect(result.current.selectedIndex).toBe(1);
  });

  it('should_move_selection_up_on_arrow_up', () => {
    const { result } = renderHook(() => useActionMenu(mockItems, ctx));

    act(() => {
      result.current.setSelectedIndex(1);
    });

    act(() => {
      result.current.handleKeyDown({ key: 'ArrowUp', preventDefault: vi.fn() } as any);
    });

    expect(result.current.selectedIndex).toBe(0);
  });

  it('should_wrap_selection_at_edges', () => {
    const { result } = renderHook(() => useActionMenu(mockItems, ctx));

    // ArrowUp at top → wrap to last
    act(() => {
      result.current.handleKeyDown({ key: 'ArrowUp', preventDefault: vi.fn() } as any);
    });
    expect(result.current.selectedIndex).toBe(2);

    // ArrowDown at bottom → wrap to first
    act(() => {
      result.current.handleKeyDown({ key: 'ArrowDown', preventDefault: vi.fn() } as any);
    });
    expect(result.current.selectedIndex).toBe(0);
  });

  it('should_execute_selected_item_and_close_on_enter', () => {
    const onExecute = vi.fn();
    const closeMenu = vi.fn();
    const ctxWithClose: ActionContext = { ...ctx, closeMenu };
    const { result } = renderHook(() => useActionMenu(mockItems, ctxWithClose, onExecute));

    act(() => {
      result.current.handleKeyDown({ key: 'Enter', preventDefault: vi.fn() } as any);
    });

    expect(onExecute).toHaveBeenCalledWith(mockItems[0]);
    expect(closeMenu).toHaveBeenCalled();
  });

  it('should_call_closeMenu_on_escape', () => {
    const closeMenu = vi.fn();
    const ctxWithClose: ActionContext = { ...ctx, closeMenu };
    const { result } = renderHook(() => useActionMenu(mockItems, ctxWithClose));

    act(() => {
      result.current.handleKeyDown({ key: 'Escape', preventDefault: vi.fn() } as any);
    });

    expect(closeMenu).toHaveBeenCalled();
  });

  it('should_reset_state_correctly', () => {
    const { result } = renderHook(() => useActionMenu(mockItems, ctx));

    act(() => {
      result.current.setQuery('terminal');
    });

    expect(result.current.filtered).toHaveLength(1);

    act(() => {
      result.current.reset();
    });

    expect(result.current.query).toBe('');
    expect(result.current.selectedIndex).toBe(0);
    expect(result.current.filtered).toHaveLength(3);
  });
});
