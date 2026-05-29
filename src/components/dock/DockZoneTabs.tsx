import React, { Suspense, useCallback } from "react";
import { X } from "@/components/icons"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/ui/tabs";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/ui/context-menu";
import { ScrollArea } from "@/ui/scroll-area";
import { useDockStore } from "@/store/dockStore";
import { dockPanelRegistry } from "@/registries/dockPanels";
import { cn } from "@/lib/utils";

interface DockZoneTabsProps {
  zoneId: string;
}

/** Tab bar + content for a DockZone.
 *  Uses shadcn Tabs for switching, ContextMenu for right-click actions. */
const DockZoneTabs: React.FC<DockZoneTabsProps> = ({ zoneId }) => {
  const zone = useDockStore((s) => s.zones[zoneId]);
  const activatePanel = useDockStore((s) => s.activatePanel);
  const closePanel = useDockStore((s) => s.closePanel);
  const movePanel = useDockStore((s) => s.movePanel);

  if (!zone || zone.panels.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-text-muted">
        No panels
      </div>
    );
  }

  const activeValue = zone.activePanelId ?? zone.panels[0];

  const handleValueChange = useCallback(
    (panelId: string) => {
      if (panelId) activatePanel(zoneId, panelId);
    },
    [activatePanel, zoneId],
  );

  const handleClosePanel = useCallback(
    (panelId: string) => {
      closePanel(panelId);
    },
    [closePanel],
  );

  /**
   * Handle tab drag start for drag-to-re-dock.
   *
   * NOTE: Uses HTML5 Drag API. If this conflicts with Tauri WebView's
   * window-drag handling (as documented in .trellis/spec/frontend/interaction-patterns.md §10),
   * migrate to Pointer Events approach (see useProjectItemDrag pattern).
   * TODO: Test in `pnpm tauri dev` and verify no window-drag interference.
   */
  const handleDragStart = useCallback(
    (e: React.DragEvent, panelId: string) => {
      e.dataTransfer.setData("application/neeko-panel-id", panelId);
      e.dataTransfer.effectAllowed = "move";
      // Prevent the tab text/image from being dragged
      e.dataTransfer.setDragImage(new Image(), 0, 0);
    },
    [],
  );

  /** Handle panel move from right-click context menu */
  const handleMoveToZone = useCallback(
    (panelId: string, targetZone: string) => {
      movePanel(panelId, targetZone);
    },
    [movePanel],
  );

  const zones = useDockStore((s) => s.zones);
  const availableZones = React.useMemo(
    () => Object.keys(zones).filter((zid) => zid !== zoneId),
    [zones, zoneId],
  );

  return (
    <Tabs
      value={activeValue}
      onValueChange={handleValueChange}
      className="flex h-full flex-col"
    >
      {/* Tab bar header */}
      <div className="flex shrink-0 items-center border-b border-border bg-bg-secondary">
        <TabsList className="h-8 flex-1 justify-start rounded-none bg-transparent p-0">
          {zone.panels.map((panelId) => {
            const def = dockPanelRegistry[panelId];
            if (!def) return null;

            return (
              <ContextMenu key={panelId}>
                <ContextMenuTrigger asChild>
                  <TabsTrigger
                    value={panelId}
                    draggable
                    onDragStart={(e) => handleDragStart(e, panelId)}
                    className={cn(
                      "h-8 rounded-none px-3 text-xs",
                      "text-text-secondary data-[state=active]:text-text-primary data-[state=active]:bg-bg-primary",
                      "hover:bg-bg-hover",
                      "cursor-grab active:cursor-grabbing",
                      "border-r border-border",
                    )}
                  >
                    {def.title}
                  </TabsTrigger>
                </ContextMenuTrigger>
                <ContextMenuContent className="w-40">
                  <ContextMenuItem onClick={() => handleClosePanel(panelId)}>
                    <X className="mr-2 h-3.5 w-3.5" />
                    Close
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  {availableZones.map((targetZone) => (
                    <ContextMenuItem
                      key={targetZone}
                      onClick={() => handleMoveToZone(panelId, targetZone)}
                    >
                      Move to {targetZone}
                    </ContextMenuItem>
                  ))}
                </ContextMenuContent>
              </ContextMenu>
            );
          })}
        </TabsList>
      </div>

      {/* Panel content */}
      {zone.panels.map((panelId) => {
        const def = dockPanelRegistry[panelId];
        if (!def || !def.component) return null;

        const PanelComponent = def.component;

        return (
          <TabsContent
            key={panelId}
            value={panelId}
            className="mt-0 flex-1 overflow-hidden data-[state=inactive]:hidden"
          >
            <ScrollArea className="h-full">
              <Suspense
                fallback={
                  <div className="flex h-full items-center justify-center text-sm text-text-muted">
                    Loading {def.title}...
                  </div>
                }
              >
                <div>
                  <PanelComponent />
                </div>
              </Suspense>
            </ScrollArea>
          </TabsContent>
        );
      })}
    </Tabs>
  );
};

export default React.memo(DockZoneTabs);
