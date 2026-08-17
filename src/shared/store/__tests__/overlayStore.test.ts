import { beforeEach, describe, expect, it } from 'vitest';

import { hasOpenOverlay, useOverlayStore } from '../overlayStore';

function reset() {
  useOverlayStore.setState({ open: {}, count: 0 });
}

describe('useOverlayStore — z-order 浮层状态', () => {
  beforeEach(() => {
    reset();
  });

  it('starts closed with zero overlays', () => {
    expect(hasOpenOverlay()).toBe(false);
  });

  it('setOverlayOpen(id, true) increments count and opens', () => {
    useOverlayStore.getState().setOverlayOpen('action-menu', true);

    expect(hasOpenOverlay()).toBe(true);
    expect(useOverlayStore.getState().count).toBe(1);
  });

  it('setOverlayOpen(id, false) closes and decrements count', () => {
    useOverlayStore.getState().setOverlayOpen('action-menu', true);
    useOverlayStore.getState().setOverlayOpen('action-menu', false);

    expect(hasOpenOverlay()).toBe(false);
    expect(useOverlayStore.getState().count).toBe(0);
  });

  it('multiple distinct overlays stack; closing one keeps others open', () => {
    useOverlayStore.getState().setOverlayOpen('action-menu', true);
    useOverlayStore.getState().setOverlayOpen('quick-open', true);

    expect(useOverlayStore.getState().count).toBe(2);
    expect(hasOpenOverlay()).toBe(true);

    useOverlayStore.getState().setOverlayOpen('action-menu', false);

    expect(useOverlayStore.getState().count).toBe(1);
    expect(hasOpenOverlay()).toBe(true);
  });

  it('repeated set with same value is idempotent (no count drift)', () => {
    useOverlayStore.getState().setOverlayOpen('x', true);
    useOverlayStore.getState().setOverlayOpen('x', true);

    expect(useOverlayStore.getState().count).toBe(1);
  });

  it('reset clears all overlays', () => {
    useOverlayStore.getState().setOverlayOpen('a', true);
    useOverlayStore.getState().setOverlayOpen('b', true);
    useOverlayStore.getState().reset();

    expect(useOverlayStore.getState().count).toBe(0);
    expect(hasOpenOverlay()).toBe(false);
  });
});
