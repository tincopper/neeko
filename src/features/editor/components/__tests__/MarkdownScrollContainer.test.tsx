import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import MarkdownScrollContainer from '@/features/editor/components/MarkdownScrollContainer';

/**
 * 滚动条占位补偿的**落地**断言（机制本身在 `scrollbarCompensation.test.ts`）：
 * 补偿值由 hook 实测写入 inline style，类名只保留 Tailwind 基线（`px-6`），
 * 不允许把 `calc(… - var(…))` 的算术重新写回类名。
 */
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function stubLayout(box: { offsetWidth: number; clientWidth: number }, padding = 24): void {
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get: () => box.offsetWidth,
  });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => box.clientWidth,
  });
  vi.spyOn(window, 'getComputedStyle').mockImplementation(
    () =>
      ({
        paddingLeft: `${padding}px`,
        paddingRight: `${padding}px`,
        getPropertyValue: (prop: string) =>
          prop === 'padding-left' || prop === 'padding-right' ? `${padding}px` : '',
      }) as unknown as CSSStyleDeclaration,
  );
}

function scroller(): HTMLElement | null {
  // eslint-disable-next-line testing-library/no-node-access -- 结构断言：滚动容器是内容节点的直接父节点
  return screen.getByText('body').parentElement;
}

describe('MarkdownScrollContainer', () => {
  it('有滚动条时按实测占位减右内边（左 24 / 右 24→13）', () => {
    stubLayout({ offsetWidth: 600, clientWidth: 589 }); // 占位 11px
    render(
      <MarkdownScrollContainer tabKey="project::main" tabId="tab-1" content="body">
        <p>body</p>
      </MarkdownScrollContainer>,
    );
    expect(scroller()).toHaveClass('px-6');
    expect(scroller()?.style.paddingRight).toBe('13px');
  });

  it('内容不足一屏（无滚动条）时不补偿，回到 class 基线', () => {
    stubLayout({ offsetWidth: 600, clientWidth: 600 });
    render(
      <MarkdownScrollContainer tabKey="project::main" tabId="tab-2" content="body">
        <p>body</p>
      </MarkdownScrollContainer>,
    );
    expect(scroller()?.style.paddingRight).toBe('');
  });

  it('类名里不再出现补偿算术（防回退）', () => {
    stubLayout({ offsetWidth: 600, clientWidth: 589 });
    render(
      <MarkdownScrollContainer tabKey="project::main" tabId="tab-3" content="body">
        <p>body</p>
      </MarkdownScrollContainer>,
    );
    expect(scroller()?.className).not.toContain('calc(');
  });
});
