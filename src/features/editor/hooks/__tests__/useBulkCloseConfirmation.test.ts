import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useBulkCloseConfirmation } from '../useBulkCloseConfirmation';

describe('useBulkCloseConfirmation', () => {
  it('request 记录数量与预览并打开对话框，确认前不执行 doClose', () => {
    const doClose = vi.fn();
    const { result } = renderHook(() => useBulkCloseConfirmation());
    act(() => {
      result.current.requestBulkCloseConfirmation(['a.ts', 'b.ts', 'c.ts', 'd.ts'], doClose);
    });
    expect(result.current.bulkCloseOpen).toBe(true);
    expect(result.current.bulkCloseDirtyCount).toBe(4);
    expect(result.current.bulkCloseDirtyPreview).toBe('a.ts, b.ts, c.ts');
    expect(doClose).not.toHaveBeenCalled();
  });

  it('confirm 关闭对话框并执行 doClose', () => {
    const doClose = vi.fn();
    const { result } = renderHook(() => useBulkCloseConfirmation());
    act(() => {
      result.current.requestBulkCloseConfirmation(['a.ts'], doClose);
      result.current.confirmBulkClose();
    });
    expect(result.current.bulkCloseOpen).toBe(false);
    expect(doClose).toHaveBeenCalledTimes(1);
  });

  it('cancel 关闭对话框但不执行 doClose', () => {
    const doClose = vi.fn();
    const { result } = renderHook(() => useBulkCloseConfirmation());
    act(() => {
      result.current.requestBulkCloseConfirmation(['a.ts'], doClose);
      result.current.cancelBulkClose();
    });
    expect(result.current.bulkCloseOpen).toBe(false);
    expect(doClose).not.toHaveBeenCalled();
  });
});
