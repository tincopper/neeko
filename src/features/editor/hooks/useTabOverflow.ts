import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';

import type { Tab } from '@/shared/types/tab';

import { computeTabOverflow, type TabOverflowResult } from '../tabOverflow';

/** tab 项间距（对应容器 gap-1） */
const TAB_GAP = 4;
/** 尾部「+」按钮占位宽度（w-6 + gap-1） */
const PLUS_BUTTON_WIDTH = 28;
/** 溢出「⋯」按钮占位宽度（w-6 + gap-1） */
const OVERFLOW_BUTTON_WIDTH = 28;

const EMPTY_OVERFLOW: TabOverflowResult = { visibleIds: [], hiddenIds: [] };

interface UseTabOverflowParams {
  tabs: Tab[];
  pinnedTabIds: string[];
  activeTabId: string | null;
  /** 尾部是否渲染「+」按钮（需扣除其占位宽度） */
  hasPlusButton: boolean;
}

interface UseTabOverflowResult {
  /** 绑定到 tab 栏滚动容器（溢出测量的观察目标） */
  containerRef: RefObject<HTMLDivElement>;
  /** 获取 tab 渲染包装元素的稳定 ref 回调（per-tab 缓存，引用恒定） */
  getTabSizeRef: (tabId: string) => (el: HTMLElement | null) => void;
  /** 溢出计算后应渲染的 tab（pinned 恒可见 + 可见普通 tab，激活 tab 已强制包含） */
  renderedTabs: Tab[];
  /** 被挤出 tab 栏、应收进下拉的 tab */
  hiddenTabs: Tab[];
}

/**
 * Tab 栏溢出测量与计算。
 *
 * 收敛机制：宽度缓存 —— 已渲染 tab 实测更新，隐藏（未渲染）tab 沿用缓存；
 * 未测过的 tab 宽度记 0 必判可见 → 渲染后下一轮测得真实宽度 → 溢出集合收敛。
 * 容器 clientWidth <= 0（未完成布局 / jsdom）时降级为全部可见，待
 * ResizeObserver 上报真实尺寸后再收敛。
 */
export function useTabOverflow({
  tabs,
  pinnedTabIds,
  activeTabId,
  hasPlusButton,
}: UseTabOverflowParams): UseTabOverflowResult {
  const containerRef = useRef<HTMLDivElement>(null);
  const tabSizeRefs = useRef(new Map<string, HTMLElement>());
  /** tab 自然宽度缓存：隐藏（未渲染）的 tab 沿用上次测量值 */
  const measuredWidths = useRef(new Map<string, number>());
  // per-tab 稳定 ref 回调缓存：TabBar 每帧渲染拿到同一函数引用，
  // 避免 React 对 wrapper 反复 detach/attach（内联箭头函数每帧新建的问题）。
  const tabSizeRefCallbacks = useRef(new Map<string, (el: HTMLElement | null) => void>());
  const [overflow, setOverflow] = useState<TabOverflowResult>(EMPTY_OVERFLOW);

  // pinned / 普通分组（pinned 永不溢出，仅普通 tab 参与溢出计算）
  const { pinnedTabs, normalTabs } = useMemo(() => {
    const pinned: Tab[] = [];
    const normal: Tab[] = [];
    for (const tab of tabs) {
      (pinnedTabIds.includes(tab.id) ? pinned : normal).push(tab);
    }
    return { pinnedTabs: pinned, normalTabs: normal };
  }, [tabs, pinnedTabIds]);

  const visibleIdSet = useMemo(() => new Set(overflow.visibleIds), [overflow.visibleIds]);
  const renderedTabs = useMemo(
    () => tabs.filter((tab) => pinnedTabIds.includes(tab.id) || visibleIdSet.has(tab.id)),
    [tabs, pinnedTabIds, visibleIdSet],
  );
  const hiddenTabs = useMemo(
    () =>
      overflow.hiddenIds
        .map((id) => tabs.find((tab) => tab.id === id))
        .filter((tab): tab is Tab => tab !== undefined),
    [overflow.hiddenIds, tabs],
  );

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const measure = () => {
      // 1. 从当前渲染的 tab 收集最新宽度（隐藏 tab 保持缓存值不变）
      for (const [id, el] of tabSizeRefs.current) {
        measuredWidths.current.set(id, el.getBoundingClientRect().width);
      }
      // 2. 清理已移除 tab 的缓存（宽度与 ref 回调一并回收）
      for (const id of measuredWidths.current.keys()) {
        if (!tabs.some((tab) => tab.id === id)) {
          measuredWidths.current.delete(id);
          tabSizeRefCallbacks.current.delete(id);
        }
      }

      const containerWidth = container.clientWidth;
      if (containerWidth <= 0) {
        // 宽度未知（未完成布局 / jsdom）→ 降级为全部可见，避免误把所有 tab 收进下拉
        setOverflow((prev) =>
          prev.hiddenIds.length === 0 && prev.visibleIds.length === normalTabs.length
            ? prev
            : { visibleIds: normalTabs.map((tab) => tab.id), hiddenIds: [] },
        );
        return;
      }

      // 3. 未测量过的 tab 宽度记 0 → 一定被判为可见 → 渲染后获得真实宽度，
      //    下一轮收敛；隐藏 tab 用缓存宽度参与强制可见 / 重排计算。
      const widthOf = (tab: Tab) => measuredWidths.current.get(tab.id) ?? 0;
      const result = computeTabOverflow({
        tabs: normalTabs.map((tab) => ({ id: tab.id, width: widthOf(tab) })),
        pinnedTabs: pinnedTabs.map((tab) => ({ id: tab.id, width: widthOf(tab) })),
        containerWidth: containerWidth - (hasPlusButton ? PLUS_BUTTON_WIDTH : 0),
        activeTabId,
        overflowButtonWidth: OVERFLOW_BUTTON_WIDTH,
        gap: TAB_GAP,
      });
      setOverflow((prev) =>
        prev.visibleIds.join('\u0000') === result.visibleIds.join('\u0000') &&
        prev.hiddenIds.join('\u0000') === result.hiddenIds.join('\u0000')
          ? prev
          : result,
      );
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
    // renderedTabs 入 deps：首轮宽度缓存为空（tab 未渲染无法测量）→ 判全部
    // 可见 → 渲染后重测得到真实宽度 → 溢出集合收敛，此后不再变化。
  }, [tabs, normalTabs, pinnedTabs, renderedTabs, activeTabId, hasPlusButton]);

  const getTabSizeRef = useCallback((tabId: string) => {
    let cb = tabSizeRefCallbacks.current.get(tabId);
    if (!cb) {
      cb = (el: HTMLElement | null) => {
        if (el) {
          tabSizeRefs.current.set(tabId, el);
        } else {
          tabSizeRefs.current.delete(tabId);
        }
      };
      tabSizeRefCallbacks.current.set(tabId, cb);
    }
    return cb;
  }, []);

  return { containerRef, getTabSizeRef, renderedTabs, hiddenTabs };
}
