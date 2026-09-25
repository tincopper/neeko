import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useFileSelection } from '../useFileSelection';

describe('useFileSelection — 选中域三语义', () => {
  it('toggleFile 勾选与取消', () => {
    const { result } = renderHook(() => useFileSelection());

    act(() => result.current.toggleFile('a.ts'));
    expect(result.current.selectedFiles).toEqual(new Set(['a.ts']));

    act(() => result.current.toggleFile('a.ts'));
    expect(result.current.selectedFiles).toEqual(new Set());
  });

  it('removeSelected 只摘除指定路径（discard 局部语义，不连带清掉其余勾选）', () => {
    const { result } = renderHook(() => useFileSelection());
    act(() => {
      result.current.toggleFile('a.ts');
      result.current.toggleFile('b.ts');
      result.current.toggleFile('keep.ts');
    });

    act(() => result.current.removeSelected(['a.ts', 'b.ts']));

    expect(result.current.selectedFiles).toEqual(new Set(['keep.ts']));
  });

  it('clearSelected 整批清空（commit 已消费语义）', () => {
    const { result } = renderHook(() => useFileSelection());
    act(() => {
      result.current.toggleFile('a.ts');
      result.current.toggleFile('b.ts');
    });

    act(() => result.current.clearSelected());

    expect(result.current.selectedFiles).toEqual(new Set());
  });
});
