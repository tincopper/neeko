import React, { useCallback, useEffect, useRef } from "react";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import DockBar from "./DockBar";
import DockZone from "./DockZone";
import { useDockStore } from "@/store/dockStore";
import { useAppStore } from "@/store/appStore";
import { dockPanelRegistry } from "@/registries/dockPanels";

interface DockLayoutProps {
  children: React.ReactNode;
  /** Left toolbar footer slot for app-level actions */
  toolbarFooterLeft?: React.ReactNode;
}

/**
 * Keyboard shortcut panel index. Ctrl+1..2 toggle left-side panels.
 * Extend this list as left panels are added.
 */
const SHORTCUT_PANEL_IDS: string[] = [
  "projects",
  "skills",
];

/**
 * Top-level dock layout container.
 *
 * Implements IDEA 2026 Islands design: bg-primary acts as the "sea",
 * each panel is a floating "island" with rounded corners, borders,
 * and padding gaps between islands.
 *
 * Composes DockBar (left & right) + resizable panel group (left, center, right).
 * All dock state is managed internally via useDockStore -- zero state props needed.
 *
 * Supports keyboard shortcuts (Ctrl+1..2) for left panel toggling.
 */
const DockLayout: React.FC<DockLayoutProps> = ({
  children,
  toolbarFooterLeft,
}) => {
  const togglePanel = useDockStore((s) => s.togglePanel);

  const leftExpanded = useDockStore(
    (s) => s.zones.left?.expanded ?? true,
  );

  const rightExpanded = useDockStore(
    (s) => s.zones.right?.expanded ?? false,
  );

  const rightActivePanelId = useDockStore(
    (s) => s.zones.right?.activePanelId ?? null,
  );

  const rightDefaultSize = rightActivePanelId === 'browser' ? '50%' : '18%';

  const setLeftPanelWidth = useAppStore((s) => s.setLeftPanelWidth);

  const leftPanelRef = useRef<HTMLDivElement>(null);

  // ResizeObserver: fires on mount (initial size) + every resize drag.
  // Re-runs when leftExpanded toggles so the observer re-attaches after expand.
  useEffect(() => {
    if (!leftExpanded) {
      setLeftPanelWidth(0);
      return;
    }
    const el = leftPanelRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      setLeftPanelWidth(width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [leftExpanded, setLeftPanelWidth]);

  const rightPanelIds = useDockStore(
    (s) => s.zones.right?.panels ?? [],
  );

  const rightVisible = rightPanelIds.length > 0 && rightExpanded;

  // -- Keyboard shortcuts (Ctrl+1..2 -> toggle left panel) --
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.metaKey && !e.altKey) {
        const digit = parseInt(e.key, 10);
        if (digit >= 1 && digit <= SHORTCUT_PANEL_IDS.length) {
          const panelId = SHORTCUT_PANEL_IDS[digit - 1];
          if (panelId && dockPanelRegistry[panelId]) {
            e.preventDefault();
            togglePanel(panelId);
          }
        }
      }
    },
    [togglePanel],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div className="flex flex-1 min-h-0">
      {/* Left toolbar column: icon bar + optional footer */}
      <div className="flex flex-col shrink-0">
        <DockBar side="left" />
        {toolbarFooterLeft && (
          <>
            <div className="flex justify-center py-1.5">
              <div className="w-5 h-px bg-border" />
            </div>
            <div className="flex flex-col items-center gap-0.5 pb-1">
              {toolbarFooterLeft}
            </div>
          </>
        )}
      </div>

      {/* Nested resizable layout: left dock | (center editor + right dock)
          Outer group isolates left from center/right so dragging the right
          handle cannot squeeze the left panel. */}
      <ResizablePanelGroup
        orientation="horizontal"
        id="neeko-main"
        className="flex-1"
      >
        {/* Left dock zone (island) */}
        {leftExpanded && (
          <ResizablePanel
            id="left-zone"
            defaultSize="18%"
            minSize="12%"
            maxSize="35%"
            className="py-1 pr-0.5"
            elementRef={leftPanelRef}
          >
            <DockZone zoneId="left" />
          </ResizablePanel>
        )}

        {leftExpanded && (
          <ResizableHandle id="handle-left-center" withHandle />
        )}

        {/* Inner group: center editor + right dock */}
        <ResizablePanel id="center-right-wrapper">
          <ResizablePanelGroup
            orientation="horizontal"
            id="neeko-center-right"
            className="h-full"
          >
            {/* Center area: editor content (island) */}
            <ResizablePanel
              id="center-area"
              defaultSize={rightVisible ? undefined : "100%"}
              minSize="20%"
              className="py-1 px-0.5 overflow-hidden"
            >
              {children}
            </ResizablePanel>

            {/* Right dock zone (island) — only render when expanded and has panels */}
            {rightVisible && (
              <ResizableHandle id="handle-center-right" withHandle />
            )}
            {rightVisible && (
              <ResizablePanel
                id="right-zone"
                defaultSize={rightDefaultSize}
                minSize="12%"
                maxSize="80%"
                className="py-1 pl-0.5"
              >
                <DockZone zoneId="right" />
              </ResizablePanel>
            )}
          </ResizablePanelGroup>
        </ResizablePanel>
      </ResizablePanelGroup>

      {/* Right toolbar column */}
      <div className="flex flex-col shrink-0">
        <DockBar side="right" />
      </div>
    </div>
  );
};

export default React.memo(DockLayout);
