import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { CloseAction } from '../useCloseConfirmation';
import { useCloseConfirmation } from '../useCloseConfirmation';

describe('useCloseConfirmation', () => {
  it('request 打开对话框并记录文件名，用户操作前 Promise 未决', () => {
    const { result } = renderHook(() => useCloseConfirmation());
    let resolved: CloseAction | undefined;
    act(() => {
      result.current.requestCloseConfirmation('a.ts').then((v) => (resolved = v));
    });
    expect(result.current.closeConfirmOpen).toBe(true);
    expect(result.current.closeConfirmFileName).toBe('a.ts');
    expect(resolved).toBeUndefined();
  });

  it('onSave 关闭对话框并以 save resolve Promise', async () => {
    const { result } = renderHook(() => useCloseConfirmation());
    let resolved: CloseAction | undefined;
    await act(async () => {
      const p = result.current.requestCloseConfirmation('a.ts');
      result.current.onSave();
      resolved = await p;
    });
    expect(result.current.closeConfirmOpen).toBe(false);
    expect(resolved).toBe('save');
  });

  it('onCancel 关闭对话框并返回 cancel', async () => {
    const { result } = renderHook(() => useCloseConfirmation());
    let resolved: CloseAction | undefined;
    await act(async () => {
      const p = result.current.requestCloseConfirmation('a.ts');
      result.current.onCancel();
      resolved = await p;
    });
    expect(result.current.closeConfirmOpen).toBe(false);
    expect(resolved).toBe('cancel');
  });

  it('onDiscard 关闭对话框并返回 discard', async () => {
    const { result } = renderHook(() => useCloseConfirmation());
    let resolved: CloseAction | undefined;
    await act(async () => {
      const p = result.current.requestCloseConfirmation('a.ts');
      result.current.onDiscard();
      resolved = await p;
    });
    expect(result.current.closeConfirmOpen).toBe(false);
    expect(resolved).toBe('discard');
  });

  it('连续两次请求：后一次覆盖前一次，前一次 Promise 保持未决', async () => {
    const { result } = renderHook(() => useCloseConfirmation());
    let secondResolved: CloseAction | undefined;
    let firstSettled = false;
    await act(async () => {
      result.current.requestCloseConfirmation('a.ts').finally(() => {
        firstSettled = true;
      });
      const second = result.current.requestCloseConfirmation('b.ts');
      result.current.onDiscard();
      secondResolved = await second;
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(result.current.closeConfirmFileName).toBe('b.ts');
    expect(secondResolved).toBe('discard');
    expect(firstSettled).toBe(false);
  });
});
