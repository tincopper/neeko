import React from 'react';

import { cn } from '@/lib/utils';
import {
  ChevronRightIcon,
  ListChecksIcon,
  MoreVerticalIcon,
  PlusIcon,
  TrashIcon,
} from '@/shared/components/icons';
import { getAvatarStyle, getProjectInitials } from '@/shared/utils/projectAvatar';

interface ProjectGroupActions {
  /** 折叠/展开切换。点击 header 主体或 chevron 按钮均触发 */
  onToggle: () => void;
  /** 头部 + 按钮：默认语义 = New Worktree */
  onAddWorktree?: () => void;
  /** Hover 槽位：在 IDE 中打开。caller 决定是否提供 */
  onOpenIde?: () => void;
  /** Hover 槽位：弹出 Git 下拉菜单（Commit/Push/Pull/...） */
  onGitMenu?: (e: React.MouseEvent) => void;
  /** Hover 槽位：打开本项目的 Tasks（design §4.2c）。caller 决定是否提供 */
  onOpenTasks?: () => void;
  /** Hover 槽位：移除项目 */
  onRemove?: () => void;
  /** 右键菜单 */
  onContextMenu?: (e: React.MouseEvent) => void;
}

interface ProjectGroupProps {
  /** 用于派生 avatar 与首字母 */
  name: string;
  /**
   * 用户在 ProjectSettingsDialog 中指定的 avatar 覆盖色，
   * `null/undefined` 表示由 name 的 DJB2 hash 兜底。
   */
  avatarColor?: string | null;
  /** 会话总数（一项 = 1 主终端 + worktrees.length） */
  sessionCount: number;
  /** 是否展开 */
  expanded: boolean;
  /** 是否 active 项目（影响 header bg + hover 槽位常驻可见） */
  isActive?: boolean;
  /** 是否最后一个项目卡（决定要不要画 hairline 分隔） */
  actions: ProjectGroupActions;
  /** 自定义 IDE 图标（src）。caller 通常通过 getIdeIconByCommand 提供 */
  ideIconSrc?: string;
  /** 项目 hover 时除 IDE/Git/Trash 之外要追加的按钮（保留扩展位） */
  headerExtra?: React.ReactNode;
  /** 强制显示 hover 槽位（如 Git 下拉打开期间） */
  forceShowActions?: boolean;
  /** 展开后的 session 行内容 */
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
    className="text-text-muted p-1 rounded-md hover:bg-bg-hover transition shrink-0"
    onClick={(e) => {
      e.stopPropagation();
      onClick?.(e);
    }}
    onFocus={(e) => {
      if (hoverColor) (e.currentTarget as HTMLElement).style.color = hoverColor;
    }}
    onBlur={(e) => {
      (e.currentTarget as HTMLElement).style.color = '';
    }}
    onMouseOver={(e) => {
      if (hoverColor) (e.currentTarget as HTMLElement).style.color = hoverColor;
    }}
    onMouseOut={(e) => {
      (e.currentTarget as HTMLElement).style.color = '';
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
  actions,
  ideIconSrc,
  headerExtra,
  forceShowActions = false,
  children,
}) => {
  const avatarStyle = getAvatarStyle({ name, color: avatarColor });
  const initials = getProjectInitials(name);

  return (
    // 项目之间不画分割线（2026-10-27 用户定案）：项目头本身已经是视觉单元
    // （avatar + 粗体名称 + 计数），且 hover 时整行有 bg-bg-hover 背景块 ——
    // 背景块已经承担了「分组」职责，再加一条横杠是三重分隔，反而显脏。
    // 原实现：`!isLast && 'border-b border-white/[0.04]'`（4% 白，亮色主题下还完全不可见）。
    // 连带删除了 isLast 这条数据链（groupProjects → ProjectsPanel → ProjectItem →
    // ConnectionProjectCard → ProjectGroup）—— 它唯一的消费者就是这条线。
    <div className="group/proj">
      <div
        role="button"
        tabIndex={0}
        className={cn(
          'flex items-center gap-2.5 px-3 py-2.5 cursor-pointer hover:bg-bg-hover relative',
        )}
        onClick={actions.onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            actions.onToggle();
          }
        }}
        onContextMenu={actions.onContextMenu}
        data-testid="project-group-header"
      >
        <span
          data-testid="project-group-avatar"
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

        {/* 按钮 overlay：hover 时出现，不消耗 flex 空间 */}
        <div
          role="presentation"
          className={cn(
            'absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-0.5 transition-opacity',
            forceShowActions
              ? 'opacity-100 pointer-events-auto'
              : 'opacity-0 pointer-events-none group-hover/proj:opacity-100 group-hover/proj:pointer-events-auto',
          )}
          onClick={(e) => e.stopPropagation()}
        >
          {actions.onOpenIde && (
            <HeaderActionButton
              title="Open in IDE"
              onClick={actions.onOpenIde}
              hoverColor="#61afef"
            >
              {ideIconSrc ? (
                <img src={ideIconSrc} className="w-3.5 h-3.5 object-contain block" alt="" />
              ) : (
                <MoreVerticalIcon size={13} />
              )}
            </HeaderActionButton>
          )}
          {/* 「Open Tasks」在 Git 菜单之前：它是项目级入口，与「Open in IDE」同一层语义
              （「拿这个项目做点什么」），比 Git 的单次动作更常点。 */}
          {actions.onOpenTasks && (
            <HeaderActionButton title="Open Tasks" onClick={actions.onOpenTasks}>
              <ListChecksIcon size={13} />
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
          {actions.onAddWorktree && (
            <HeaderActionButton title="New Worktree" onClick={actions.onAddWorktree}>
              <PlusIcon size={15} />
            </HeaderActionButton>
          )}
          <HeaderActionButton title={expanded ? 'Collapse' : 'Expand'} onClick={actions.onToggle}>
            <ChevronRightIcon
              size={15}
              className={cn('transition-transform duration-150', expanded && 'rotate-90')}
            />
          </HeaderActionButton>
        </div>
      </div>
      {expanded && <div className="pb-1.5">{children}</div>}
    </div>
  );
};

export default React.memo(ProjectGroup);
