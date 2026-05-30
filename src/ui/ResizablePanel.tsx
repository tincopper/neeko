import React, { useState, useCallback, useRef, useEffect } from "react";
import { cn } from '@/lib/utils';

interface ResizablePanelProps {
  open: boolean;
  onClose: () => void;
  minWidth?: number;
  maxWidth?: number;
  defaultWidth?: number;
  onWidthPersist?: (width: number) => void;
  children: React.ReactNode;
  className?: string;
}

const MIN_WIDTH = 400;
const MAX_WIDTH_RATIO = 0.8;
const DEFAULT_WIDTH = 672;

export function ResizablePanel({
  open,
  onClose,
  minWidth = MIN_WIDTH,
  maxWidth: maxWidthProp,
  defaultWidth = DEFAULT_WIDTH,
  onWidthPersist,
  children,
  className,
}: ResizablePanelProps) {
  const [width, setWidth] = useState(defaultWidth);
  const panelRef = useRef<HTMLDivElement>(null);

  const maxWidth = maxWidthProp ?? 
    (typeof window !== "undefined" ? Math.floor(window.innerWidth * MAX_WIDTH_RATIO) : 1200);

  useEffect(() => {
    setWidth((w) => Math.min(w, maxWidth));
  }, [maxWidth]);

  // Guard against userSelect/cursor leak when the panel unmounts (e.g. `open`
  // flips to false) while a resize drag is still in progress.
  useEffect(() => {
    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, []);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = width;

      const onMouseMove = (ev: MouseEvent) => {
        const delta = startX - ev.clientX;
        const next = Math.min(maxWidth, Math.max(minWidth, startWidth + delta));
        setWidth(next);
      };

      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        if (onWidthPersist) {
          onWidthPersist(width);
        }
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [width, minWidth, maxWidth, onWidthPersist]
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      <div
        ref={panelRef}
        className={cn(
          "relative ml-auto flex flex-col bg-bg-secondary border-l border-border shadow-xl",
          className
        )}
        style={{ width: `${width}px` }}
      >
        <div
          className="absolute top-0 left-[-5px] w-[10px] h-full cursor-col-resize z-10 hover:bg-accent/30 active:bg-accent/50 transition-colors"
          onMouseDown={handleResizeStart}
        />

        {children}
      </div>
    </div>
  );
}

export function useResizableWidth(
  defaultWidth: number = DEFAULT_WIDTH,
  minWidth: number = MIN_WIDTH,
  maxWidth?: number
) {
  const resolvedMax = maxWidth ?? 
    (typeof window !== "undefined" ? Math.floor(window.innerWidth * MAX_WIDTH_RATIO) : 1200);
  const [width, setWidth] = useState(defaultWidth);

  const clampWidth = useCallback(
    (w: number) => Math.min(resolvedMax, Math.max(minWidth, w)),
    [minWidth, resolvedMax]
  );

  return { width, setWidth, clampWidth };
}
