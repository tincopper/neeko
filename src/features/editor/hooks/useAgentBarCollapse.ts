import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

export interface UseAgentBarCollapseOptions {
  /** 默认折叠（用户选择：默认不展开） */
  defaultCollapsed?: boolean;
}

export interface UseAgentBarCollapseResult {
  /** 绑定到 agent 列表容器的 ref（ResizeObserver 观察目标） */
  containerRef: RefObject<HTMLDivElement>;
  /** 内容是否超出容器可用宽度（放不下 → 需要折叠能力） */
  overflowing: boolean;
  /** 当前是否折叠 */
  collapsed: boolean;
  /** 切换折叠/展开 */
  toggleCollapsed: () => void;
}

/**
 * agent 列表的折叠 + 自适应换行状态。
 *
 * 物理本质：terminal tab 下的 agent 行宽度随右侧 split 按钮组、
 * 分组宽度等动态变化。展开态使用 flex-wrap 自动换行（无滚动条），
 * 因此容器不会产生横向溢出（scrollWidth≈clientWidth），改为累加
 * 子元素固有宽度（offsetWidth）与 gap，与容器可用宽度比较判定
 * overflowing（内容放不下 → 需要折叠能力）。
 *
 * 折叠态由用户显式切换：折叠时内容更紧凑（如仅图标），内容需求
 * 宽度变小会误判"溢出消除"，故折叠态跳过自动复位（collapsedRef 保护）。
 * 展开态溢出消除（窗口变宽）后自动复位，避免无意义折叠。
 *
 * 生命周期：observer 在卸载时 disconnect，杜绝内存泄漏（维度 6）。
 */
export function useAgentBarCollapse(
  options: UseAgentBarCollapseOptions = {},
  deps: unknown[] = [],
): UseAgentBarCollapseResult {
  const { defaultCollapsed = true } = options;
  const containerRef = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  // 记录上一帧溢出状态：仅“曾溢出→现在不溢出”才复位展开，
  // 避免挂载首帧（布局未就绪/测试环境 0 宽）误冲掉默认折叠态
  const prevOverflowingRef = useRef(false);
  // 折叠态 ref：供测量回调读取最新折叠状态
  const collapsedRef = useRef(defaultCollapsed);
  useEffect(() => {
    collapsedRef.current = collapsed;
  }, [collapsed]);

  // 测量容器内容需求宽度是否超过可用宽度。
  // 提取为共享回调：ResizeObserver 与折叠/展开切换后重测共用。
  const measureOverflow = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const children = Array.from(el.children) as HTMLElement[];
    const gap = parseFloat(getComputedStyle(el).gap) || 0;
    const contentWidth =
      children.reduce((sum, c) => sum + c.offsetWidth, 0) + Math.max(0, children.length - 1) * gap;
    // 允许 1px 容差避免浮点/亚像素抖动
    const nextOverflowing = contentWidth - el.clientWidth > 1;
    setOverflowing(nextOverflowing);
    // 折叠态保护：折叠时内容变少会让内容需求宽度小于容器宽度，
    // 误判为“溢出消除”；折叠态由用户显式展开，跳过自动复位。
    // 展开态溢出消除后自动复位（无折叠按钮态）。
    if (!collapsedRef.current && prevOverflowingRef.current && !nextOverflowing) {
      setCollapsed(false);
    }
    prevOverflowingRef.current = nextOverflowing;
  }, []);

  // 主测量：ResizeObserver 观察容器尺寸变化（面板拖动/分组宽度变化）。
  // deps 变化（如 agent 数量增减）时重建 observer 并立即重测：
  // ResizeObserver 只观察容器自身尺寸，内容宽度变化不会自动触发。
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    measureOverflow();
    const ro = new ResizeObserver(measureOverflow);
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  // 折叠/展开切换后立即重新测量：折叠态内容更紧凑（宽度变小）、
  // 展开态显示完整内容（宽度变大），内容宽度变化不会自动触发 ResizeObserver
  useEffect(() => {
    measureOverflow();
  }, [collapsed, measureOverflow]);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => !prev);
  }, []);

  return { containerRef, overflowing, collapsed, toggleCollapsed };
}
