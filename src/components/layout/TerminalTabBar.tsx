import React, { useCallback, useRef } from "react";
import TerminalTabComponent from "./TerminalTab";
import type { TerminalTab } from "../../types";

interface TerminalTabBarProps {
   tabs: TerminalTab[];
   activeTabId: string | null;
   onActivateTab: (tabId: string) => void;
   onCloseTab: (tabId: string) => void;
   onAddTab: () => void;
}

function TerminalTabBar({
   tabs,
   activeTabId,
   onActivateTab,
   onCloseTab,
   onAddTab,
}: TerminalTabBarProps) {
   const scrollRef = useRef<HTMLDivElement>(null);

   const handleWheel = useCallback((event: React.WheelEvent) => {
      if (scrollRef.current) {
         scrollRef.current.scrollLeft += event.deltaY;
      }
   }, []);

   if (tabs.length === 0) return null;

   return (
      <div ref={scrollRef} className="flex items-center gap-1 overflow-x-auto no-scrollbar" onWheel={handleWheel}>
         {tabs.map((tab) => (
            <TerminalTabComponent
               key={tab.id}
               id={tab.id}
               title={tab.title}
               isActive={tab.id === activeTabId}
               isRunning={tab.status === "Running"}
               onClose={onCloseTab}
               onActivate={onActivateTab}
            />
         ))}

         {tabs.length < 10 && (
            <button
               className="tb-icon-btn w-6 h-6 rounded-md border border-border text-text-secondary hover:bg-bg-hover hover:text-text-primary"
               onClick={onAddTab}
               title="New terminal tab"
            >
               +
            </button>
         )}
      </div>
   );
}

export default React.memo(TerminalTabBar);
