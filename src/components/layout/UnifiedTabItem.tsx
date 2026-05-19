import React, { useCallback } from "react";
import { Terminal, FileText, ArrowLeftRight, GitBranch, Globe, Pin } from "lucide-react";
import { cn } from "../../utils/cn";
import { getAgentIconSrc } from "../../utils/agents";
import { fileIconSrc } from "../../utils/fileIcons";
import { useProjectItemDrag } from "../project/useProjectItemDrag";
import type { Tab } from "../../types/tab";
import type { AgentConfig } from "../../types";

interface UnifiedTabItemProps {
  tab: Tab;
  isActive: boolean;
  isPinned?: boolean;
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onContextMenu?: (tabId: string, e: React.MouseEvent) => void;
  onReorder?: (draggedId: string, targetId: string, position: "before" | "after") => void;
  /** CSS selector that scopes valid drop targets to a single tab bar (set by UnifiedTabBar). */
  dragScopeSelector?: string;
  agents?: AgentConfig[];
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
    case "gitLog":
      return GitBranch;
    case "html-preview":
      return Globe;
  }
}

const UnifiedTabItem: React.FC<UnifiedTabItemProps> = React.memo(
  ({ tab, isActive, isPinned = false, onActivate, onClose, onContextMenu, onReorder, dragScopeSelector, agents = [] }) => {
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

    const handleContextMenu = useCallback(
      (e: React.MouseEvent) => {
        onContextMenu?.(tab.id, e);
      },
      [tab.id, onContextMenu]
    );

    const handleAuxClick = useCallback(
      (e: React.MouseEvent) => {
        if (e.button === 1) {
          e.preventDefault();
          // Pinned tabs cannot be closed via middle-click
          if (!isPinned) {
            onClose(tab.id);
          }
        }
      },
      [tab.id, isPinned, onClose]
    );

    // 拖拽重排（pinned tab 不参与）
    const dragEnabled = !isPinned && !!onReorder;
    const handleDragEnd = useCallback(
      (draggedId: string, targetId: string, position: "before" | "after") => {
        onReorder?.(draggedId, targetId, position);
      },
      [onReorder],
    );
    const drag = useProjectItemDrag({
      projectId: tab.id,
      axis: "x",
      scopeSelector: dragScopeSelector ?? "[data-tab-bar]",
      onDragEnd: dragEnabled ? handleDragEnd : undefined,
    });

    const Icon = getTabIcon(tab.data.kind);

    const data = tab.data;
    const agentIconSrc =
      data.kind === "terminal" && data.agentId
        ? getAgentIconSrc(
            agents.find((a) => a.id === data.agentId)?.icon
          )
        : null;

    const fileIcon =
      data.kind === "file" || data.kind === "diff"
        ? fileIconSrc(data.fileName)
        : null;

    // 状态指示器
    const terminalStatus =
      tab.data.kind === "terminal" ? tab.data.status : null;
    // Show a coloured dot for active task terminals:
    //   Running → green (accent-green)  Failed → red (status-failed)
    // Idle (normal completion) shows no dot — the task finished cleanly.
    const showStatusDot = terminalStatus === "Running" || terminalStatus === "Failed";
    const statusDotColor =
      terminalStatus === "Running" ? "bg-accent-green" : "bg-status-failed";
    const showDirtyDot =
      tab.data.kind === "file" && tab.data.isDirty;

    const showDropBefore =
      drag.dropIndicator?.targetId === tab.id && drag.dropIndicator.position === "before";
    const showDropAfter =
      drag.dropIndicator?.targetId === tab.id && drag.dropIndicator.position === "after";

    return (
      <div
        data-drag-id={dragEnabled ? tab.id : undefined}
        data-drag-disabled={!dragEnabled || undefined}
        className={cn(
          "relative flex items-center gap-1 h-6 px-2 rounded-md cursor-pointer min-w-0 transition-colors",
          isActive
            ? "bg-bg-selected text-text-primary"
            : "text-text-secondary hover:bg-bg-hover hover:text-text-primary",
          drag.isDragging && "opacity-60",
        )}
        style={
          drag.isDragging
            ? { transform: `translate(${drag.dragOffset.x}px, ${drag.dragOffset.y}px)`, zIndex: 5 }
            : undefined
        }
        onClick={handleClick}
        onAuxClick={handleAuxClick}
        onContextMenu={handleContextMenu}
        onPointerDown={dragEnabled ? drag.handlePointerDown : undefined}
        onPointerMove={dragEnabled ? drag.handlePointerMove : undefined}
        onPointerUp={dragEnabled ? drag.handlePointerUp : undefined}
        onPointerCancel={dragEnabled ? drag.handlePointerCancel : undefined}
        title={tab.title}
      >
        {/* Drop indicator: 左/右竖线 */}
        {showDropBefore && (
          <span className="pointer-events-none absolute left-0 top-0 bottom-0 w-0.5 bg-accent rounded-full" />
        )}
        {showDropAfter && (
          <span className="pointer-events-none absolute right-0 top-0 bottom-0 w-0.5 bg-accent rounded-full" />
        )}

        {agentIconSrc ? (
          <img
            src={agentIconSrc}
            width={12}
            height={12}
            className="shrink-0 opacity-70"
            alt=""
          />
        ) : fileIcon ? (
          <img
            src={fileIcon}
            width={12}
            height={12}
            className="shrink-0 opacity-70"
            alt=""
          />
        ) : (
          <Icon
            size={12}
            className="shrink-0 opacity-70"
            style={{ fontSize: "var(--terminal-font-size)" }}
          />
        )}

        {showStatusDot && (
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDotColor}`} />
        )}
        {showDirtyDot && (
          <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
        )}

        {isPinned && (
          <Pin size={10} className="shrink-0 opacity-50" />
        )}

        <span
          className="truncate"
          style={{ fontSize: "var(--terminal-font-size)" }}
        >
          {tab.title}
        </span>

        {!isPinned && (
          <button
            data-no-drag
            className="tb-icon-btn w-4 h-4 rounded text-inherit hover:bg-bg-hover transition-colors flex items-center justify-center shrink-0 leading-none"
            style={{ fontSize: "var(--terminal-font-size)" }}
            onClick={handleClose}
            title="Close tab"
          >
            ×
          </button>
        )}
      </div>
    );
  }
);

UnifiedTabItem.displayName = "UnifiedTabItem";

export default UnifiedTabItem;
