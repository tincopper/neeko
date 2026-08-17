import { act, renderHook } from '@testing-library/react';
import { createRef, type RefObject } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const browserSetBoundsMock = vi.fn().mockResolvedValue(undefined);

vi.mock('@/features/browser/api/browserApi', () => ({
  browserSetBounds: (...args: unknown[]) => browserSetBoundsMock(...args),
}));

import { useBrowserBoundsSync } from '../useBrowserBoundsSync';

type ResizeCb = () => void;
let resizeCallback: ResizeCb | null = null;

class MockResizeObserver {
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
  constructor(cb: ResizeCb) {
    resizeCallback = cb;
  }
}

const makeRect = (x: number, y: number, w: number, h: number) =>
  ({
    x,
    y,
    width: w,
    height: h,
    top: y,
    left: x,
    right: x + w,
    bottom: y + h,
  }) as DOMRect;

describe('useBrowserBoundsSync — 容器/窗口变化同步 OS webview bounds（panel+tab 共用）', () => {
  let container: HTMLDivElement;
  let isCreatedRef: RefObject<boolean>;

  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', MockResizeObserver);
    resizeCallback = null;
    container = document.createElement('div');
    container.getBoundingClientRect = () => makeRect(10, 20, 300, 200);
    isCreatedRef = createRef<boolean>();
    isCreatedRef.current = true;
    browserSetBoundsMock.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('ResizeObserver 触发时同步 bounds 到正确 label', () => {
    const { unmount } = renderHook(() =>
      useBrowserBoundsSync({
        label: 'neeko-browser-tab-t1',
        containerRef: { current: container },
        isCreatedRef,
      }),
    );
    act(() => resizeCallback?.());
    expect(browserSetBoundsMock).toHaveBeenCalledWith('neeko-browser-tab-t1', 10, 20, 300, 200);
    unmount();
  });

  it('差异 <2px 时跳过重复 set（diff 去抖）', () => {
    renderHook(() =>
      useBrowserBoundsSync({ label: 'L', containerRef: { current: container }, isCreatedRef }),
    );
    act(() => resizeCallback?.());
    expect(browserSetBoundsMock).toHaveBeenCalledTimes(1);

    // 位置仅偏移 1px（<2px 阈值）→ 不重复 set
    container.getBoundingClientRect = () => makeRect(11, 20, 300, 200);
    act(() => resizeCallback?.());
    expect(browserSetBoundsMock).toHaveBeenCalledTimes(1);

    // 变化超过阈值 → 再次 set
    container.getBoundingClientRect = () => makeRect(20, 20, 300, 200);
    act(() => resizeCallback?.());
    expect(browserSetBoundsMock).toHaveBeenCalledTimes(2);
  });

  it('webview 未创建（isCreated=false）时不同步', () => {
    isCreatedRef.current = false;
    renderHook(() =>
      useBrowserBoundsSync({ label: 'L', containerRef: { current: container }, isCreatedRef }),
    );
    act(() => resizeCallback?.());
    expect(browserSetBoundsMock).not.toHaveBeenCalled();
  });

  it('updateBounds 直接同步指定 rect', async () => {
    const { result, unmount } = renderHook(() =>
      useBrowserBoundsSync({ label: 'L', containerRef: { current: container }, isCreatedRef }),
    );
    await act(async () => {
      await result.current.updateBounds(makeRect(5, 6, 100, 80));
    });
    expect(browserSetBoundsMock).toHaveBeenCalledWith('L', 5, 6, 100, 80);
    unmount();
  });

  it('无 label（无 webview）时不建立 ResizeObserver 监听', () => {
    const { unmount } = renderHook(() =>
      useBrowserBoundsSync({ label: null, containerRef: { current: container }, isCreatedRef }),
    );
    expect(resizeCallback).toBeNull();
    unmount();
  });
});
