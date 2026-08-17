import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useOverlayStore } from '@/shared/store/overlayStore';

import { useActionMenu } from '../useActionMenu';

beforeEach(() => {
  useOverlayStore.setState({ open: {}, count: 0 });
});

describe('useActionMenu', () => {
  it('初始关闭，open 后记录 rect，close 后复位', () => {
    const { result } = renderHook(() => useActionMenu());
    expect(result.current.actionMenuRect).toBeNull();

    const rect = {} as DOMRect;
    act(() => {
      result.current.openActionMenu(rect);
    });
    expect(result.current.actionMenuRect).toBe(rect);

    act(() => {
      result.current.closeActionMenu();
    });
    expect(result.current.actionMenuRect).toBeNull();
  });

  it('打开菜单时上报浮层（z-order），关闭时清除', () => {
    const { result } = renderHook(() => useActionMenu());
    expect(useOverlayStore.getState().count).toBe(0);

    act(() => {
      result.current.openActionMenu({} as DOMRect);
    });
    expect(useOverlayStore.getState().count).toBe(1);

    act(() => {
      result.current.closeActionMenu();
    });
    expect(useOverlayStore.getState().count).toBe(0);
  });
});
