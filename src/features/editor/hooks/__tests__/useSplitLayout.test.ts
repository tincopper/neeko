import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  clampRatio,
  countPanes,
  updateSplitRatio,
  useSplitLayout,
} from '@/features/editor/hooks/useSplitLayout';
import type { PaneNode } from '@/types';

describe('useSplitLayout helpers', () => {
  it('clampRatio 限制在 0.2~0.8', () => {
    expect(clampRatio(0.1)).toBe(0.2);
    expect(clampRatio(0.5)).toBe(0.5);
    expect(clampRatio(0.9)).toBe(0.8);
  });

  it('countPanes 统计叶子节点数', () => {
    const tree: PaneNode = {
      type: 'split',
      direction: 'horizontal',
      ratio: 0.5,
      first: { type: 'leaf', paneId: 'p1' },
      second: {
        type: 'split',
        direction: 'vertical',
        ratio: 0.5,
        first: { type: 'leaf', paneId: 'p2' },
        second: { type: 'leaf', paneId: 'p3' },
      },
    };

    expect(countPanes(tree)).toBe(3);
  });

  it('updateSplitRatio 按路径更新比率', () => {
    const tree: PaneNode = {
      type: 'split',
      direction: 'horizontal',
      ratio: 0.5,
      first: {
        type: 'split',
        direction: 'vertical',
        ratio: 0.5,
        first: { type: 'leaf', paneId: 'p1' },
        second: { type: 'leaf', paneId: 'p2' },
      },
      second: { type: 'leaf', paneId: 'p3' },
    };

    const updated = updateSplitRatio(tree, ['first'], 0.7);
    expect(updated.type).toBe('split');
    if (updated.type === 'split' && updated.first.type === 'split') {
      expect(updated.first.ratio).toBe(0.7);
    }
  });
});

describe('useSplitLayout', () => {
  it('初始为单 pane', () => {
    const { result } = renderHook(() => useSplitLayout('layout-1'));
    expect(result.current.state.paneCount).toBe(1);
    expect(result.current.state.activePaneId).toBe('p1');
    expect(result.current.canSplit).toBe(true);
  });

  it('splitPane 创建新 pane 并设置为 active', () => {
    const { result } = renderHook(() => useSplitLayout('layout-1'));

    act(() => {
      result.current.splitPane('p1', 'horizontal');
    });

    expect(result.current.state.paneCount).toBe(2);
    expect(result.current.state.activePaneId).toBe('p2');
  });

  it('达到上限后 canSplit=false', () => {
    const { result } = renderHook(() => useSplitLayout('layout-1', 2));

    act(() => {
      result.current.splitPane('p1', 'horizontal');
    });

    expect(result.current.state.paneCount).toBe(2);
    expect(result.current.canSplit).toBe(false);

    let created: string | null = 'x';
    act(() => {
      created = result.current.splitPane('p2', 'vertical');
    });

    expect(created).toBeNull();
    expect(result.current.state.paneCount).toBe(2);
  });

  it('closePane 删除 pane 并回退 active', () => {
    const { result } = renderHook(() => useSplitLayout('layout-1'));

    act(() => {
      result.current.splitPane('p1', 'horizontal');
    });

    expect(result.current.state.activePaneId).toBe('p2');

    act(() => {
      result.current.closePane('p2');
    });

    expect(result.current.state.paneCount).toBe(1);
    expect(result.current.state.activePaneId).toBe('p1');
  });

  it('setRatio 会限制范围', () => {
    const { result } = renderHook(() => useSplitLayout('layout-1'));

    act(() => {
      result.current.splitPane('p1', 'horizontal');
      result.current.setRatio([], 0.95);
    });

    expect(result.current.state.root.type).toBe('split');
    if (result.current.state.root.type === 'split') {
      expect(result.current.state.root.ratio).toBe(0.8);
    }
  });

  it('layoutId 变化会重置布局', () => {
    const { result, rerender } = renderHook(({ layoutId }) => useSplitLayout(layoutId), {
      initialProps: { layoutId: 'layout-1' },
    });

    act(() => {
      result.current.splitPane('p1', 'horizontal');
    });
    expect(result.current.state.paneCount).toBe(2);

    rerender({ layoutId: 'layout-2' });
    expect(result.current.state.paneCount).toBe(1);
    expect(result.current.state.activePaneId).toBe('p1');
  });
});
