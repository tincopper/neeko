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
  /** 项目头与子行的交互回调（折叠 / 右键 / hover 动作槽） */
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
    // （avatar + 粗体名称 + 计数），再加一条横杠是重复分隔，反而显脏。
    // 原实现：`!isLast && 'border-b border-white/[0.04]'`（4% 白，亮色主题下还完全不可见）。
    // 连带删除了 isLast 这条数据链（groupProjects → ProjectsPanel → ProjectItem →
    // ConnectionProjectCard → ProjectGroup）—— 它唯一的消费者就是这条线。
    //
    // 项目头**也不铺行背景**（2026-11-03 用户定案；此前是 `hover:bg-bg-hover`）：
    // 1. hover 反馈已由下面 local / worktree / 会话行承担（各自 `mx-1.5` 圆角块），
    //    项目头再铺一层 = 同一件事强调两次，语义上也不该并排（父级容器 vs 子级单元）。
    // 2. 这一层是**通栏**的：`reset.css` 的 `scrollbar-width: thin` 是经典滚动条
    //    （占布局宽度、只占右侧），底只能铺到滚动容器的内容盒 —— 右侧会留下一条通高
    //    竖条（本机 macOS 实测 ≈13px，宽度随平台 / 缩放变，别照抄这个数值）。
    //    注：容器侧的对称性由 `ProjectsPanel` 的 `scrollbar-hidden` 负责（整条隐藏滚动条、
    //    保留滚动），两者互不替代：前者答「要不要画底」，后者答「两边留白差多少」。
    // 悬停仍然表达「可交互」：动作槽（IDE / Git / Trash / + / Chevron）在 hover 时浮现；
    // 键盘聚焦另有指示（`ring-inset`：外扩的环会被 Island 的 overflow-hidden 裁掉）。
    <div className="group/proj">
      <div
        ref={dragHandleRef}
        role="button"
        tabIndex={0}
        // 拖拽把手只在**项目头**（不是整张卡）：整卡可拖时，点会话行 / 工作树行时手一抖
        // 就变成「拖动了整个项目」，卡片会被抬起并跟手 —— 用户看到的是「项目块自己飘了」。
        {...dragHandleProps}
        className="flex items-center gap-2.5 px-3 py-2.5 cursor-pointer relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-blue"
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
          data-testid="project-group-actions"
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
