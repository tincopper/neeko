import React, { useState, useRef, useEffect } from 'react';

import { cn } from '@/lib/utils';
import { Plus, Settings } from '@/shared/components/icons';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/ui/tooltip';

import AddProjectMenu from './AddProjectMenu';
import { DockLayout } from './dock-layout';

interface AppLayoutProps {
  onAddProject: () => void;
  onAddWsl: () => void;
  onAddRemote: () => void;
  onOpenSettings: () => void;
  /** Whether Settings view is active (highlights the settings toolbar button). */
  isSettingsOpen?: boolean;
  children?: React.ReactNode;
  leftButtons?: React.ReactNode[];
  rightButtons?: React.ReactNode[];
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
 * Top-level layout skeleton.
 *
 * Owns the DockLayout chrome (bars, zones, toolbar footer) and renders center
 * content via `children`. App-layer coordination (settings/skills routing,
 * feature-aware dock buttons) is injected by `App.tsx`.
 */
function AppLayout({
  onAddProject,
  onAddWsl,
  onAddRemote,
  onOpenSettings,
  isSettingsOpen = false,
  children,
  leftButtons,
  rightButtons,
}: AppLayoutProps) {
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
        leftButtons={leftButtons}
        rightButtons={rightButtons}
      >
        {children}
      </DockLayout>
    </>
  );
}

export default React.memo(AppLayout);
