import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DockBarItem } from '@/shared/store/dockStore';
import { useDockStore } from '@/shared/store/dockStore';

// Mock DockBarButton to a thin passthrough so the hook test focuses on
// filter / sort / side mapping rather than registry/icon wiring.
vi.mock('@/app/components/DockBarButton', () => ({
  default: ({ panelId, side }: { panelId: string; side: string }) => (
    <span data-testid={`btn-${panelId}`} data-side={side} />
  ),
}));

import { useDockBarButtons } from '../UseDockBarButtons';

function makeBarItems(): DockBarItem[] {
  return [
    { panelId: 'projects', side: 'left', order: 1, visible: true },
    { panelId: 'skills', side: 'left', order: 2, visible: true },
    { panelId: 'files', side: 'right', order: 1, visible: true },
    { panelId: 'hiddenPanel', side: 'left', order: 0, visible: false },
  ];
}

describe('useDockBarButtons', () => {
  beforeEach(() => {
    localStorage.clear();
    useDockStore.setState({ barItems: makeBarItems() });
  });

  it('returns left buttons only, in ascending order, excluding hidden items', () => {
    const { result } = renderHook(() => useDockBarButtons('left'));

    const left = result.current;
    expect(left).toHaveLength(2);
    expect(left[0].props.panelId).toBe('projects');
    expect(left[0].props.side).toBe('left');
    expect(left[1].props.panelId).toBe('skills');
  });

  it('returns right buttons only', () => {
    const { result } = renderHook(() => useDockBarButtons('right'));

    expect(result.current).toHaveLength(1);
    expect(result.current[0].props.panelId).toBe('files');
    expect(result.current[0].props.side).toBe('right');
  });

  it('re-renders when barItems change (visibility toggling)', () => {
    const { result, rerender } = renderHook(() => useDockBarButtons('left'));
    expect(result.current).toHaveLength(2);

    useDockStore.setState((s) => ({
      barItems: s.barItems.map((i) => (i.panelId === 'skills' ? { ...i, visible: false } : i)),
    }));
    rerender();

    expect(result.current).toHaveLength(1);
    expect(result.current[0].props.panelId).toBe('projects');
  });
});
