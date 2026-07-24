import React, { useState, useEffect, useRef } from 'react';

import { LibraryBig, Settings, Plus, ListTree } from '@/shared/components/icons';
import { useSidebar, type ActivityPanel } from '@/shared/contexts/SidebarContext';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from '@/ui/sidebar';
import { TooltipProvider } from '@/ui/tooltip';

import AddProjectMenu from './AddProjectMenu';

function FolderIcon({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

interface ActivityBarProps {
  onOpenSettings: () => void;
  onAddProject: () => void;
  onAddWsl: () => void;
  onAddRemote: () => void;
  isSettingsOpen?: boolean;
}

function ActivityBar({
  onOpenSettings,
  onAddProject,
  onAddWsl,
  onAddRemote,
  isSettingsOpen = false,
}: ActivityBarProps) {
  const { activePanel, togglePanel } = useSidebar();
  const [showAddMenu, setShowAddMenu] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(event.target as Node)) {
        setShowAddMenu(false);
      }
    };
    if (showAddMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showAddMenu]);

  const navItems: { id: ActivityPanel; icon: React.ReactNode; title: string }[] = [
    { id: 'projects', icon: <FolderIcon />, title: 'Projects' },
    { id: 'files', icon: <ListTree size={22} strokeWidth={1.8} />, title: 'Files' },
    { id: 'skills', icon: <LibraryBig size={22} strokeWidth={1.8} />, title: 'Skills' },
  ];

  return (
    <TooltipProvider delayDuration={300}>
      <Sidebar variant="icon">
        <SidebarContent>
          <SidebarMenu>
            {navItems.map((item) => (
              <SidebarMenuItem key={item.id}>
                <SidebarMenuButton
                  tooltip={item.title}
                  onClick={() => togglePanel(item.id)}
                  isActive={activePanel === item.id}
                >
                  {item.icon}
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <div className="relative flex flex-col items-center w-full" ref={addMenuRef}>
                <SidebarMenuButton
                  tooltip="Add Project"
                  onClick={() => setShowAddMenu((v) => !v)}
                  aria-haspopup="menu"
                  aria-expanded={showAddMenu}
                >
                  <Plus size={24} strokeWidth={1.8} />
                </SidebarMenuButton>

                {showAddMenu && (
                  <AddProjectMenu
                    onClose={() => setShowAddMenu(false)}
                    onAddProject={onAddProject}
                    onAddWsl={onAddWsl}
                    onAddRemote={onAddRemote}
                  />
                )}
              </div>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip="Settings"
                onClick={onOpenSettings}
                isActive={isSettingsOpen}
              >
                <Settings size={22} strokeWidth={1.8} />
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
    </TooltipProvider>
  );
}

export default React.memo(ActivityBar);
