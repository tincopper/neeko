import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAgentBarCollapse } from '../useAgentBarCollapse';

class ROMock {
  static instances: ROMock[] = [];
  callback: ResizeObserverCallback;
  observed: Element[] = [];
  disconnected = false;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    ROMock.instances.push(this);
  }
  observe(el: Element) {
    this.observed.push(el);
  }
  unobserve() {}
  disconnect() {
    this.disconnected = true;
  }
}

/** 测试宿主：containerRef 绑定到含子元素的真实 div，暴露 hook 状态供断言 */
function TestHost({
  defaultCollapsed,
  childCount = 3,
  childWidth = 60,
  withGap = true,
}: {
  defaultCollapsed?: boolean;
  childCount?: number;
  childWidth?: number;
  withGap?: boolean;
}) {
  const { containerRef, overflowing, collapsed, toggleCollapsed } = useAgentBarCollapse({
    defaultCollapsed,
  });
  return (
    <div>
      <div
        ref={containerRef}
        data-testid="host"
        style={{ display: 'flex', ...(withGap ? { gap: 4 } : {}) }}
      >
        {Array.from({ length: childCount }, (_, i) => (
          <span key={i} data-testid={`child-${i}`} style={{ width: childWidth, flexShrink: 0 }} />
        ))}
      </div>
      <div data-testid="spy" data-overflowing={overflowing} data-collapsed={collapsed} />
      {overflowing && (
        <button data-testid="toggle" onClick={toggleCollapsed}>
          toggle
        </button>
      )}
    </div>
  );
}

/** 设置 host 的 clientWidth 与子元素 offsetWidth 并触发 ROMock 回调 */
function setSizeAndFire(host: HTMLElement, clientWidth: number, childWidths: number[]) {
  Object.defineProperty(host, 'clientWidth', { configurable: true, value: clientWidth });
  const children = screen.queryAllByTestId(/^child-/);
  children.forEach((c, i) => {
    Object.defineProperty(c, 'offsetWidth', {
      configurable: true,
      value: childWidths[i] ?? 60,
    });
  });
  act(() => {
    ROMock.instances.forEach((ro) => ro.callback([], ro as unknown as ResizeObserver));
  });
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ROMock);
});

afterEach(() => {
  ROMock.instances = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useAgentBarCollapse', () => {
  it('默认折叠，内容需求宽度超过容器宽度时 overflowing=true 且保持折叠', () => {
    render(<TestHost />);
    const host = screen.getByTestId('host');
    const spy = screen.getByTestId('spy');

    // 子元素总宽 180 > 容器 100 → 溢出
    setSizeAndFire(host, 100, [60, 60, 60]);
    expect(spy.dataset.overflowing).toBe('true');
    expect(spy.dataset.collapsed).toBe('true');
    // 折叠按钮存在
    expect(screen.getByTestId('toggle')).toBeInTheDocument();
  });

  it('宽度充足时无溢出、无折叠按钮', () => {
    render(<TestHost />);
    const host = screen.getByTestId('host');
    const spy = screen.getByTestId('spy');

    // 子元素总宽 180 < 容器 300 → 不溢出
    setSizeAndFire(host, 300, [60, 60, 60]);
    expect(spy.dataset.overflowing).toBe('false');
    expect(screen.queryByTestId('toggle')).not.toBeInTheDocument();
  });

  it('空容器（无子元素）不溢出', () => {
    render(<TestHost childCount={0} />);
    const host = screen.getByTestId('host');
    const spy = screen.getByTestId('spy');

    setSizeAndFire(host, 100, []);
    expect(spy.dataset.overflowing).toBe('false');
  });

  it('gap 样式不可用时回退 0，内容恰好放得下时不误判溢出', () => {
    render(<TestHost withGap={false} />);
    const host = screen.getByTestId('host');
    const spy = screen.getByTestId('spy');

    // 无 gap（getComputedStyle().gap 为 'normal'，parseFloat=NaN → 0）：
    // 内容总宽 180 == 容器 180 → 不溢出
    setSizeAndFire(host, 180, [60, 60, 60]);
    expect(spy.dataset.overflowing).toBe('false');
  });

  it('1px 容差：恰好差 1px 不溢出，超 1px 才溢出', () => {
    render(<TestHost withGap={false} childCount={2} />);
    const host = screen.getByTestId('host');
    const spy = screen.getByTestId('spy');

    // 内容总宽 120；容器 119 → 差 1 → 不溢出
    setSizeAndFire(host, 119, [60, 60]);
    expect(spy.dataset.overflowing).toBe('false');
    // 容器 118 → 差 2 → 溢出
    setSizeAndFire(host, 118, [60, 60]);
    expect(spy.dataset.overflowing).toBe('true');
  });

  it('toggleCollapsed 在展开/折叠间切换', () => {
    render(<TestHost />);
    const host = screen.getByTestId('host');
    const spy = screen.getByTestId('spy');
    setSizeAndFire(host, 100, [60, 60, 60]);

    const toggle = screen.getByTestId('toggle');
    act(() => toggle.click());
    expect(spy.dataset.collapsed).toBe('false');
    act(() => toggle.click());
    expect(spy.dataset.collapsed).toBe('true');
  });

  it('折叠态下溢出消除后保持折叠（折叠态由用户显式展开）', () => {
    render(<TestHost />);
    const host = screen.getByTestId('host');
    const spy = screen.getByTestId('spy');

    setSizeAndFire(host, 100, [60, 60, 60]);
    expect(spy.dataset.overflowing).toBe('true');
    // 默认折叠态保持（collapsed=true）

    // 容器变宽 → 溢出消除，但折叠态保护：保持折叠、不自动展开
    setSizeAndFire(host, 300, [60, 60, 60]);
    expect(spy.dataset.overflowing).toBe('false');
    expect(spy.dataset.collapsed).toBe('true');
  });

  it('展开态溢出消除后保持展开（不产生折叠按钮）', () => {
    render(<TestHost defaultCollapsed={false} />);
    const host = screen.getByTestId('host');
    const spy = screen.getByTestId('spy');

    setSizeAndFire(host, 100, [60, 60, 60]);
    expect(spy.dataset.overflowing).toBe('true');
    expect(spy.dataset.collapsed).toBe('false');

    // 展开态容器变宽 → 溢出消除 → 保持展开
    setSizeAndFire(host, 300, [60, 60, 60]);
    expect(spy.dataset.overflowing).toBe('false');
    expect(spy.dataset.collapsed).toBe('false');
  });

  it('卸载时 disconnect observer（无内存泄漏）', () => {
    const { unmount } = render(<TestHost />);
    expect(ROMock.instances.length).toBeGreaterThan(0);
    unmount();
    expect(ROMock.instances.every((ro) => ro.disconnected)).toBe(true);
  });

  it('defaultCollapsed=false 时初始为展开态（且溢出时也不自动折叠）', () => {
    render(<TestHost defaultCollapsed={false} />);
    const host = screen.getByTestId('host');
    const spy = screen.getByTestId('spy');
    setSizeAndFire(host, 100, [60, 60, 60]);
    expect(spy.dataset.overflowing).toBe('true');
    expect(spy.dataset.collapsed).toBe('false');
  });
});
