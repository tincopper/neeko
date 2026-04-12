import React from "react";
import { cn } from "../../utils/cn";

export interface RightPanelTab {
  id: string;
  label: string;
  content: React.ReactNode;
}

interface RightPanelProps {
  tabs: RightPanelTab[];
  activeTabId?: string;
  onTabChange?: (id: string) => void;
  onClose?: () => void;
  width: number;
  onResizeStart: (e: React.MouseEvent) => void;
  className?: string;
}

function RightPanel({ tabs, activeTabId, onTabChange, onClose, width, onResizeStart, className }: RightPanelProps) {
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];
  if (tabs.length === 0) return null;

  return (
    <div
      className={cn("relative flex flex-col shrink-0 border-l border-border overflow-hidden", className)}
      style={{ width }}
    >
      {/* Left resize handle */}
      <div
        className="absolute top-0 left-[-3px] w-1.5 h-full cursor-col-resize z-10 hover:bg-accent-blue/50 active:bg-accent-blue/50"
        onMouseDown={onResizeStart}
      />
      {/* Tab bar */}
      <div className="flex items-center border-b border-border shrink-0 bg-bg-secondary">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={cn(
              "px-3 py-1.5 text-xs text-text-secondary transition-colors duration-100 hover:text-text-primary border-b-2",
              activeTab?.id === tab.id ? "border-accent-blue text-text-primary" : "border-transparent"
            )}
            onClick={() => onTabChange?.(tab.id)}
          >
            {tab.label}
          </button>
        ))}
        {onClose && (
          <button
            className="ml-auto px-2 py-1.5 text-text-muted hover:text-text-primary transition-colors duration-100"
            onClick={onClose}
            title="Close panel"
          >
            ×
          </button>
        )}
      </div>
      {/* Content */}
      <div className="flex-1 overflow-hidden">{activeTab?.content}</div>
    </div>
  );
}

export default React.memo(RightPanel);
