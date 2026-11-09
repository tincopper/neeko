import type { DraggableSyntheticListeners } from '@dnd-kit/core';
import React from 'react';

import { cn } from '@/lib/utils';
import { ChevronRightIcon, PlusIcon, TrashIcon, MoreVerticalIcon } from '@/shared/components/icons';
import { getAvatarStyle, getProjectInitials } from '@/shared/utils/projectAvatar';

import HoverActionSlot, { META_FADE_GROUP_CLASSES } from './HoverActionSlot';

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
    // 项目卡是**岛式容器**（`bg-bg-secondary` 圆角块由调用方根节点负责，见
    // `ProjectItem` / `ConnectionProjectCard`）；本组件负责岛内的行几何。
    //
    // 分割线史（2026-10-27 用户定案）：项目之间不画横杠 —— 原实现
    // `border-b border-white/[0.04]`（4% 白，亮色主题下完全不可见），连带删除了为它
    // 服务的 isLast 数据链。方案 C 落地后分隔职责由岛间距（`mb-1.5`）承担，结论不变。
    //
    // 项目头**重新铺 hover 底**（2026-11-08 方案 C 定案，废止 2026-11-03 的通栏定案）：
    // 岛式布局里项目头是「岛内的第一行」，与单元行同一套 hover 反馈才一致；且头已随岛
    // 内缩（`mx-1`），不再是通栏 —— 当年「经典滚动条占位留通高竖条」的前提消失。
    // 悬停的完整表达：头铺 hover 实底 + 计数文本淡出 + 动作槽淡入（三者同一时刻只说一件事）。
    // 菜单展开（forceShowActions）时也让 header 保持同一层实底，否则动作槽会变成孤立色块。
    //
    // `group/proj` 挂在**项目头这一行**（2026-11-08 用户定案）：挂在整张卡外层时，
    // hover 到展开的 local / 会话行也会命中命名组，于是「鼠标只是路过会话」项目工具栏
    // 就冒出来。收窄到 header 行后，动作槽与 pill 的 hover 门只认项目头自己。
    // 键盘聚焦另有指示（`ring-inset`：外扩的环会被 Island 的 overflow-hidden 裁掉）。
    <div data-testid="project-group-root">
      <div
        ref={dragHandleRef}
        role="button"
        tabIndex={0}
        // 拖拽把手只在**项目头**（不是整张卡）：整卡可拖时，点会话行 / 工作树行时手一抖
        // 就变成「拖动了整个项目」，卡片会被抬起并跟手 —— 用户看到的是「项目块自己飘了」。
        {...dragHandleProps}
        className={cn(
          'group/proj flex items-center gap-2 mx-1 mt-1 px-1.5 py-[5px] rounded-md cursor-pointer relative hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-blue',
          forceShowActions && 'bg-bg-hover',
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
        {/* 方案 C：20px 无描边色块（色彩身份留在 color + 淡底），字重降档 ——
            旧 28px 描边方块是最重的「模板感」来源。 */}
        <span
          data-testid="project-group-avatar"
          className="w-5 h-5 rounded-md flex items-center justify-center text-[0.75em] font-medium shrink-0 uppercase"
          style={{
            color: avatarStyle.color,
            backgroundColor: avatarStyle.backgroundColor,
          }}
          aria-hidden="true"
        >
          {initials}
        </span>
        <span className="flex-1 min-w-0 text-[var(--font-size)] font-medium text-text-primary truncate">
          {name}
        </span>
        {/* 计数文本：行尾对齐；hover 时让位给动作槽（同一位置只说一件事） */}
        <span
          data-testid="project-group-count"
          className={cn(
            'shrink-0 px-1.5 py-1 font-mono text-[0.75em] leading-none text-text-muted transition-opacity',
            META_FADE_GROUP_CLASSES.proj,
          )}
        >
          {sessionCount}
        </span>

        {/* 统一 HoverActionSlot：hover 时出现，不消耗 flex 空间；用与 header hover 一致的实底
            压住项目名 / 计数，不画圆角、阴影或额外内边距，避免浮块 */}
        <HoverActionSlot
          testId="project-group-actions"
          group="proj"
          forceShow={forceShowActions}
          rightClassName="right-2"
          className="gap-0.5"
        >
          {actions.onOpenIde ? (
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
          ) : null}
          {actions.onGitMenu ? (
            <HeaderActionButton title="Git actions" onClick={actions.onGitMenu}>
              <MoreVerticalIcon size={13} />
            </HeaderActionButton>
          ) : null}
          {actions.onRemove ? (
            <HeaderActionButton
              title="Remove project"
              onClick={actions.onRemove}
              hoverColor="#f85149"
            >
              <TrashIcon size={13} />
            </HeaderActionButton>
          ) : null}
          {headerExtra}
          {actions.onAddWorktree ? (
            <HeaderActionButton title="New Worktree" onClick={actions.onAddWorktree}>
              <PlusIcon size={15} />
            </HeaderActionButton>
          ) : null}
          <HeaderActionButton title={expanded ? 'Collapse' : 'Expand'} onClick={actions.onToggle}>
            <ChevronRightIcon
              size={15}
              className={cn('transition-transform duration-150', expanded && 'rotate-90')}
            />
          </HeaderActionButton>
        </HoverActionSlot>
      </div>
      {/* 展开区：岛内左右各缩 4px（行不再自带 `mx-1.5`，缩进由这里统一给） */}
      {expanded ? <div className="px-1 pb-1">{children}</div> : null}
    </div>
  );
};

export default React.memo(ProjectGroup);
