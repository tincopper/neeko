import React from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useDockStore } from "@/store/dockStore";
import DockBarButton from "./DockBarButton";

interface DockBarProps {
  side: "left" | "right";
}

/** 48px fixed-width tool window bar.
 *  Subscribes to dockStore to render icon buttons for its side. */
const DockBar: React.FC<DockBarProps> = ({ side }) => {
  const rawBarItems = useDockStore((s) => s.barItems);
  const barItems = React.useMemo(
    () =>
      rawBarItems
        .filter((item) => item.side === side && item.visible)
        .sort((a, b) => a.order - b.order),
    [rawBarItems, side],
  );

  return (
    <TooltipProvider delayDuration={300}>
      <div
        className="flex w-12 shrink-0 flex-col items-center bg-bg-secondary py-2"
        role="toolbar"
        aria-label={`${side} toolbar`}
      >
        {barItems.map((item) => (
          <DockBarButton key={item.panelId} panelId={item.panelId} />
        ))}
      </div>
    </TooltipProvider>
  );
};

export default React.memo(DockBar);
