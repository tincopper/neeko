import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useJdtLinkNavigation, type JdtLinkContext } from '../useJdtLinkNavigation';

const CONTEXT: JdtLinkContext = {
  projectPath: '/repo',
  tabKey: 'k1',
  projectId: 'p1',
  filePath: '/repo/src/ArrayTest.java',
};

describe('useJdtLinkNavigation — hover jdt 链接的两段式晚绑定', () => {
  const navigate = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    navigate.mockClear();
  });

  it('should_be_silent_before_bind（navigation 尚未就绪）', () => {
    const { result } = renderHook(() => useJdtLinkNavigation());

    expect(() =>
      result.current.onOpenJdtLink('jdt://contents/java.base/Foo.class?=q'),
    ).not.toThrow();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('should_jump_to_line_0_of_the_jdt_target_after_bind', () => {
    const { result } = renderHook(() => useJdtLinkNavigation());
    act(() => result.current.bind(navigate, CONTEXT));

    result.current.onOpenJdtLink('jdt://contents/java.base/java.io/PrintStream.class?=q');

    expect(navigate).toHaveBeenCalledWith(
      {
        uri: 'jdt://contents/java.base/java.io/PrintStream.class?=q',
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      },
      '/repo',
      'k1',
      'p1',
      '/repo/src/ArrayTest.java',
      null,
    );
  });

  it('should_keep_a_stable_callback_reference（useLspClient 首建即捕获，不能变）', () => {
    const { result, rerender } = renderHook(() => useJdtLinkNavigation());
    const first = result.current.onOpenJdtLink;

    rerender();
    act(() => result.current.bind(navigate, CONTEXT));

    expect(result.current.onOpenJdtLink).toBe(first);
  });

  it('should_stop_jumping_after_unbind（卸载/换目标时必须解绑）', () => {
    // 语义必需：共享 LSP client 只捕获首个 tab 的回调，卸载后不清空会让它带着
    // 已卸载 tab 的 projectId/filePath 继续跳转。
    const { result } = renderHook(() => useJdtLinkNavigation());
    let unbind = (): void => {};
    act(() => {
      unbind = result.current.bind(navigate, CONTEXT);
    });

    act(() => unbind());
    result.current.onOpenJdtLink('jdt://x');

    expect(navigate).not.toHaveBeenCalled();
  });

  it('should_not_clear_a_newer_binding_when_an_older_unbind_runs', () => {
    const { result } = renderHook(() => useJdtLinkNavigation());
    let staleUnbind = (): void => {};
    act(() => {
      staleUnbind = result.current.bind(navigate, CONTEXT);
    });
    act(() => result.current.bind(navigate, CONTEXT)); // 覆盖为新的绑定

    act(() => staleUnbind()); // 旧解绑不应误清新绑定
    result.current.onOpenJdtLink('jdt://x');

    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('should_rebind_to_the_latest_navigation（tabs 切换后跳转仍用最新上下文）', () => {
    const { result } = renderHook(() => useJdtLinkNavigation());
    act(() => result.current.bind(navigate, CONTEXT));
    act(() => result.current.bind(navigate, { ...CONTEXT, filePath: '/repo/src/Other.java' }));

    result.current.onOpenJdtLink('jdt://x');

    expect(navigate).toHaveBeenCalledWith(
      expect.anything(),
      '/repo',
      'k1',
      'p1',
      '/repo/src/Other.java',
      null,
    );
  });
});
