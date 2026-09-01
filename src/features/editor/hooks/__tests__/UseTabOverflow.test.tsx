import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Tab } from '@/shared/types/tab';

import { useTabOverflow } from '../useTabOverflow';

const makeTab = (id: string, title: string): Tab => ({
  id,
  projectId: 'p1',
  title,
  order: 0,
  data: {
    kind: 'file',
    filePath: title,
    fileName: title,
    content: { path: title, content: '', size: 0, is_binary: false },
    isDirty: false,
  },
});

/** 模拟布局：容器 clientWidth 固定，tab 自然宽度按标题区分（three.ts 更宽） */
const mockLayout = (containerWidth: number) => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(containerWidth);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const width = (this.textContent ?? '').includes('three.ts') ? 150 : 100;
    return {
      width,
      height: 24,
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: width,
      bottom: 24,
      toJSON: () => ({}),
    } as DOMRect;
  });
};

afterEach(() => {
  vi.restoreAllMocks();
});

/** 挂载容器与 tab 包装元素，使 ref 注册与宽度测量真实发生，并捕获 hook 返回值 */
function renderUseTabOverflow(
  tabs: Tab[],
  options: {
    pinnedTabIds?: string[];
    activeTabId?: string | null;
    hasPlusButton?: boolean;
    containerWidth?: number;
  } = {},
) {
  const {
    pinnedTabIds = [],
    activeTabId = null,
    hasPlusButton = false,
    containerWidth = 600,
  } = options;
  mockLayout(containerWidth);

  const captured: { current: ReturnType<typeof useTabOverflow> | null } = { current: null };

  function Harness() {
    const result = useTabOverflow({ tabs, pinnedTabIds, activeTabId, hasPlusButton });
    captured.current = result;
    return (
      <div ref={result.containerRef}>
        {result.renderedTabs.map((tab) => (
          <div key={tab.id} ref={result.getTabSizeRef(tab.id)}>
            {tab.title}
          </div>
        ))}
      </div>
    );
  }

  render(<Harness />);
  return captured;
}

describe('useTabOverflow — 溢出测量收敛', () => {
  it('全部放得下 → 全部可见，无隐藏', () => {
    const tabs = [makeTab('a', 'a.ts'), makeTab('b', 'b.ts'), makeTab('c', 'three.ts')];
    const { current } = renderUseTabOverflow(tabs, { containerWidth: 600 });

    expect(current!.renderedTabs.map((t) => t.id)).toEqual(['a', 'b', 'c']);
    expect(current!.hiddenTabs).toEqual([]);
  });

  it('放不下 → 宽度收敛后隐藏放不下的 tab', () => {
    const tabs = [makeTab('a', 'a.ts'), makeTab('b', 'b.ts'), makeTab('c', 'three.ts')];
    // 100 + (4 + 100) + (4 + 150) = 358 > 300 → c 隐藏
    const { current } = renderUseTabOverflow(tabs, { containerWidth: 300 });

    expect(current!.renderedTabs.map((t) => t.id)).toEqual(['a', 'b']);
    expect(current!.hiddenTabs.map((t) => t.id)).toEqual(['c']);
  });

  it('pinned 豁免溢出，普通 tab 按剩余空间计算', () => {
    const tabs = [makeTab('a', 'a.ts'), makeTab('b', 'b.ts')];
    // pinned a(100) + gap + b(100) = 204 > 200 → b 隐藏；a 恒可见
    const { current } = renderUseTabOverflow(tabs, {
      pinnedTabIds: ['a'],
      containerWidth: 200,
    });

    expect(current!.renderedTabs.map((t) => t.id)).toEqual(['a']);
    expect(current!.hiddenTabs.map((t) => t.id)).toEqual(['b']);
  });

  it('getTabSizeRef 对同一 tab id 返回稳定引用（避免 ref 抖动）', () => {
    const tabs = [makeTab('a', 'a.ts')];
    const { current } = renderUseTabOverflow(tabs, { containerWidth: 600 });

    expect(current!.getTabSizeRef('a')).toBe(current!.getTabSizeRef('a'));
  });

  it('激活 tab 强制可见（用缓存宽度计算，即使当前未渲染）', () => {
    const tabs = [makeTab('a', 'a.ts'), makeTab('b', 'b.ts'), makeTab('c', 'three.ts')];
    // 预算 300 - 150(c 激活) = 150：a(100) 可见，b(104) 放不下 → 隐藏
    const { current } = renderUseTabOverflow(tabs, {
      activeTabId: 'c',
      containerWidth: 300,
    });

    expect(current!.renderedTabs.map((t) => t.id)).toEqual(['a', 'c']);
    expect(current!.hiddenTabs.map((t) => t.id)).toEqual(['b']);
  });
});
