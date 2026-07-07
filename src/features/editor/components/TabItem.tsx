import React, { useCallback } from "react";
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Terminal, FileText, ArrowLeftRight, GitBranch, Globe, Pin } from "@/shared/components/icons"
import { cn } from '@/lib/utils';
import { getAgentIconSrc } from '@/shared/utils/agents';
import { fileIconSrc } from '@/shared/utils/fileIcons';
import type { Tab } from '@/shared/types/tab';
import type { AgentConfig } from '@/shared/types';

interface TabItemProps {
  tab: Tab;
  isActive: boolean;
  isPinned?: boolean;
  reorderable?: boolean;
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onContextMenu?: (tabId: string, e: React.MouseEvent) => void;
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

const TabItem: React.FC<TabItemProps> = React.memo(
  ({ tab, isActive, isPinned = false, reorderable = false, onActivate, onClose, onContextMenu, agents = [] }) => {
    const {
      attributes,
      listeners,
      setNodeRef,
      transform,
      transition,
      isDragging,
    } = useSortable({
      id: tab.id,
      disabled: !reorderable,
    });

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
    //   Running �?green (accent-green)  Failed �?red (status-failed)
    // Idle (normal completion) shows no dot �?the task finished cleanly.
    const showStatusDot = terminalStatus === "Running" || terminalStatus === "Failed";
    const statusDotColor =
      terminalStatus === "Running" ? "bg-accent-green" : "bg-status-failed";
    const showDirtyDot =
      tab.data.kind === "file" && tab.data.isDirty;

    const style = {
      transform: CSS.Transform.toString(transform),
      transition: transition ?? undefined,
    };

    return (
      <div
        ref={reorderable ? setNodeRef : undefined}
        style={reorderable ? style : undefined}
        className={cn(
          "flex items-center gap-1 h-6 px-2 rounded-md min-w-0 transition-colors",
          isActive
            ? "bg-bg-selected text-text-primary"
            : "text-text-secondary hover:bg-bg-hover hover:text-text-primary",
          isDragging && "opacity-50 shadow-lg shadow-black/20 z-50",
        )}
        onClick={handleClick}
        onAuxClick={handleAuxClick}
        onContextMenu={handleContextMenu}
        {...(reorderable ? attributes : {})}
        {...(reorderable ? listeners : {})}
        title={tab.title}
      >
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
          className="truncate cursor-pointer"
          style={{ fontSize: "var(--terminal-font-size)" }}
        >
          {tab.title}
        </span>

        {!isPinned && (
          <button
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

TabItem.displayName = "TabItem";

export default TabItem;
