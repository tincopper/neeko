import React, { useCallback } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { useDockStore } from "@/store/dockStore";
import {
  dockPanelRegistry,
  dockPanelIcons,
} from "@/registries/dockPanels";
import { cn } from "@/lib/utils";

interface DockBarButtonProps {
  panelId: string;
}

/** Individual icon button on the DockBar (tool window bar).
 *  Subscribes directly to dockStore — no parent props needed for state. */
const DockBarButton: React.FC<DockBarButtonProps> = ({ panelId }) => {
  // Direct store selectors — fine-grained re-renders
  const isActive = useDockStore((s) => {
    for (const zone of Object.values(s.zones)) {
      if (zone.panels.includes(panelId) && zone.expanded && zone.activePanelId === panelId) return true;
    }
    return false;
  });

  const togglePanel = useDockStore((s) => s.togglePanel);

  const handleClick = useCallback(() => {
    togglePanel(panelId);
  }, [togglePanel, panelId]);

  const def = dockPanelRegistry[panelId];
  if (!def) return null;

  const Icon = dockPanelIcons[def.icon];

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={handleClick}
          className={cn(
            "relative w-12 h-12 flex items-center justify-center",
            "text-text-secondary hover:text-text-primary transition-colors duration-150",
            "focus:outline-none",
          )}
          aria-label={def.title}
        >
          <span
            className={cn(
              "flex items-center justify-center w-8 h-8 rounded-md",
              "hover:bg-bg-hover",
              isActive && "bg-bg-hover text-text-primary",
            )}
          >
            {Icon ? <Icon className="h-5 w-5" /> : <span>{def.title[0]}</span>}
          </span>
          {/* Badge slot (hidden for now) */}
          <Badge
            variant="secondary"
            className={cn(
              "absolute -right-0.5 -top-0.5 h-4 min-w-4 px-1 text-[10px] leading-none",
              "hidden",
            )}
          >
            0
          </Badge>
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        <p>{def.title}</p>
      </TooltipContent>
    </Tooltip>
  );
};

export default React.memo(DockBarButton);
