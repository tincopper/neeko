import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useDiscardConfirm } from '../useDiscardConfirm';
import type { DiscardIntent } from '../utils/discardIntent';

const INTENT: DiscardIntent = {
  paths: ['a.ts', 'b.ts'],
  scope: 'group',
  changeClass: 'tracked',
};

describe('useDiscardConfirm — 二次确认流', () => {
  it('request 定死待确认意图（pending 打开弹窗）', () => {
    const { result } = renderHook(() => useDiscardConfirm(vi.fn()));

    expect(result.current.pending).toBeNull();
    act(() => result.current.request(INTENT));
    expect(result.current.pending).toBe(INTENT);
  });

  it('confirm 清空弹窗并原样回传 intent 执行（同一引用，不得改写范围）', () => {
    const execute = vi.fn();
    const { result } = renderHook(() => useDiscardConfirm(execute));
    act(() => result.current.request(INTENT));

    act(() => result.current.confirm(INTENT));

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]?.[0]).toBe(INTENT);
    expect(result.current.pending).toBeNull();
  });

  it('cancel 只清空，不触发执行', () => {
    const execute = vi.fn();
    const { result } = renderHook(() => useDiscardConfirm(execute));
    act(() => result.current.request(INTENT));

    act(() => result.current.cancel());

    expect(result.current.pending).toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });
});
