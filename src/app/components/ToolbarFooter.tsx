import React, { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';
import { Plus, Settings } from '@/shared/components/icons';
import { useAppViewStore } from '@/shared/store/appViewStore';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/ui/Tooltip';

import AddProjectMenu from './AddProjectMenu';

export interface ToolbarFooterProps {
  onAddProject: () => void;
  onCloneProject: () => void;
  onAddWsl: () => void;
  onAddRemote: () => void;
  onOpenSettings: () => void;
}

/**
 * 左 DockBar 底部按钮簇（Add Project 菜单 + Settings）。
 *
 * app 层业务装配：经 DockLayout 的 toolbarFooterLeft slot 注入纯骨架，
 * 骨架对其零感知（原定义在 layout/AppLayout 内，随 AppLayout 消解迁入 app 层）。
 * Settings 高亮由组件内部订阅 appViewStore 派生（与 DockBarButton 读 feature
 * store 同一惯例）—— 上游无需穿线视图状态。
 */
const ToolbarFooter: React.FC<ToolbarFooterProps> = React.memo(
  ({ onAddProject, onCloneProject, onAddWsl, onAddRemote, onOpenSettings }) => {
    const [showAddMenu, setShowAddMenu] = useState(false);
    const addMenuRef = useRef<HTMLDivElement>(null);
    const isSettingsOpen = useAppViewStore((s) => s.appView === 'settings');

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
              onCloneProject={onCloneProject}
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
                data-testid="settings-icon"
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
  },
);
ToolbarFooter.displayName = 'ToolbarFooter';

export default ToolbarFooter;
