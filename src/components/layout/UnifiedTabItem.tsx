import React, { useCallback } from "react";
import { Terminal, FileText, ArrowLeftRight } from "lucide-react";
import { cn } from "../../utils/cn";
import type { Tab } from "../../types/tab";

interface UnifiedTabItemProps {
  tab: Tab;
  isActive: boolean;
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
}

/** 根据 tab kind 返回对应图标 */
function getTabIcon(kind: Tab["data"]["kind"]) {
  switch (kind) {
    case "terminal":
      return Terminal;
    case "file":
      return FileText;
    case "diff":
      return ArrowLeftRight;
  }
}

const UnifiedTabItem: React.FC<UnifiedTabItemProps> = React.memo(
  ({ tab, isActive, onActivate, onClose }) => {
    const handleClick = useCallback(() => {
      onActivate(tab.id);
    }, [tab.id, onActivate]);

    const handleClose = useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation();
        onClose(tab.id);
      },
      [tab.id, onClose]
    );

    const Icon = getTabIcon(tab.data.kind);

    // 状态指示器
    const showRunningDot =
      tab.data.kind === "terminal" && tab.data.status === "Running";
    const showDirtyDot =
      tab.data.kind === "file" && tab.data.isDirty;

    return (
      <div
        className={cn(
          "flex items-center gap-1 h-6 px-2 rounded-md cursor-pointer min-w-0 transition-colors",
          isActive
            ? "bg-bg-hover text-text-primary"
            : "text-text-secondary hover:bg-bg-hover hover:text-text-primary"
        )}
        onClick={handleClick}
        title={tab.title}
      >
        <Icon
          size={12}
          className="shrink-0 opacity-70"
          style={{ fontSize: "var(--terminal-font-size)" }}
        />

        {showRunningDot && (
          <span className="w-1.5 h-1.5 rounded-full bg-status-running shrink-0" />
        )}
        {showDirtyDot && (
          <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
        )}

        <span
          className="truncate"
          style={{ fontSize: "var(--terminal-font-size)" }}
        >
          {tab.title}
        </span>

        <button
          className="tb-icon-btn w-4 h-4 rounded text-inherit hover:bg-bg-hover transition-colors flex items-center justify-center shrink-0 leading-none"
          style={{ fontSize: "var(--terminal-font-size)" }}
          onClick={handleClose}
          title="Close tab"
        >
          ×
        </button>
      </div>
    );
  }
);

UnifiedTabItem.displayName = "UnifiedTabItem";

export default UnifiedTabItem;
