import { useState, useRef, useCallback } from "react";

export function useSideTerminalResize(initialWidth: number, onWidthChange: (width: number) => void) {
  const [sideTerminalWidth, setSideTerminalWidth] = useState(initialWidth);
  const sideResizingRef = useRef(false);
  const sideResizeStartX = useRef(0);
  const sideResizeStartWidth = useRef(initialWidth);
  const lastWidthRef = useRef(initialWidth);

  const handleSideDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    sideResizingRef.current = true;
    sideResizeStartX.current = e.clientX;
    sideResizeStartWidth.current = sideTerminalWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMouseMove = (ev: MouseEvent) => {
      if (!sideResizingRef.current) return;
      const delta = sideResizeStartX.current - ev.clientX;
      const next = Math.min(1200, Math.max(200, sideResizeStartWidth.current + delta));
      lastWidthRef.current = next;
      setSideTerminalWidth(next);
    };
    const onMouseUp = () => {
      sideResizingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      onWidthChange(lastWidthRef.current);
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [sideTerminalWidth, onWidthChange]);

  return { sideTerminalWidth, setSideTerminalWidth, handleSideDividerMouseDown };
}
