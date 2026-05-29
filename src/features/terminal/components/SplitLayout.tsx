import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { useSplitLayout } from '@/features/editor/hooks/useSplitLayout';
import type { PaneDirection, PaneId, PaneNode, SplitPathStep } from "../../../types";

export interface SplitStateInfo {
  paneCount: number;
  canSplit: boolean;
  activePaneId: PaneId;
}

interface SplitLayoutProps {
  layoutId: string;
  maxPanes?: number;
  renderPane: (paneId: PaneId) => React.ReactNode;
  className?: string;
  onActivePaneChange?: (paneId: PaneId) => void;
  onSplitStateChange?: (info: SplitStateInfo) => void;
  onSplitHorizontal?: (cb: () => void) => void;
  onSplitVertical?: (cb: () => void) => void;
  onClosePane?: (cb: () => void) => void;
}

interface RenderNodeProps {
  node: PaneNode;
  path: SplitPathStep[];
}

function SplitLayout({ layoutId, maxPanes = 4, renderPane, className, onActivePaneChange, onSplitStateChange, onSplitHorizontal, onSplitVertical, onClosePane }: SplitLayoutProps) {
  const { state, splitPane, closePane, setRatio, canSplit, setActivePaneId } = useSplitLayout(layoutId, maxPanes);
  const paneRefs = useRef(new Map<PaneId, HTMLDivElement>());

  useEffect(() => {
    onActivePaneChange?.(state.activePaneId);
  }, [state.activePaneId, onActivePaneChange]);

  useEffect(() => {
    onSplitStateChange?.({ paneCount: state.paneCount, canSplit, activePaneId: state.activePaneId });
  }, [state.paneCount, canSplit, state.activePaneId, onSplitStateChange]);

  // Expose split handlers to parent
  useEffect(() => {
    if (!onSplitHorizontal || !onSplitVertical) return;
    onSplitHorizontal(() => {
      if (!canSplit) return;
      splitPane(state.activePaneId, "horizontal");
    });
    onSplitVertical(() => {
      if (!canSplit) return;
      splitPane(state.activePaneId, "vertical");
    });
  }, [canSplit, state.activePaneId, splitPane, onSplitHorizontal, onSplitVertical]);

  useEffect(() => {
    if (!onClosePane) return;
    onClosePane(() => {
      if (state.paneCount <= 1) return;
      closePane(state.activePaneId);
    });
  }, [state.paneCount, state.activePaneId, closePane, onClosePane]);

  const startDrag = useCallback(
    (e: React.MouseEvent<HTMLDivElement>, path: SplitPathStep[], direction: PaneDirection, container: HTMLDivElement | null) => {
      e.preventDefault();
      e.stopPropagation();
      if (!container) return;

      const onMouseMove = (ev: MouseEvent) => {
        const rect = container.getBoundingClientRect();
        const ratio =
          direction === "horizontal" ? (ev.clientX - rect.left) / rect.width : (ev.clientY - rect.top) / rect.height;
        setRatio(path, ratio);
      };

      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor = direction === "horizontal" ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [setRatio]
  );

  const renderTree = useCallback(
    ({ node, path }: RenderNodeProps): React.ReactNode => {
      if (node.type === "leaf") {
        const isActive = state.activePaneId === node.paneId;

        return (
          <div
            key={node.paneId}
            ref={(el) => {
              if (el) paneRefs.current.set(node.paneId, el);
              else paneRefs.current.delete(node.paneId);
            }}
            className={`relative min-w-0 min-h-0 flex-1 flex flex-col overflow-hidden transition-shadow duration-150 ${
              state.paneCount > 1
                ? isActive
                  ? "border-2 border-[var(--border-color)] ring-1 ring-[var(--border-color)]/50 ring-inset"
                  : "border-2 border-transparent"
                : "border-0"
            }`}
            onMouseDown={() => setActivePaneId(node.paneId)}
          >
            {renderPane(node.paneId)}
          </div>
        );
      }

      const direction = node.direction;
      const containerRef = React.createRef<HTMLDivElement>();

      return (
        <div
          key={path.join("-") || "root"}
          ref={containerRef}
          className={`relative flex min-w-0 min-h-0 flex-1 overflow-hidden ${
            direction === "horizontal" ? "flex-row" : "flex-col"
          }`}
        >
          <div
            className="min-w-0 min-h-0 flex flex-col overflow-hidden"
            style={{
              flexBasis: `${node.ratio * 100}%`,
              flexGrow: 0,
              flexShrink: 0,
            }}
          >
            {renderTree({ node: node.first, path: [...path, "first"] })}
          </div>

          <div
            className={`group relative z-10 shrink-0 ${direction === "horizontal" ? "w-3 cursor-col-resize" : "h-3 cursor-row-resize"}`}
            onMouseDown={(e) => startDrag(e, path, direction, containerRef.current)}
          >
            <div
              className={`absolute bg-transparent transition-colors group-hover:bg-accent-blue/50 ${
                direction === "horizontal"
                  ? "left-1/2 top-0 h-full w-1 -translate-x-1/2"
                  : "top-1/2 left-0 h-1 w-full -translate-y-1/2"
              }`}
            />
          </div>

          <div className="min-w-0 min-h-0 flex-1 flex flex-col overflow-hidden">{renderTree({ node: node.second, path: [...path, "second"] })}</div>
        </div>
      );
    },
    [canSplit, renderPane, setActivePaneId, startDrag, state.activePaneId, state.paneCount]
  );

  const tree = useMemo(() => renderTree({ node: state.root, path: [] }), [renderTree, state.root]);

  return <div className={className ?? "flex-1 min-w-0 min-h-0 flex overflow-hidden"}>{tree}</div>;
}

export default React.memo(SplitLayout);
