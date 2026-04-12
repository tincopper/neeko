import { useState, useRef, useCallback } from "react";
import { setPendingPtyResize } from "../components/terminal/TerminalView";

export function useSideTerminalResize(
  initialWidth: number,
  onWidthChange: (width: number) => void,
) {
  const [sideTerminalWidth, setSideTerminalWidth] = useState(initialWidth);
  const lastWidthRef = useRef(initialWidth);
  const rafRef = useRef<number | null>(null);
  const startXRef = useRef(0);
  const startWidthRef = useRef(initialWidth);

  const handleSideDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    startXRef.current = e.clientX;
    startWidthRef.current = lastWidthRef.current;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMouseMove = (ev: MouseEvent) => {
      const delta = startXRef.current - ev.clientX;
      const next = Math.min(1200, Math.max(200, startWidthRef.current + delta));
      lastWidthRef.current = next;
      if (rafRef.current !== null) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        setSideTerminalWidth(lastWidthRef.current);
      });
    };

    const onMouseUp = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);

      // 标记需要 PTY resize：等 React 渲染 + DOM 更新后
      // ResizeObserver 自然触发时会读到正确尺寸并通知 PTY
      setPendingPtyResize(true);
      setSideTerminalWidth(lastWidthRef.current);
      onWidthChange(lastWidthRef.current);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [onWidthChange]);

  return { sideTerminalWidth, setSideTerminalWidth, handleSideDividerMouseDown };
}
