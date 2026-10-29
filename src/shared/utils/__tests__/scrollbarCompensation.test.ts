import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  applyScrollbarCompensation,
  contentBoxWidthOf,
  observeScrollbarCompensation,
  scrollbarWidthOf,
} from '@/shared/utils/scrollbarCompensation';

/** 模拟「class 基线内边 + 实时读回」的 computed style。 */
function mockPadding(el: HTMLElement, padding: { left: number; right: number }): void {
  vi.spyOn(window, 'getComputedStyle').mockImplementation(
    () =>
      ({
        paddingLeft: `${el.style.paddingLeft ? parseFloat(el.style.paddingLeft) : padding.left}px`,
        paddingRight: `${el.style.paddingRight ? parseFloat(el.style.paddingRight) : padding.right}px`,
        getPropertyValue(prop: string) {
          const inline = el.style.getPropertyValue(prop);
          if (inline) return inline;
          if (prop === 'padding-left') return `${padding.left}px`;
          if (prop === 'padding-right') return `${padding.right}px`;
          return '';
        },
      }) as unknown as CSSStyleDeclaration,
  );
}

/** jsdom 无布局：直接给元素钉住宽高。 */
function mockBox(el: HTMLElement, box: { offsetWidth: number; clientWidth: number }): void {
  Object.defineProperty(el, 'offsetWidth', { value: box.offsetWidth, configurable: true });
  Object.defineProperty(el, 'clientWidth', { value: box.clientWidth, configurable: true });
}

function makeEl(): HTMLDivElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('scrollbarWidthOf', () => {
  it('偏移宽 - 客户端宽 = 滚动条占位', () => {
    expect(scrollbarWidthOf({ offsetWidth: 300, clientWidth: 289 })).toBe(11);
  });

  it('无滚动条 / overlay 滚动条为 0，且不会返回负数', () => {
    expect(scrollbarWidthOf({ offsetWidth: 300, clientWidth: 300 })).toBe(0);
    expect(scrollbarWidthOf({ offsetWidth: 300, clientWidth: 320 })).toBe(0);
  });
});

describe('contentBoxWidthOf', () => {
  it('扣掉左右内边后的可用宽度（clientWidth 含 padding）', () => {
    const el = makeEl();
    mockBox(el, { offsetWidth: 800, clientWidth: 800 });
    mockPadding(el, { left: 0, right: 13 });
    expect(contentBoxWidthOf(el)).toBe(787);
  });

  it('内边大于 clientWidth 时钳到 0（不会出现负宽度）', () => {
    const el = makeEl();
    mockBox(el, { offsetWidth: 20, clientWidth: 20 });
    mockPadding(el, { left: 30, right: 30 });
    expect(contentBoxWidthOf(el)).toBe(0);
  });
});

describe('applyScrollbarCompensation', () => {
  it('widen：右内边 = 基线 - 占位（内容变宽）', () => {
    const el = makeEl();
    mockBox(el, { offsetWidth: 300, clientWidth: 289 });
    mockPadding(el, { left: 24, right: 24 });

    expect(applyScrollbarCompensation(el, 'widen')).toBe(11);
    expect(el.style.paddingRight).toBe('13px');
  });

  it('widen 幂等：重复调用不会越减越多（每次从 class 基线重算）', () => {
    const el = makeEl();
    mockBox(el, { offsetWidth: 300, clientWidth: 289 });
    mockPadding(el, { left: 24, right: 24 });

    applyScrollbarCompensation(el, 'widen');
    applyScrollbarCompensation(el, 'widen');
    applyScrollbarCompensation(el, 'widen');
    expect(el.style.paddingRight).toBe('13px');
  });

  it('widen：无滚动条时清掉 inline，回到 class 基线（短内容不补偿）', () => {
    const el = makeEl();
    mockBox(el, { offsetWidth: 300, clientWidth: 300 });
    mockPadding(el, { left: 24, right: 24 });

    expect(applyScrollbarCompensation(el, 'widen')).toBe(0);
    expect(el.style.paddingRight).toBe('');
  });

  it('widen：占位大于基线时保底 0，不产生负内边（非法声明会被引擎丢弃）', () => {
    const el = makeEl();
    mockBox(el, { offsetWidth: 300, clientWidth: 285 });
    mockPadding(el, { left: 24, right: 4 });

    applyScrollbarCompensation(el, 'widen');
    expect(el.style.paddingRight).toBe('0px');
  });

  it('center：左内边 = 基线 + 占位（右内边为 0 的容器靠补左侧居中）', () => {
    const el = makeEl();
    mockBox(el, { offsetWidth: 300, clientWidth: 289 });
    mockPadding(el, { left: 0, right: 0 });

    expect(applyScrollbarCompensation(el, 'center')).toBe(11);
    expect(el.style.paddingLeft).toBe('11px');
    expect(el.style.paddingRight).toBe('');
  });
});

describe('observeScrollbarCompensation', () => {
  it('挂载即补偿，dispose 时断开观察并移除 inline 调整', () => {
    const el = makeEl();
    mockBox(el, { offsetWidth: 300, clientWidth: 289 });
    mockPadding(el, { left: 24, right: 24 });

    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(private cb: () => void) {
          this.cb = cb;
        }
        observe = observe;
        disconnect = disconnect;
      },
    );

    const dispose = observeScrollbarCompensation(el, 'widen');
    expect(observe).toHaveBeenCalledWith(el);
    expect(el.style.paddingRight).toBe('13px');

    dispose();
    expect(disconnect).toHaveBeenCalled();
    expect(el.style.paddingRight).toBe('');

    vi.unstubAllGlobals();
  });
});
