import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { setPendingPtyResize } from "./TerminalView";
import PaneToolbar from "./PaneToolbar";
import { useSplitLayout } from "../../hooks/useSplitLayout";
import type { PaneDirection, PaneId, PaneNode, SplitPathStep } from "../../types";

const MIN_PANE_WIDTH = 120;
const MIN_PANE_HEIGHT = 80;
const TOOLBAR_FADE_OUT_MS = 300;

interface SplitLayoutProps {
  layoutId: string;
  maxPanes?: number;
  renderPane: (paneId: PaneId) => React.ReactNode;
  className?: string;
  onActivePaneChange?: (paneId: PaneId) => void;
}

interface RenderNodeProps {
  node: PaneNode;
  path: SplitPathStep[];
}

function SplitLayout({ layoutId, maxPanes = 4, renderPane, className, onActivePaneChange }: SplitLayoutProps) {
  const { state, splitPane, closePane, setRatio, canSplit, setActivePaneId } = useSplitLayout(layoutId, maxPanes);
  const [recentlyBlurredPaneId, setRecentlyBlurredPaneId] = useState<PaneId | null>(null);
  const prevActivePaneRef = useRef<PaneId>(state.activePaneId);
  const paneRefs = useRef(new Map<PaneId, HTMLDivElement>());

  useEffect(() => {
    if (prevActivePaneRef.current !== state.activePaneId) {
      setRecentlyBlurredPaneId(prevActivePaneRef.current);
      const timer = setTimeout(() => {
        setRecentlyBlurredPaneId((prev) => (prev === prevActivePaneRef.current ? null : prev));
      }, TOOLBAR_FADE_OUT_MS);
      prevActivePaneRef.current = state.activePaneId;
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [state.activePaneId]);

  useEffect(() => {
    onActivePaneChange?.(state.activePaneId);
  }, [state.activePaneId, onActivePaneChange]);

  const handleSplit = useCallback(
    (paneId: PaneId, direction: PaneDirection) => {
      if (!canSplit) return;
      const paneElement = paneRefs.current.get(paneId);
      if (paneElement) {
        const rect = paneElement.getBoundingClientRect();
        if (direction === "horizontal" && rect.width < MIN_PANE_WIDTH * 2) {
          return;
        }
        if (direction === "vertical" && rect.height < MIN_PANE_HEIGHT * 2) {
          return;
        }
      }
      splitPane(paneId, direction);
    },
    [canSplit, splitPane]
  );

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
        setPendingPtyResize(true);
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
        const showToolbar = isActive || recentlyBlurredPaneId === node.paneId;

        return (
          <div
            key={node.paneId}
            ref={(el) => {
              if (el) paneRefs.current.set(node.paneId, el);
              else paneRefs.current.delete(node.paneId);
            }}
            className={`relative min-w-[120px] min-h-[80px] flex-1 flex flex-col overflow-hidden transition-shadow duration-150 ${
              state.paneCount > 1
                ? isActive
                  ? "border-2 border-[var(--border-color)] ring-1 ring-[var(--border-color)]/50 ring-inset"
                  : "border-2 border-transparent"
                : "border-0"
            }`}
            onMouseDown={() => setActivePaneId(node.paneId)}
          >
            <PaneToolbar
              visible={showToolbar}
              canSplit={canSplit}
              paneCount={state.paneCount}
              onSplitHorizontal={() => handleSplit(node.paneId, "horizontal")}
              onSplitVertical={() => handleSplit(node.paneId, "vertical")}
              onClose={() => closePane(node.paneId)}
            />
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
            className="min-w-[120px] min-h-[80px] flex flex-col overflow-hidden"
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

          <div className="min-w-[120px] min-h-[80px] flex-1 flex flex-col overflow-hidden">{renderTree({ node: node.second, path: [...path, "second"] })}</div>
        </div>
      );
    },
    [canSplit, closePane, handleSplit, recentlyBlurredPaneId, renderPane, setActivePaneId, startDrag, state.activePaneId, state.paneCount]
  );

  const tree = useMemo(() => renderTree({ node: state.root, path: [] }), [renderTree, state.root]);

  return <div className={className ?? "flex-1 min-w-0 min-h-0 flex overflow-hidden"}>{tree}</div>;
}

export default React.memo(SplitLayout);
