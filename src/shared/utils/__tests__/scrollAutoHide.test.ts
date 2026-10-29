import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_HIDE_DELAY_MS,
  SCROLL_IDLE_CLASS,
  createScrollIdleTag,
  initScrollAutoHide,
} from '../scrollAutoHide';

function makeScroller(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

function fireScroll(el: Element) {
  // 真实 scroll 事件不冒泡，委托监听依赖 capture 阶段
  el.dispatchEvent(new Event('scroll'));
}

describe('initScrollAutoHide', () => {
  let dispose: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    dispose = initScrollAutoHide();
  });

  afterEach(() => {
    dispose();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('滚动时为滚动容器加上 is-scrolling 类', () => {
    const el = makeScroller();
    fireScroll(el);
    expect(el.classList.contains('is-scrolling')).toBe(true);
  });

  it('最后一次滚动 3s 后移除类', () => {
    const el = makeScroller();
    fireScroll(el);
    vi.advanceTimersByTime(2999);
    expect(el.classList.contains('is-scrolling')).toBe(true);
    vi.advanceTimersByTime(1);
    expect(el.classList.contains('is-scrolling')).toBe(false);
  });

  it('持续滚动期间重置计时保持常显', () => {
    const el = makeScroller();
    fireScroll(el);
    vi.advanceTimersByTime(2000);
    fireScroll(el);
    vi.advanceTimersByTime(2999);
    expect(el.classList.contains('is-scrolling')).toBe(true);
    vi.advanceTimersByTime(1);
    expect(el.classList.contains('is-scrolling')).toBe(false);
  });

  it('多个容器独立计时互不影响', () => {
    const a = makeScroller();
    const b = makeScroller();
    fireScroll(a);
    vi.advanceTimersByTime(1500);
    fireScroll(b);
    vi.advanceTimersByTime(1500);
    expect(a.classList.contains('is-scrolling')).toBe(false);
    expect(b.classList.contains('is-scrolling')).toBe(true);
    vi.advanceTimersByTime(1500);
    expect(b.classList.contains('is-scrolling')).toBe(false);
  });

  it('非 Element target（document 自身滚动）不抛错也不加类', () => {
    expect(() => document.dispatchEvent(new Event('scroll'))).not.toThrow();
  });

  it('dispose 后停止监听并清理当前显示态', () => {
    const el = makeScroller();
    fireScroll(el);
    dispose();
    expect(el.classList.contains('is-scrolling')).toBe(false);
    fireScroll(el);
    expect(el.classList.contains('is-scrolling')).toBe(false);
    dispose = initScrollAutoHide();
  });

  it('支持自定义隐藏延迟', () => {
    dispose();
    dispose = initScrollAutoHide(500);
    const el = makeScroller();
    fireScroll(el);
    vi.advanceTimersByTime(499);
    expect(el.classList.contains('is-scrolling')).toBe(true);
    vi.advanceTimersByTime(1);
    expect(el.classList.contains('is-scrolling')).toBe(false);
  });
});

describe('createScrollIdleTag（xterm 滚动条）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('停止滚动 delayMs 后才挂 scroll-idle（滚动中保持可见）', () => {
    const el = makeScroller();
    const tag = createScrollIdleTag();

    tag.reveal(el);
    vi.advanceTimersByTime(DEFAULT_HIDE_DELAY_MS - 1);
    expect(el.classList.contains(SCROLL_IDLE_CLASS)).toBe(false);

    vi.advanceTimersByTime(1);
    expect(el.classList.contains(SCROLL_IDLE_CLASS)).toBe(true);

    tag.dispose();
  });

  it('连续滚动会重置计时（不会中途淡出）', () => {
    const el = makeScroller();
    const tag = createScrollIdleTag(1000);

    tag.reveal(el);
    vi.advanceTimersByTime(800);
    tag.reveal(el); // 又滚了一下
    vi.advanceTimersByTime(800);
    expect(el.classList.contains(SCROLL_IDLE_CLASS)).toBe(false);

    vi.advanceTimersByTime(200);
    expect(el.classList.contains(SCROLL_IDLE_CLASS)).toBe(true);

    tag.dispose();
  });

  it('reveal 立即清掉已挂的 idle 类（再次滚动要立刻可见）', () => {
    const el = makeScroller();
    const tag = createScrollIdleTag(0);

    tag.reveal(el);
    vi.advanceTimersByTime(0);
    expect(el.classList.contains(SCROLL_IDLE_CLASS)).toBe(true);

    tag.reveal(el);
    expect(el.classList.contains(SCROLL_IDLE_CLASS)).toBe(false);

    tag.dispose();
  });

  it('dispose 清计时器并移除残留类；null 元素安全忽略', () => {
    const el = makeScroller();
    const tag = createScrollIdleTag(10);

    tag.reveal(null); // 不应抛错
    tag.reveal(el);
    tag.dispose();
    vi.advanceTimersByTime(50);
    expect(el.classList.contains(SCROLL_IDLE_CLASS)).toBe(false);
  });
});
