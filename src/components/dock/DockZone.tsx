import React, { Suspense } from "react";
import { useDockStore } from "@/store/dockStore";
import { dockPanelRegistry } from "@/registries/dockPanels";
import { useDragToReDock } from "./useDragToReDock";
import { cn } from "@/lib/utils";

interface DockZoneProps {
  zoneId: string;
}

/** Docking zone container -- renders active panel directly.
 *  Panel switching is done via DockBar icons, not tab headers.
 *  No auto-hide, no collapse -- panels stay visible. */
const DockZone: React.FC<DockZoneProps> = ({ zoneId }) => {
  const zone = useDockStore((s) => s.zones[zoneId]);

  // Drag-to-re-dock
  const { isDragOver, dragHandlers } = useDragToReDock(zoneId);

  if (!zone) {
    return (
      <div
        className="flex h-full items-center justify-center text-xs text-text-muted"
        {...dragHandlers}
      >
        Unknown zone: {zoneId}
      </div>
    );
  }

  // Empty or collapsed zone state
  if (zone.panels.length === 0 || !zone.expanded) {
    return (
      <div
        className={cn(
          "flex h-full items-center justify-center text-xs text-text-muted bg-bg-secondary",
          isDragOver && "ring-2 ring-inset ring-accent-blue/50",
        )}
        {...dragHandlers}
      >
        {isDragOver ? "Drop panel here" : ""}
      </div>
    );
  }

  // Render active panel directly -- no tabs, no collapse
  const activePanelId = zone.activePanelId;
  const activeDef = activePanelId ? dockPanelRegistry[activePanelId] : null;
  const ActiveComponent = activeDef?.component;

  return (
    <div
      className={cn(
        "flex h-full flex-col bg-bg-secondary overflow-hidden",
        isDragOver && "ring-2 ring-inset ring-accent-blue/50",
      )}
      {...dragHandlers}
    >
      {ActiveComponent ? (
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center text-sm text-text-muted">
              Loading {activeDef.title}...
            </div>
          }
        >
          <ActiveComponent />
        </Suspense>
      ) : (
        <div className="flex h-full items-center justify-center text-xs text-text-muted">
          No panel selected
        </div>
      )}
    </div>
  );
};

export default React.memo(DockZone);
