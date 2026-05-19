import React, { useCallback, useEffect, useRef } from "react";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { usePanelRef, type PanelSize } from "react-resizable-panels";
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
 *
 * IMPORTANT: Uses collapsible panels instead of key-based remount to avoid
 * react-resizable-panels global state corruption when nested Groups remount.
 * This fixes the bug where pinning a tab then opening a side panel caused
 * unresponsive drag handles.
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

  const rightPanelSizes = useDockStore((s) => s.rightPanelSizes);
  const setRightPanelSize = useDockStore((s) => s.setRightPanelSize);
  const leftPanelSize = useDockStore((s) => s.leftPanelSize);
  const setLeftPanelSize = useDockStore((s) => s.setLeftPanelSize);

  const rightPanelIds = useDockStore(
    (s) => s.zones.right?.panels ?? [],
  );

  const rightVisible = rightPanelIds.length > 0 && rightExpanded;

  /** Resolve target zone width for a given panel: store value → registry default → 18%.
   *  Always returns at least MIN_RIGHT_ZONE_SIZE to match the panel's minSize constraint,
   *  preventing the zone from appearing invisible after first expand. */
  const MIN_RIGHT_ZONE_SIZE = 12; // must match ResizablePanel minSize below
  const getRightPanelSize = useCallback(
    (panelId: string | null): number => {
      if (!panelId) return 18;
      if (rightPanelSizes[panelId] != null) return Math.max(rightPanelSizes[panelId], MIN_RIGHT_ZONE_SIZE);
      const def = dockPanelRegistry[panelId];
      return Math.max(def?.defaultZoneSize ?? 18, MIN_RIGHT_ZONE_SIZE);
    },
    [rightPanelSizes],
  );

  // -- Panel imperative refs for collapse/expand --
  const leftZonePanelRef = usePanelRef();
  const rightPanelRef = usePanelRef();
  const prevRightPanelIdRef = useRef<string | null>(rightActivePanelId);

  // -- Left panel: collapse/expand imperatively instead of key-based remount --
  const leftExpandedRef = useRef(leftExpanded);
  useEffect(() => {
    const prev = leftExpandedRef.current;
    leftExpandedRef.current = leftExpanded;
    if (prev === leftExpanded) return;

    const panel = leftZonePanelRef.current;
    if (!panel) return;

    if (leftExpanded) {
      panel.expand();
    } else {
      panel.collapse();
    }
  }, [leftExpanded, leftZonePanelRef]);

  // -- Right panel: collapse/expand imperatively instead of key-based remount --
  const rightVisibleRef = useRef(rightVisible);
  useEffect(() => {
    const prev = rightVisibleRef.current;
    rightVisibleRef.current = rightVisible;
    if (prev === rightVisible) return;

    const panel = rightPanelRef.current;
    if (!panel) return;

    if (rightVisible) {
      panel.expand();
      // After expand, resize to the target size for the active panel.
      // Use double-rAF: the first frame lets expand() settle its internal
      // layout state; the second frame executes the resize after any
      // concurrent EditorGroupLayout remount (triggered by pin/unpin) has
      // also completed its first paint — preventing a race that left the
      // panel at 0 width when opening a side panel right after pinning a tab.
      const targetSize = getRightPanelSize(rightActivePanelId);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          rightPanelRef.current?.resize(`${targetSize}%`);
        });
      });
    } else {
      panel.collapse();
    }
  }, [rightVisible, rightPanelRef, getRightPanelSize, rightActivePanelId]);

  // Resize right zone to target size when active panel changes (instant, no CSS transition)
  useEffect(() => {
    const prev = prevRightPanelIdRef.current;
    prevRightPanelIdRef.current = rightActivePanelId;

    if (prev === rightActivePanelId) return;
    if (!rightVisible) return;

    const panel = rightPanelRef.current;
    if (!panel) return;

    const targetSize = getRightPanelSize(rightActivePanelId);
    panel.resize(`${targetSize}%`);
  }, [rightActivePanelId, rightVisible, getRightPanelSize, rightPanelRef]);

  // Save right panel size on resize — only persist values at or above minSize
  // to prevent collapsed/transitioning sizes from corrupting the stored value.
  const handleRightPanelResize = useCallback(
    (panelSize: PanelSize) => {
      if (rightActivePanelId && panelSize.asPercentage >= MIN_RIGHT_ZONE_SIZE) {
        setRightPanelSize(rightActivePanelId, panelSize.asPercentage);
      }
    },
    [rightActivePanelId, setRightPanelSize],
  );

  // Save left panel size on resize (debounced to avoid thrashing the store on every drag frame)
  const leftPanelSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleLeftPanelResize = useCallback(
    (panelSize: PanelSize) => {
      // Don't save collapsed state as the panel size
      if (panelSize.asPercentage === 0) return;
      if (leftPanelSaveTimerRef.current !== null) clearTimeout(leftPanelSaveTimerRef.current);
      leftPanelSaveTimerRef.current = setTimeout(() => {
        leftPanelSaveTimerRef.current = null;
        setLeftPanelSize(panelSize.asPercentage);
      }, 150);
    },
    [setLeftPanelSize],
  );

  const setLeftPanelWidth = useAppStore((s) => s.setLeftPanelWidth);

  const leftPanelElRef = useRef<HTMLDivElement>(null);

  // ResizeObserver: fires on mount (initial size) + every resize drag.
  // Re-runs when leftExpanded toggles so the observer re-attaches after expand.
  useEffect(() => {
    if (!leftExpanded) {
      setLeftPanelWidth(0);
      return;
    }
    const el = leftPanelElRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      setLeftPanelWidth(width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [leftExpanded, setLeftPanelWidth]);

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

      {/* Resizable layout: left dock | center editor | right dock
          Uses collapsible panels instead of key-based remount to prevent
          react-resizable-panels internal state corruption with nested groups. */}
      <ResizablePanelGroup
        orientation="horizontal"
        id="neeko-main"
        className="flex-1"
      >
        {/* Left dock zone (island) — collapsible, not conditionally rendered */}
        <ResizablePanel
          id="left-zone"
          defaultSize={leftExpanded ? `${leftPanelSize}%` : "0%"}
          collapsible
          collapsedSize="0%"
          minSize="12%"
          maxSize="35%"
          className="py-1 pr-0.5"
          elementRef={leftPanelElRef}
          panelRef={leftZonePanelRef}
          onResize={handleLeftPanelResize}
        >
          <DockZone zoneId="left" />
        </ResizablePanel>

        <ResizableHandle
          id="handle-left-center"
          withHandle
          disabled={!leftExpanded}
          className={leftExpanded ? undefined : "!w-0 !cursor-default"}
        />

        {/* Center area: editor content (island) */}
        <ResizablePanel
          id="center-area"
          minSize="20%"
          className="py-1 px-0.5 overflow-hidden"
        >
          {children}
        </ResizablePanel>

        {/* Right dock zone (island) — collapsible, not conditionally rendered */}
        <ResizableHandle
          id="handle-center-right"
          withHandle
          disabled={!rightVisible}
          className={rightVisible ? undefined : "!w-0 !cursor-default"}
        />
        <ResizablePanel
          id="right-zone"
          defaultSize={rightVisible ? `${getRightPanelSize(rightActivePanelId)}%` : "0%"}
          collapsible
          collapsedSize="0%"
          minSize="12%"
          maxSize="80%"
          className="py-1 pl-0.5"
          panelRef={rightPanelRef}
          onResize={handleRightPanelResize}
        >
          <DockZone zoneId="right" />
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
