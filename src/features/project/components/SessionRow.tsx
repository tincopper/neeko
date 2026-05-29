import React from "react";
import { cn } from '@/lib/utils';
import { TerminalIcon, FolderGitIcon } from "@/shared/components/icons";
import SessionChips from "./SessionChips";

type SessionKind = "local" | "worktree";

interface SessionRowProps {
  kind: SessionKind;
  label: string;
  branch?: string;
  isActive?: boolean;
  ahead?: number;
  changes?: { add: number; del: number };
  shortcut?: string;
  title?: string;
  onClick?: (e: React.MouseEvent) => void;
  /** 行尾追加内容（如 worktree �?trash 按钮、loading spinner）；显示�?chip 区右�?*/
  trailing?: React.ReactNode;
}

const SessionRow: React.FC<SessionRowProps> = ({
  kind,
  label,
  branch,
  isActive = false,
  ahead,
  changes,
  shortcut,
  title,
  onClick,
  trailing,
}) => {
  const Icon = kind === "worktree" ? FolderGitIcon : TerminalIcon;
  return (
    <div
      className={cn(
        "group flex items-center gap-2.5 pl-4 pr-3 py-2 mx-1.5 rounded-md cursor-pointer transition-colors",
        isActive ? "bg-bg-selected" : "hover:bg-bg-hover",
      )}
      onClick={onClick}
      title={title}
    >
      <span
        className={cn(
          "w-7 h-7 rounded-md flex items-center justify-center shrink-0",
          isActive ? "text-text-primary" : "text-text-muted",
        )}
        style={{
          backgroundColor: isActive ? "var(--bg-selected)" : "transparent",
        }}
      >
        <Icon size={16} />
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-[var(--font-size)] font-semibold text-text-primary truncate">
          {label}
        </div>
        {branch && (
          <div className="text-[0.85em] font-mono text-text-muted truncate">{branch}</div>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {isActive && ahead !== undefined && <SessionChips.Ahead ahead={ahead} />}
        {changes && <SessionChips.Changes add={changes.add} del={changes.del} />}
        {isActive && shortcut && <SessionChips.Kbd>{shortcut}</SessionChips.Kbd>}
        {trailing}
      </div>
    </div>
  );
};

export default React.memo(SessionRow);
