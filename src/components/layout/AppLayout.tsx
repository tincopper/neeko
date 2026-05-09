import React, { useState, useRef, useEffect, useCallback } from "react";
import { Plus, Settings } from "lucide-react";
import { useDockStore } from "@/store/dockStore";
import { useAppStore } from "@/store/appStore";
import { cn } from "@/lib/utils";
import { SkillProvider } from "@/contexts/skill-context";
import { DockLayout } from "@/components/dock";
import SettingsPanel from "@/components/SettingsPanel";
import MainContent from "@/components/MainContent";
import { SkillContent } from "@/components/skills";
import { IS_WINDOWS } from "@/utils/platform";
import linuxIcon from "@/assets/linux.svg";
import serverIcon from "@/assets/server.svg";
import type { AppConfig } from "@/types";

interface AppLayoutProps {
  onAddProject: () => void;
  onAddWsl: () => void;
  onAddRemote: () => void;
  onOpenSettings: () => void;
  settingsOpen: boolean;
  onCloseSettings: () => void;
  onConfigChange: (next: AppConfig) => void;
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
            className="relative w-12 h-12 flex items-center justify-center text-text-secondary hover:text-text-primary transition-colors duration-150 focus:outline-none"
            title="Add Project"
            onClick={() => setShowAddMenu((v) => !v)}
          >
            <span className="flex items-center justify-center w-8 h-8 rounded-md hover:bg-bg-hover">
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
          className="relative w-12 h-12 flex items-center justify-center text-text-secondary hover:text-text-primary transition-colors duration-150 focus:outline-none"
          title="Settings"
          onClick={onOpenSettings}
        >
          <span
            className={cn(
              "flex items-center justify-center w-8 h-8 rounded-md",
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
  settingsOpen,
  onCloseSettings,
  onConfigChange,
}: AppLayoutProps) {
  const skillsActive = useDockStore(
    (s) => s.zones.left?.activePanelId === "skills",
  );
  const activeProjectId = useAppStore((s) => s.activeProjectId);

  // Center content: settings full-page → skills two-column → normal MainContent
  const centerContent = settingsOpen ? (
    <div className="flex-1 flex min-w-0 transition-opacity duration-200 motion-safe:transition-opacity">
      <SettingsPanel
        fullPage
        onConfigChange={onConfigChange}
        onClose={onCloseSettings}
      />
    </div>
  ) : skillsActive ? (
    <SkillProvider activeProjectId={activeProjectId}>
      <div className="flex-1 flex flex-col overflow-hidden bg-bg-primary">
        <SkillContent />
      </div>
    </SkillProvider>
  ) : (
    <MainContent />
  );

  return (
    <DockLayout
      toolbarFooterLeft={
        <ToolbarFooter
          onAddProject={onAddProject}
          onAddWsl={onAddWsl}
          onAddRemote={onAddRemote}
          onOpenSettings={onOpenSettings}
          isSettingsOpen={settingsOpen}
        />
      }
    >
      {centerContent}
    </DockLayout>
  );
}

export default React.memo(AppLayout);
