import React from "react";
import { cn } from '@/lib/utils';
import { getAvatarStyle, getProjectInitials } from '@/shared/utils/projectAvatar';
import {
  ChevronRightIcon,
  PlusIcon,
  TrashIcon,
  MoreVerticalIcon,
} from "@/shared/components/icons";

interface ProjectGroupActions {
  /** 折叠/展开切换。点�?header 主体�?chevron 按钮均触�?*/
  onToggle: () => void;
  /** 头部 + 按钮：默认语�?= New Worktree */
  onAddWorktree?: () => void;
  /** Hover 槽位：在 IDE 中打开。caller 决定是否提供 */
  onOpenIde?: () => void;
  /** Hover 槽位：弹�?Git 下拉菜单（Commit/Push/Pull/...�?*/
  onGitMenu?: (e: React.MouseEvent) => void;
  /** Hover 槽位：移除项�?*/
  onRemove?: () => void;
  /** 右键菜单 */
  onContextMenu?: (e: React.MouseEvent) => void;
}

interface ProjectGroupProps {
  /** 用于派生 avatar 与字�?*/
  name: string;
  /**
   * 用户�?ProjectSettingsDialog 中指定的 avatar 覆盖色�?
   * `null/undefined` 表示�?name �?DJB2 hash 兜底�?
   */
  avatarColor?: string | null;
  /** 会话总数（一�?= 1 主终�?+ worktrees.length�?*/
  sessionCount: number;
  /** 是否展开 */
  expanded: boolean;
  /** 是否 active 项目（影�?header bg + hover 槽位常驻可见�?*/
  isActive?: boolean;
  /** 是否最后一个项目卡（决定要不要�?hairline 分隔�?*/
  isLast?: boolean;
  actions: ProjectGroupActions;
  /** 自定�?IDE 图标（src）。caller 通常通过 getIdeIconByCommand 提供 */
  ideIconSrc?: string;
  /** 项目 hover 时除 IDE/Git/Trash 之外要追加的按钮（保留扩展位�?*/
  headerExtra?: React.ReactNode;
  /** 强制显示 hover 槽位（如 Git 下拉打开期间�?*/
  forceShowActions?: boolean;
  /** 展开后的 session 行内�?*/
  children?: React.ReactNode;
}

interface HeaderActionButtonProps {
  title: string;
  onClick?: (e: React.MouseEvent) => void;
  hoverColor?: string;
  children: React.ReactNode;
}

const HeaderActionButton: React.FC<HeaderActionButtonProps> = ({
  title,
  onClick,
  hoverColor,
  children,
}) => (
  <button
    type="button"
    title={title}
    className="text-text-muted p-1 rounded-md hover:bg-white/[0.06] transition shrink-0"
    onClick={(e) => {
      e.stopPropagation();
      onClick?.(e);
    }}
    onMouseOver={(e) => {
      if (hoverColor) (e.currentTarget as HTMLElement).style.color = hoverColor;
    }}
    onMouseOut={(e) => {
      (e.currentTarget as HTMLElement).style.color = "";
    }}
  >
    {children}
  </button>
);

const ProjectGroup: React.FC<ProjectGroupProps> = ({
  name,
  avatarColor,
  sessionCount,
  expanded,
  isActive: _isActive = false,
  isLast = false,
  actions,
  ideIconSrc,
  headerExtra,
  forceShowActions = false,
  children,
}) => {
  const avatarStyle = getAvatarStyle({ name, color: avatarColor });
  const initials = getProjectInitials(name);

  return (
    <div className={cn("group/proj", !isLast && "border-b border-white/[0.04]")}>
      <div
        className={cn(
          "flex items-center gap-2.5 px-3 py-2.5 cursor-pointer hover:bg-bg-hover",
        )}
        onClick={actions.onToggle}
        onContextMenu={actions.onContextMenu}
        data-testid="project-group-header"
      >
        <span
          className="w-7 h-7 rounded-md flex items-center justify-center text-[0.95em] font-bold shrink-0 uppercase"
          style={{
            color: avatarStyle.color,
            backgroundColor: avatarStyle.backgroundColor,
            border: `1.5px solid ${avatarStyle.color}`,
          }}
          aria-hidden="true"
        >
          {initials}
        </span>
        <div className="flex-1 flex items-baseline gap-1.5 min-w-0">
          <span className="text-[var(--font-size)] font-semibold text-text-primary truncate">
            {name}
          </span>
          <span className="text-[0.85em] text-text-muted">({sessionCount})</span>
        </div>

        {/* hover 槽位：IDE / Git / Trash —�?active 项目下也只在 hover 出现 */}
        <div
          className={cn(
            "flex items-center gap-0.5 transition-opacity",
            forceShowActions
              ? "opacity-100"
              : "opacity-0 group-hover/proj:opacity-100",
          )}
          onClick={(e) => e.stopPropagation()}
        >
          {actions.onOpenIde && (
            <HeaderActionButton title="Open in IDE" onClick={actions.onOpenIde} hoverColor="#61afef">
              {ideIconSrc ? (
                <img src={ideIconSrc} className="w-3.5 h-3.5 object-contain block" alt="" />
              ) : (
                <MoreVerticalIcon size={13} />
              )}
            </HeaderActionButton>
          )}
          {actions.onGitMenu && (
            <HeaderActionButton title="Git actions" onClick={actions.onGitMenu}>
              <MoreVerticalIcon size={13} />
            </HeaderActionButton>
          )}
          {actions.onRemove && (
            <HeaderActionButton
              title="Remove project"
              onClick={actions.onRemove}
              hoverColor="#f85149"
            >
              <TrashIcon size={13} />
            </HeaderActionButton>
          )}
          {headerExtra}
        </div>

        {actions.onAddWorktree && (
          <HeaderActionButton title="New Worktree" onClick={actions.onAddWorktree}>
            <PlusIcon size={15} />
          </HeaderActionButton>
        )}
        <HeaderActionButton title={expanded ? "Collapse" : "Expand"} onClick={actions.onToggle}>
          <ChevronRightIcon
            size={15}
            className={cn("transition-transform duration-150", expanded && "rotate-90")}
          />
        </HeaderActionButton>
      </div>
      {expanded && <div className="pb-1.5">{children}</div>}
    </div>
  );
};

export default React.memo(ProjectGroup);
