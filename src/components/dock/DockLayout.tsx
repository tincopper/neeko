import React, { useCallback, useEffect } from "react";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import DockBar from "./DockBar";
import DockZone from "./DockZone";
import { useDockStore } from "@/store/dockStore";
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

  const rightPanelIds = useDockStore(
    (s) => s.zones.right?.panels ?? [],
  );

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
      <div className="flex flex-col shrink-0 bg-bg-secondary">
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

      {/* Resizable 3-zone main area (left dock + center editor + right dock) */}
      <ResizablePanelGroup
        orientation="horizontal"
        id="neeko-main"
        className="flex-1"
      >
        {/* Left dock zone */}
        <ResizablePanel
          id="left-zone"
          defaultSize="18%"
          minSize="12%"
          maxSize="35%"
        >
          <DockZone zoneId="left" />
        </ResizablePanel>

        <ResizableHandle id="handle-left-center" withHandle />

        {/* Center area: editor content */}
        <ResizablePanel id="center-area" defaultSize="64%" minSize="40%" className="overflow-hidden">
          {children}
        </ResizablePanel>

        {/* Right dock zone — only render when there are panels */}
        {rightPanelIds.length > 0 && (
          <>
            <ResizableHandle id="handle-center-right" withHandle />
            <ResizablePanel
              id="right-zone"
              defaultSize="18%"
              minSize="12%"
              maxSize="35%"
              collapsedSize={0}
              collapsible
            >
              <DockZone zoneId="right" />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>

      {/* Right toolbar column */}
      <div className="flex flex-col shrink-0 bg-bg-secondary">
        <DockBar side="right" />
      </div>
    </div>
  );
};

export default React.memo(DockLayout);
