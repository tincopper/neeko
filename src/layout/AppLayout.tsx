import React, { useState, useRef, useEffect } from 'react';

import SettingsView from '@/features/settings/components/SettingsView';
import SkillContent from '@/features/skill/components/SkillContent';
import { cn } from '@/lib/utils';
import { Plus, Settings } from '@/shared/components/icons';
import { useAppViewStore } from '@/shared/store/appViewStore';
import { useDockStore } from '@/shared/store/dockStore';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/ui/tooltip';

import AddProjectMenu from './AddProjectMenu';
import { DockLayout } from './dock-layout';
import MainContent from './MainContent';

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
}> = React.memo(({ onAddProject, onAddWsl, onAddRemote, onOpenSettings, isSettingsOpen }) => {
  const [showAddMenu, setShowAddMenu] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(event.target as Node)) {
        setShowAddMenu(false);
      }
    };
    if (showAddMenu) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showAddMenu]);

  return (
    <TooltipProvider delayDuration={300}>
      {/* Add Project menu */}
      <div className="relative flex flex-col items-center w-full" ref={addMenuRef}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className="relative w-9 h-9 flex items-center justify-center text-text-secondary hover:text-text-primary transition-colors duration-150 focus:outline-none"
              onClick={() => setShowAddMenu((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={showAddMenu}
            >
              <span className="flex items-center justify-center w-7 h-7 rounded-md hover:bg-bg-hover">
                <Plus size={20} strokeWidth={1.8} />
              </span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={8}>
            <p>Add Project</p>
          </TooltipContent>
        </Tooltip>
        {showAddMenu && (
          <AddProjectMenu
            onClose={() => setShowAddMenu(false)}
            onAddProject={onAddProject}
            onAddWsl={onAddWsl}
            onAddRemote={onAddRemote}
          />
        )}
      </div>

      {/* Settings button */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className="relative w-9 h-9 flex items-center justify-center text-text-secondary hover:text-text-primary transition-colors duration-150 focus:outline-none"
            onClick={onOpenSettings}
          >
            <span
              className={cn(
                'flex items-center justify-center w-7 h-7 rounded-md',
                'hover:bg-bg-hover',
                isSettingsOpen && 'bg-bg-hover text-text-primary',
              )}
            >
              <Settings size={20} strokeWidth={1.8} />
            </span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>
          <p>Settings</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
});
ToolbarFooter.displayName = 'ToolbarFooter';

/**
 * Top-level layout container.
 *
 * Replaces the old flex-based ActivityBar + PanelArea + MainContent + RightPanel
 * layout with the new DockLayout framework. Panel toggling is driven by dockStore
 * (via DockBar + DockZone). Special modes (Settings full-page, Skills two-column)
 * take over the center area via conditional rendering.
 */
function AppLayout({ onAddProject, onAddWsl, onAddRemote, onOpenSettings }: AppLayoutProps) {
  const appView = useAppViewStore((s) => s.appView);
  const skillsActive = useDockStore((s) => s.zones.left?.activePanelId === 'skills');

  const isSettingsOpen = appView === 'settings';

  // Center content:
  // Settings — full-page view, independent of dock layout.
  // Normal mode — MainContent 和 SkillContent 始终挂载，通过 CSS hidden 切换。
  // 避免 mount/unmount 触发的闪烁和 layout 重计算。
  const centerContent: React.ReactNode =
    appView === 'settings' ? (
      <div className="flex-1 flex flex-col overflow-hidden">
        <SettingsView />
      </div>
    ) : (
      <div className="flex-1 flex flex-col overflow-hidden">
        <div
          className={cn(
            'flex flex-col flex-1 h-full min-h-0 overflow-hidden rounded-lg shadow-sm bg-bg-secondary',
            skillsActive && 'hidden',
          )}
        >
          <MainContent />
        </div>
        <div
          className={cn(
            'flex flex-col flex-1 h-full min-h-0 overflow-hidden rounded-lg shadow-sm bg-bg-secondary',
            !skillsActive && 'hidden',
          )}
        >
          <SkillContent />
        </div>
      </div>
    );

  return (
    <>
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
    </>
  );
}

export default React.memo(AppLayout);
