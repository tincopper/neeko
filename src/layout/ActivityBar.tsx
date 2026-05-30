import React, { useState, useEffect, useRef } from "react";
import { LibraryBig, Settings, Plus, ListTree } from "@/shared/components/icons"
import { useSidebar, type ActivityPanel } from "@/shared/contexts/SidebarContext";
import { Sidebar, SidebarContent, SidebarFooter, SidebarMenu, SidebarMenuItem, SidebarMenuButton } from "@/ui/sidebar";
import { IS_WINDOWS } from "@/shared/utils/platform";
import linuxIcon from "../assets/linux.svg";
import serverIcon from "../assets/server.svg";

function FolderIcon({ size = 22 }: { size?: number }) {
   return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
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

function ActivityBar({ onOpenSettings, onAddProject, onAddWsl, onAddRemote, isSettingsOpen = false }: ActivityBarProps) {
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
         document.addEventListener("mousedown", handleClickOutside);
      }
      return () => {
         document.removeEventListener("mousedown", handleClickOutside);
      };
   }, [showAddMenu]);

   const navItems: { id: ActivityPanel; icon: React.ReactNode; title: string }[] = [
      { id: "projects", icon: <FolderIcon />, title: "Projects" },
      { id: "files", icon: <ListTree size={22} strokeWidth={1.8} />, title: "Files" },
      { id: "skills", icon: <LibraryBig size={22} strokeWidth={1.8} />, title: "Skills" },
   ];

   return (
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
                     <SidebarMenuButton tooltip="Add Project" onClick={() => setShowAddMenu((v) => !v)}>
                        <Plus size={24} strokeWidth={1.8} />
                     </SidebarMenuButton>

                     {showAddMenu && (
                        <div className="absolute left-12 bottom-0 z-50 w-48 rounded-md border border-border bg-bg-tertiary shadow-lg overflow-hidden">
                           <div
                              className="px-3 py-2 text-sm text-text-primary hover:bg-bg-hover cursor-pointer flex items-center"
                              onClick={() => { setShowAddMenu(false); onAddProject(); }}
                           >
                              <span className="mr-2">📁</span>
                              <span>Add Local Project</span>
                           </div>
                           {IS_WINDOWS && (
                              <div
                                 className="px-3 py-2 text-sm text-text-primary hover:bg-bg-hover cursor-pointer flex items-center"
                                 onClick={() => { setShowAddMenu(false); onAddWsl(); }}
                              >
                                 <img src={linuxIcon} className="w-3.5 h-3.5 mr-2" alt="" />
                                 <span>Add WSL Distro</span>
                              </div>
                           )}
                           <div
                              className="px-3 py-2 text-sm text-text-primary hover:bg-bg-hover cursor-pointer flex items-center"
                              onClick={() => { setShowAddMenu(false); onAddRemote(); }}
                           >
                              <img src={serverIcon} className="w-3.5 h-3.5 mr-2" alt="" />
                              <span>Add Remote Server</span>
                           </div>
                        </div>
                     )}
                  </div>
               </SidebarMenuItem>
               <SidebarMenuItem>
                  <SidebarMenuButton tooltip="Settings" onClick={onOpenSettings} isActive={isSettingsOpen}>
                     <Settings size={22} strokeWidth={1.8} />

                  </SidebarMenuButton>
               </SidebarMenuItem>
            </SidebarMenu>
         </SidebarFooter>
      </Sidebar>
   );
}

export default React.memo(ActivityBar);
