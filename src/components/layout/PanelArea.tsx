import React from "react";
import { useSidebar } from "../../contexts";
import { Sidebar } from "../ui/sidebar";

interface PanelAreaProps {
   children: React.ReactNode;
   className?: string;
}

function PanelArea({ children, className }: PanelAreaProps) {
   const { activePanel, panelWidth } = useSidebar();

   if (activePanel === null) return null;

   return (
      <Sidebar
         variant="panel"
         className={className}
         style={{ width: panelWidth }}
      >
         <div className="flex-1 overflow-y-auto overflow-x-hidden">
            {children}
         </div>
      </Sidebar>
   );
}

export default React.memo(PanelArea);
