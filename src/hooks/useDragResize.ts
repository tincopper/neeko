import { useCallback, useRef, useState } from "react";

interface DragResizeState {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface UseDragResizeOptions {
  initialX: number;
  initialY: number;
  initialWidth: number;
  initialHeight: number;
  minWidth?: number;
  minHeight?: number;
}

export function useDragResize({
  initialX,
  initialY,
  initialWidth,
  initialHeight,
  minWidth = 400,
  minHeight = 300,
}: UseDragResizeOptions) {
  const [state, setState] = useState<DragResizeState>({
    x: initialX,
    y: initialY,
    width: initialWidth,
    height: initialHeight,
  });

  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number; origW: number; origH: number; mode: "move" | "resize" } | null>(null);

  const handleDragStart = useCallback(
    (e: React.MouseEvent, mode: "move" | "resize") => {
      e.preventDefault();
      e.stopPropagation();
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        origX: state.x,
        origY: state.y,
        origW: state.width,
        origH: state.height,
        mode,
      };

      const handleMouseMove = (ev: MouseEvent) => {
        if (!dragRef.current) return;
        const dx = ev.clientX - dragRef.current.startX;
        const dy = ev.clientY - dragRef.current.startY;

        if (dragRef.current.mode === "move") {
          setState((prev) => ({
            ...prev,
            x: dragRef.current!.origX + dx,
            y: dragRef.current!.origY + dy,
          }));
        } else {
          setState((prev) => ({
            ...prev,
            width: Math.max(minWidth, dragRef.current!.origW + dx),
            height: Math.max(minHeight, dragRef.current!.origH + dy),
          }));
        }
      };

      const handleMouseUp = () => {
        dragRef.current = null;
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
      };

      document.body.style.userSelect = "none";
      document.body.style.cursor = mode === "move" ? "grabbing" : "nwse-resize";
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [state.x, state.y, state.width, state.height, minWidth, minHeight]
  );

  return { state, handleDragStart };
}
