import React, { useState, useRef, useEffect, useCallback } from "react";
import { Plus, Settings } from "@/shared/components/icons"
import { useAppViewStore } from "@/shared/store/appViewStore";
import { useDockStore } from "@/shared/store/dockStore";
import { cn } from "@/lib/utils";
import { DockLayout } from "./DockLayout";
import MainContent from "./MainContent";
import SkillContent from "@/features/skill/components/SkillContent";
import SettingsView from "@/features/settings/components/SettingsView";
import { IS_WINDOWS } from "@/shared/utils/platform";
import linuxIcon from "@/assets/linux.svg";
import serverIcon from "@/assets/server.svg";

interface AppLayoutProps {
  onAddProject: () => void;
  onAddWsl: () => void;
  onAddRemote: () => void;
  onOpenSettings: () => void;
}

/**
 * Toolbar footer component — Add Project dropdown + Settings button.
 * Placed below DockBar in the left toolbar column.
 */
const ToolbarFooter: React.FC<{
  onAddProject: () => void;
  onAddWsl: () => void;
  onAddRemote: () => void;
  onOpenSettings: () => void;
  isSettingsOpen: boolean;
}> = React.memo(
  ({ onAddProject, onAddWsl, onAddRemote, onOpenSettings, isSettingsOpen }) => {
    const [showAddMenu, setShowAddMenu] = useState(false);
    const addMenuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      const handler = (event: MouseEvent) => {
        if (
          addMenuRef.current &&
          !addMenuRef.current.contains(event.target as Node)
        ) {
          setShowAddMenu(false);
        }
      };
      if (showAddMenu) document.addEventListener("mousedown", handler);
      return () => document.removeEventListener("mousedown", handler);
    }, [showAddMenu]);

    const closeAndCall = useCallback(
      (fn: () => void) => {
        setShowAddMenu(false);
        fn();
      },
      [],
    );

    return (
      <>
        {/* Add Project menu */}
        <div className="relative flex flex-col items-center w-full" ref={addMenuRef}>
          <button
            className="relative w-9 h-9 flex items-center justify-center text-text-secondary hover:text-text-primary transition-colors duration-150 focus:outline-none"
            title="Add Project"
            onClick={() => setShowAddMenu((v) => !v)}
          >
            <span className="flex items-center justify-center w-7 h-7 rounded-md hover:bg-bg-hover">
              <Plus size={20} strokeWidth={1.8} />
            </span>
          </button>
          {showAddMenu && (
            <div className="absolute left-12 bottom-0 z-50 w-48 rounded-md border border-border bg-bg-tertiary shadow-lg overflow-hidden">
              <div
                className="px-3 py-2 text-sm text-text-primary hover:bg-bg-hover cursor-pointer flex items-center"
                onClick={() => closeAndCall(onAddProject)}
              >
                <span className="mr-2">📁</span>
                <span>Add Local Project</span>
              </div>
              {IS_WINDOWS && (
                <div
                  className="px-3 py-2 text-sm text-text-primary hover:bg-bg-hover cursor-pointer flex items-center"
                  onClick={() => closeAndCall(onAddWsl)}
                >
                  <img src={linuxIcon} className="w-3.5 h-3.5 mr-2" alt="" />
                  <span>Add WSL Distro</span>
                </div>
              )}
              <div
                className="px-3 py-2 text-sm text-text-primary hover:bg-bg-hover cursor-pointer flex items-center"
                onClick={() => closeAndCall(onAddRemote)}
              >
                <img src={serverIcon} className="w-3.5 h-3.5 mr-2" alt="" />
                <span>Add Remote Server</span>
              </div>
            </div>
          )}
        </div>

        {/* Settings button */}
        <button
          className="relative w-9 h-9 flex items-center justify-center text-text-secondary hover:text-text-primary transition-colors duration-150 focus:outline-none"
          title="Settings"
          onClick={onOpenSettings}
        >
          <span
            className={cn(
              "flex items-center justify-center w-7 h-7 rounded-md",
              "hover:bg-bg-hover",
              isSettingsOpen && "bg-bg-hover text-text-primary",
            )}
          >
            <Settings size={20} strokeWidth={1.8} />
          </span>
        </button>
      </>
    );
  },
);
ToolbarFooter.displayName = "ToolbarFooter";

/**
 * Top-level layout container.
 *
 * Replaces the old flex-based ActivityBar + PanelArea + MainContent + RightPanel
 * layout with the new DockLayout framework. Panel toggling is driven by dockStore
 * (via DockBar + DockZone). Special modes (Settings full-page, Skills two-column)
 * take over the center area via conditional rendering.
 */
function AppLayout({
  onAddProject,
  onAddWsl,
  onAddRemote,
  onOpenSettings,
}: AppLayoutProps) {
  const appView = useAppViewStore((s) => s.appView);
  const skillsActive = useDockStore(
    (s) => s.zones.left?.activePanelId === "skills",
  );

  const isSettingsOpen = appView === "settings";

  // Center content:
  // Settings — full-page view, independent of dock layout.
  // Normal mode — MainContent 和 SkillContent 始终挂载，通过 CSS hidden 切换。
  // 避免 mount/unmount 触发的闪烁和 layout 重计算。
  const centerContent: React.ReactNode = appView === "settings" ? (
    <div className="flex-1 flex flex-col overflow-hidden">
      <SettingsView />
    </div>
  ) : (
    <div className="flex-1 flex flex-col overflow-hidden bg-bg-secondary relative">
      <div className={cn("absolute inset-0", skillsActive && "hidden")}>
        <MainContent />
      </div>
      <div className={cn("absolute inset-0", !skillsActive && "hidden")}>
        <SkillContent />
      </div>
    </div>
  );

  return (
    <DockLayout
      toolbarFooterLeft={
        <ToolbarFooter
          onAddProject={onAddProject}
          onAddWsl={onAddWsl}
          onAddRemote={onAddRemote}
          onOpenSettings={onOpenSettings}
          isSettingsOpen={isSettingsOpen}
        />
      }
    >
      {centerContent}
    </DockLayout>
  );
}

export default React.memo(AppLayout);
