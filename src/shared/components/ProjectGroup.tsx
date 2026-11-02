import type { DraggableSyntheticListeners } from '@dnd-kit/core';
import React from 'react';

import { cn } from '@/lib/utils';
import { ChevronRightIcon, PlusIcon, TrashIcon, MoreVerticalIcon } from '@/shared/components/icons';
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
  /**
   * 拖拽把手（`dnd-kit` 的 `setActivatorNodeRef`）：只有项目头能发起拖动。
   *
   * 只收 `listeners`（指针），**不收** `attributes`：后者会给这个 div 再套一层
   * `role`/`tabIndex`/键盘激活键，而项目头自己已经有 `role="button"` 与 Enter/Space
   * 折叠语义 —— 两套键盘约定叠在同一个节点上，空格键到底该折叠还是该开始拖动就说不清了。
   *
   * 因为不收 `attributes`，dnd-kit 的 `KeyboardSensor` 注入的 `onKeyDown` 也随之消失：
   * 项目列表**只支持指针拖拽**。注册了却无人消费的传感器是死配置（`useSensors` 里
   * 的 `KeyboardSensor` 已同步移除），两边必须一起说真话。
   */
  dragHandleRef?: (node: HTMLElement | null) => void;
  /**
   * 把手的指针监听器（dnd-kit `listeners` 的真实类型）。
   *
   * 收窄成 `DraggableSyntheticListeners` 而不是 `HTMLAttributes`：后者能塞进 `children` /
   * `style` / 任意 `on*`，一个误传就能让「拖拽把手」变成「整行行为覆写」的入口。
   */
  dragHandleProps?: DraggableSyntheticListeners;
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
  dragHandleRef,
  dragHandleProps,
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
        ref={dragHandleRef}
        role="button"
        tabIndex={0}
        // 拖拽把手只在**项目头**（不是整张卡）：整卡可拖时，点会话行 / 工作树行时手一抖
        // 就变成「拖动了整个项目」，卡片会被抬起并跟手 —— 用户看到的是「项目块自己飘了」。
        {...dragHandleProps}
        className={cn(
          'flex items-center gap-2.5 px-3 py-2.5 cursor-pointer hover:bg-bg-hover relative',
        )}
        onClick={actions.onToggle}
        onKeyDown={(e) => {
          // 折叠是本节点**唯一**的键盘语义：Enter/Space 展开/收起。
          // 展开 `dragHandleProps` 之后再写这一行，于是即使调用方误传了 `onKeyDown`
          // （dnd-kit 的键盘激活就在 `attributes` 里，本项目不传），也不会把折叠顶掉 ——
          // 「空格到底是折叠还是开始拖动」在构造上只有一个答案。
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
