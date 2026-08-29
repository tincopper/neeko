import { useEffect, useRef, type RefObject } from 'react';

/** Zone 面板命令式 handle 的最小接口（react-resizable-panels PanelImperativeHandle 子集）。 */
interface ZonePanelHandle {
  expand: () => void;
  collapse: () => void;
  resize: (size: string) => void;
}

/**
 * 通用 zone 展开/收起 + 双 rAF resize（react-resizable-panels 折叠竞态的既定解法）。
 *
 * expanded 翻转时：
 * - 展开 → panel.expand() → 双 rAF 后 resize(targetSize)：第一帧让 expand() 内部布局
 *   settle，第二帧在并发 remount（pin/unpin 触发）完成 first paint 后执行 resize，
 *   防止「pin tab 后开面板 0 宽度」竞态；
 * - 折叠 → panel.collapse()。
 *
 * 抽取自 DockLayout 左右 zone 的对称 effect（DockLayout 组件体逼近 300 行观察项，
 * 见 08-14-08-15-dock-wrapper-refactor/prd.md Follow-ups）。
 *
 * 挂起的 rAF 在 effect 清理时取消（依赖变化或卸载）：快速「展开→折叠」时，
 * 迟到的 resize 会执行在 collapse() 之后，把面板重新撑开。
 */
export function useZoneExpandCollapse(
  panelRef: RefObject<ZonePanelHandle | null>,
  expanded: boolean,
  targetSize: number,
): void {
  const expandedRef = useRef(expanded);

  useEffect(() => {
    const prev = expandedRef.current;
    expandedRef.current = expanded;
    if (prev === expanded) return;

    const panel = panelRef.current;
    if (!panel) return;

    if (!expanded) {
      panel.collapse();
      return;
    }

    panel.expand();
    let innerRaf = 0;
    const outerRaf = requestAnimationFrame(() => {
      innerRaf = requestAnimationFrame(() => {
        panelRef.current?.resize(`${targetSize}%`);
      });
    });
    return () => {
      cancelAnimationFrame(outerRaf);
      cancelAnimationFrame(innerRaf);
    };
  }, [expanded, panelRef, targetSize]);
}
