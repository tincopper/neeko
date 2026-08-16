import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useActionMenu } from '../useActionMenu';

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
});
