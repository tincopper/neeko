import { act, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { VirtualList } from '../VirtualList';

const origH = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
const origW = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');

beforeAll(() => {
  // jsdom has no layout; virtualizer reads offsetHeight/Width from the scroll
  // element. Stub them so the windowing math works in tests.
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get: () => 400,
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get: () => 400,
  });
});

afterAll(() => {
  if (origH) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', origH);
  if (origW) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', origW);
});

function renderList(count = 200) {
  const items = Array.from({ length: count }, (_, i) => `item-${i}`);
  return render(
    <VirtualList
      items={items}
      getKey={(item) => item}
      renderItem={(item) => <div data-testid="row">{item}</div>}
      estimateSize={40}
      overscan={4}
      className="overflow-auto"
      initialRect={{ width: 400, height: 400 }}
    />,
  );
}

describe('VirtualList', () => {
  it('renders only a subset of items (virtualization)', async () => {
    renderList();
    const rows = await waitFor(() => {
      const found = screen.getAllByTestId('row');
      expect(found.length).toBeGreaterThan(0);
      return found;
    });
    expect(rows.length).toBeLessThan(200);
  });

  it('reports scroll range via onRangeChange', async () => {
    const onRangeChange = vi.fn();
    const items = Array.from({ length: 200 }, (_, i) => `item-${i}`);
    render(
      <VirtualList
        items={items}
        getKey={(item) => item}
        renderItem={(item) => <div data-testid="row">{item}</div>}
        estimateSize={40}
        overscan={0}
        onRangeChange={onRangeChange}
        className="overflow-auto"
        initialRect={{ width: 400, height: 400 }}
      />,
    );
    await waitFor(() => {
      expect(onRangeChange).toHaveBeenCalled();
    });
    const [start, end] = onRangeChange.mock.calls[onRangeChange.mock.calls.length - 1];
    expect(end - start).toBeLessThan(200);
  });

  it('renders no rows when empty', () => {
    render(
      <VirtualList
        items={[]}
        getKey={(item) => item}
        renderItem={(item) => <div data-testid="row">{item}</div>}
        className="overflow-auto"
        initialRect={{ width: 400, height: 400 }}
      />,
    );
    expect(screen.queryAllByTestId('row')).toHaveLength(0);
  });

  it('forwards scroll events', async () => {
    const onScroll = vi.fn();
    const items = Array.from({ length: 200 }, (_, i) => `item-${i}`);
    render(
      <VirtualList
        items={items}
        getKey={(item) => item}
        renderItem={(item) => <div data-testid="row">{item}</div>}
        estimateSize={40}
        onScroll={onScroll}
        className="overflow-auto"
        initialRect={{ width: 400, height: 400 }}
      />,
    );
    const el = screen.getByTestId('scroll-list');
    el.dispatchEvent(new Event('scroll', { bubbles: true }));
    await waitFor(() => {
      expect(onScroll).toHaveBeenCalled();
    });
  });

  it('preserves scroll offset across a display:none round-trip (no row measurement pollution)', () => {
    // 模拟 Dock 面板 keep-alive 切换：display:none 期间容器高度 0，行元素的
    // ResizeObserver 回调会触发 resizeItem(key, 0) —— 若不防，行测量被永久
    // 污染为 0、卸载后永不重测，表现为恢复显示后列表顶部/前面整片空白。
    // 修复：隐藏时 enabled=false 主动 cleanup 行 RO；恢复时把 DOM scrollTop
    // 写回隐藏前的镜像（WKWebView 会丢，正常引擎 no-op）。
    let containerHeight = 400;
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get: () => containerHeight,
    });

    // 可捕获 callback 的 fake ResizeObserver（替换 setup.ts 的 no-op stub）
    const roCallbacks: ResizeObserverCallback[] = [];
    class ROCapture {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
      constructor(cb: ResizeObserverCallback) {
        roCallbacks.push(cb);
      }
    }
    const prevRO = globalThis.ResizeObserver;
    globalThis.ResizeObserver = ROCapture as unknown as typeof ResizeObserver;

    const scrollToCalls: ScrollToOptions[] = [];
    try {
      const items = Array.from({ length: 200 }, (_, i) => `item-${i}`);
      render(
        <VirtualList
          items={items}
          getKey={(item) => item}
          renderItem={(item) => <div data-testid="row">{item}</div>}
          estimateSize={40}
          overscan={4}
          className="overflow-auto"
          initialRect={{ width: 400, height: 400 }}
        />,
      );
      const el = screen.getByTestId('scroll-list') as HTMLElement;

      // 可控 scrollTop（jsdom 无布局，原型 getter 恒 0）
      let scrollTopValue = 0;
      Object.defineProperty(el, 'scrollTop', {
        configurable: true,
        get: () => scrollTopValue,
        set: (v: number) => {
          scrollTopValue = v;
        },
      });
      // scrollTo stub：写回同时更新真实值 + 派发 scroll（镜像浏览器行为）
      el.scrollTo = ((opts: ScrollToOptions) => {
        scrollTopValue = opts.top ?? 0;
        scrollToCalls.push(opts);
        el.dispatchEvent(new Event('scroll', { bubbles: true }));
      }) as unknown as HTMLElement['scrollTo'];

      const fireResize = () => {
        act(() => {
          for (const cb of roCallbacks)
            cb([] as unknown as ResizeObserverEntry[], {} as ResizeObserver);
        });
      };

      // 隐藏前滚动到 200（scroll 事件更新镜像）
      scrollTopValue = 200;
      act(() => {
        el.dispatchEvent(new Event('scroll', { bubbles: true }));
      });

      // 切走：容器高度 0 —— 仍隐藏时 RO 回调只标记 enabled=false，不写回
      containerHeight = 0;
      fireResize();
      expect(scrollToCalls).toEqual([]);

      // 切回：容器高度恢复 + DOM scrollTop 已被重置为 0（模拟 WKWebView 行为）
      scrollTopValue = 0;
      containerHeight = 400;
      fireResize();
      // 恢复显示后必须发生一次对镜像位置(200)的写回，且最终 DOM 停在该位置。
      // （tanstack 恢复 enabled 时自身也会向 DOM 写一次 initialOffset=0，
      //  我们的 effect 在其后执行、最终生效 —— 断言不依赖其内部调用次序。）
      expect(scrollToCalls.some((c) => c.top === 200)).toBe(true);
      expect(scrollTopValue).toBe(200);

      // 恢复后再次 resize（镜像已一致）不重复写回
      fireResize();
      expect(scrollToCalls.filter((c) => c.top === 200)).toHaveLength(1);
      expect(scrollTopValue).toBe(200);
    } finally {
      globalThis.ResizeObserver = prevRO;
      // 恢复 beforeAll 的 400 stub，避免污染后续用例
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
        configurable: true,
        get: () => 400,
      });
    }
  });
});
