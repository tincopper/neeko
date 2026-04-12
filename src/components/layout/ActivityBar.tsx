import React from "react";
import { LibraryBig, Settings } from "lucide-react";
import { useSidebar, type ActivityPanel } from "../../context/sidebar-context";
import { Sidebar, SidebarContent, SidebarFooter, SidebarMenu, SidebarMenuItem, SidebarMenuButton } from "../ui/sidebar";

function FolderIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}





interface ActivityBarProps {
  onOpenSettings: () => void;
}

function ActivityBar({ onOpenSettings }: ActivityBarProps) {
  const { activePanel, togglePanel } = useSidebar();

  const navItems: { id: ActivityPanel; icon: React.ReactNode; title: string }[] = [
    { id: "projects", icon: <FolderIcon />, title: "Projects" },
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
            <SidebarMenuButton tooltip="Settings" onClick={onOpenSettings}>
              <Settings size={22} strokeWidth={1.8} />
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

export default React.memo(ActivityBar);
