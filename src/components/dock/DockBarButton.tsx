import React, { useCallback } from "react";
import { useShallow } from "zustand/shallow";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { useDockStore } from "@/store/dockStore";
import { useAppStore } from "@/store/appStore";
import {
  dockPanelRegistry,
  dockPanelIcons,
} from "@/registries/dockPanels";
import { cn } from "@/lib/utils";
import type { TabKind } from "@/types/tab";

/** Map panel IDs to TabKind values for panels that open as tabs */
const PANEL_TO_TAB_KIND: Record<string, TabKind> = {
  git: "gitLog",
};

interface DockBarButtonProps {
  panelId: string;
}

/** Individual icon button on the DockBar (tool window bar).
 *  Subscribes directly to dockStore — no parent props needed for state. */
const DockBarButton: React.FC<DockBarButtonProps> = ({ panelId }) => {
  const def = dockPanelRegistry[panelId];
  const isTab = def?.openAs === "tab";

  // For tab-mode buttons, track if the tab is open in the active project
  // Use currentProjectId (covers local/WSL/remote) to match MainContent's tabKey
  const isTabActive = useAppStore((s) => {
    if (!isTab) return false;
    const tabKind = PANEL_TO_TAB_KIND[panelId] ?? (panelId as TabKind);
    const projectId =
      s.activeProjectId ??
      s.activeWslProject?.project.id ??
      s.activeRemoteProject?.project.id ??
      "__app__";
    const projectTabs = s.tabs[projectId];
    return projectTabs?.tabs.some((t) => t.data.kind === tabKind) ?? false;
  });

  // For dock-mode buttons, track if the dock panel is active
  const isDockActive = useDockStore((s) => {
    if (isTab) return false;
    for (const zone of Object.values(s.zones)) {
      if (zone.panels.includes(panelId) && zone.expanded && zone.activePanelId === panelId) return true;
    }
    return false;
  });

  const isActive = isTab ? isTabActive : isDockActive;

  const togglePanel = useDockStore((s) => s.togglePanel);
  const addTab = useAppStore((s) => s.addTab);
  const closeTab = useAppStore((s) => s.closeTab);
  const activateTab = useAppStore((s) => s.activateTab);
  // Use currentProjectId that covers local/WSL/remote — matches MainContent's tabKey
  const currentProjectId = useAppStore((s) =>
    s.activeProjectId ??
    s.activeWslProject?.project.id ??
    s.activeRemoteProject?.project.id ??
    null
  );
  const tabs = useAppStore(useShallow((s) => s.tabs));

  const handleClick = useCallback(() => {
    if (isTab) {
      const tabKind = PANEL_TO_TAB_KIND[panelId] ?? (panelId as TabKind);
      const projectId = currentProjectId ?? "__app__";
      const projectTabs = tabs[projectId];
      const existing = projectTabs?.tabs.find((t) => t.data.kind === tabKind);
      if (existing) {
        closeTab(projectId, existing.id);
      } else {
        const tabId = `${panelId}_tab`;
        addTab(projectId, {
          id: tabId,
          projectId,
          title: def?.title ?? panelId,
          order: 100,
          data: { kind: tabKind } as never,
        });
        activateTab(projectId, tabId);
      }
    } else {
      togglePanel(panelId);
    }
  }, [isTab, togglePanel, addTab, closeTab, activateTab, currentProjectId, tabs, panelId, def]);

  if (!def) return null;

  const Icon = dockPanelIcons[def.icon];

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={handleClick}
          className={cn(
             "relative w-11 h-11 flex items-center justify-center",
            "text-text-secondary hover:text-text-primary transition-colors duration-150",
            "focus:outline-none",
          )}
          aria-label={def.title}
        >
          <span
            className={cn(
              "flex items-center justify-center w-8 h-8 rounded-md",
              "hover:bg-bg-hover",
              isActive && "bg-bg-selected text-text-primary",
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
