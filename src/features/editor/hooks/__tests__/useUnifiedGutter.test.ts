import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useUnifiedGutterExtension } from '../useUnifiedGutter';

const onRun = vi.fn();
const onMenuRequest = vi.fn();

describe('useUnifiedGutterExtension', () => {
  it('should_enable_single_column_for_test_files_with_context', () => {
    const { result } = renderHook(() =>
      useUnifiedGutterExtension({
        projectId: 'p1',
        absFilePath: '/p/src/a.test.ts',
        fileName: 'src/a.test.ts',
        enabled: true,
        onRun,
        onMenuRequest,
      }),
    );
    expect(result.current).toHaveLength(1);
  });

  it('should_enable_breakpoint_column_for_non_test_files_with_context', () => {
    const { result } = renderHook(() =>
      useUnifiedGutterExtension({
        projectId: 'p1',
        absFilePath: '/p/src/plain.ts',
        fileName: 'src/plain.ts',
        enabled: true,
        onRun,
        onMenuRequest,
      }),
    );
    // 非测试文件同样保留单列（断点红点），只是无 play 标记——绝不出现第二列。
    expect(result.current).toHaveLength(1);
  });

  it('should_disable_without_breakpoint_context', () => {
    const { result } = renderHook(() =>
      useUnifiedGutterExtension({
        projectId: null,
        absFilePath: null,
        fileName: 'src/a.test.ts',
        enabled: true,
        onRun,
        onMenuRequest,
      }),
    );
    expect(result.current).toHaveLength(0);
  });

  it('should_keep_column_without_test_markers_when_tab_not_editable', () => {
    const { result } = renderHook(() =>
      useUnifiedGutterExtension({
        projectId: 'p1',
        absFilePath: '/p/src/a.test.ts',
        fileName: 'src/a.test.ts',
        enabled: false,
        onRun,
        onMenuRequest,
      }),
    );
    // readOnly 等不可编辑 tab：断点列仍在（不断点语义），仅测试标记关闭。
    expect(result.current).toHaveLength(1);
  });

  it('should_keep_extension_stable_across_rerenders_with_same_inputs', () => {
    const { result, rerender } = renderHook(
      ({ fileName }: { fileName: string }) =>
        useUnifiedGutterExtension({
          projectId: 'p1',
          absFilePath: '/p/src/a.test.ts',
          fileName,
          enabled: true,
          onRun,
          onMenuRequest,
        }),
      { initialProps: { fileName: 'src/a.test.ts' } },
    );
    const first = result.current;
    rerender({ fileName: 'src/a.test.ts' });
    expect(result.current).toBe(first);
  });
});
