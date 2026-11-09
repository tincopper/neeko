import { act, renderHook } from '@testing-library/react';
import type { FocusEvent } from 'react';
import { describe, expect, it } from 'vitest';

import { useSessionRowOverlay } from '../useSessionRowOverlay';

function blurEvent(contains: boolean): FocusEvent<HTMLDivElement> {
  return {
    currentTarget: { contains: () => contains },
    relatedTarget: {},
  } as unknown as FocusEvent<HTMLDivElement>;
}

describe('useSessionRowOverlay', () => {
  it('菜单开合与焦点都能独立强制显示覆盖槽，二者都结束时复位', () => {
    const { result } = renderHook(() => useSessionRowOverlay());

    expect(result.current.showActions).toBe(false);

    act(() => result.current.setMenuOpen(true));
    expect(result.current.showActions).toBe(true);

    act(() => result.current.setMenuOpen(false));
    expect(result.current.showActions).toBe(false);

    act(() => result.current.handleActionsFocus());
    expect(result.current.showActions).toBe(true);

    act(() => result.current.handleActionsBlur(blurEvent(false)));
    expect(result.current.showActions).toBe(false);
  });

  it('焦点仍在覆盖槽内部时不收起', () => {
    const { result } = renderHook(() => useSessionRowOverlay());

    act(() => result.current.handleActionsFocus());
    act(() => result.current.handleActionsBlur(blurEvent(true)));

    expect(result.current.showActions).toBe(true);
  });
});
