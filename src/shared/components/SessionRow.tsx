import React, { useState } from 'react';

import { cn } from '@/lib/utils';
import { ChevronRightIcon, TerminalIcon, FolderGitIcon } from '@/shared/components/icons';
import SessionChips from '@/shared/components/SessionChips';
import SessionStatusIcon from '@/shared/components/SessionStatusIcon';
import type { SessionState } from '@/shared/types/liveSessions';

type SessionKind = 'local' | 'worktree';

interface SessionRowProps {
  kind: SessionKind;
  label: string;
  branch?: string;
  isActive?: boolean;
  /**
   * 本单元的**最高优先级会话状态**（`dominantState`）。
   *
   * `undefined` / `null` = 该单元没有会话 ⇒ **不画点**（不是灰点：灰点会让人以为
   * 「有个空闲会话」）。状态只有注册表一个来源，视图不推断。
   */
  status?: SessionState | null;
  /**
   * 单元下的会话子列表（`SessionList`）。给出时行尾出现展开箭头。
   *
   * **默认折叠**，且折叠时子节点根本**不渲染** —— 挂载即订阅 + 每单元可能的几十行
   * 会话在侧栏里全是白付的成本。
   */
  children?: React.ReactNode;
  /**
   * 待 push 提交数（相对 `@{upstream}`）。**只在激活行展示**（`isActive`）——
   * 该数字的值只有激活单元才会被写入 store（见 `useAheadBehindSync` / `useGitStatusEventsSync`），
   * 因此这个门与数据来源同一定义，不是视觉偏好。
   */
  ahead?: number;
  // 注：曾有 `changes?: { add, del }`（+A / -D 行级统计）。G4 把 numstat 移出 status 热路径后
  // 它的数据源（`FileChange.additions/deletions`）恒为 0，chip 永不渲染，已整体删除。
  shortcut?: string;
  title?: string;
  onClick?: (e: React.MouseEvent) => void;
  /**
   * 编辑态替换 label + branch 区（linked worktree 的行内重命名）。
   * 由调用方拥有状态与输入框 ref —— 展示组件不持有输入状态。
   */
  editing?: React.ReactNode;
  /** 双击 label 的语义（worktree = 开始重命名；local 不传）。 */
  onLabelDoubleClick?: (e: React.MouseEvent) => void;
  /** label 的 title（如 "Double-click to rename"）。 */
  labelTitle?: string;
  /** 删除中：整行播放淡出并把交互关掉（`wt-deleting`）。 */
  deleting?: boolean;
  /** 行尾追加内容（如 worktree 的 trash 按钮 / loading spinner）；显示在 chip 区右侧 */
  trailing?: React.ReactNode;
}

/**
 * 侧栏的一个「执行单元」行（主 checkout / linked worktree）。
 *
 * # 交互结构（a11y）
 *
 * 行 = **容器 + 一个真按钮**（打开该单元终端）+ 一组兄弟动作（展开箭头 / trailing）。
 * 不用 `div role="button"` 包住按钮：ARIA 不允许交互元素嵌套，且内层按钮的 Enter/Space
 * 会被外层吞掉。编辑态（重命名输入框）期间主体不再是按钮 —— 输入框不能住进按钮里。
 */
const SessionRow: React.FC<SessionRowProps> = ({
  kind,
  label,
  branch,
  isActive = false,
  status = null,
  ahead,
  shortcut,
  title,
  onClick,
  editing,
  onLabelDoubleClick,
  labelTitle,
  deleting = false,
  trailing,
  children,
}) => {
  const Icon = kind === 'worktree' ? FolderGitIcon : TerminalIcon;
  const [expanded, setExpanded] = useState(false);
  const hasChildren = children !== undefined && children !== null;

  const leading = (
    <span
      className={cn(
        'relative w-7 h-7 rounded-md flex items-center justify-center shrink-0',
        isActive ? 'text-text-primary' : 'text-text-muted',
      )}
      style={{
        backgroundColor: isActive ? 'var(--bg-selected)' : 'transparent',
      }}
    >
      <Icon size={16} />
      {status && (
        /* 角标贴在图标右下角（原型 `.face-dot`）：底圈取面板面的颜色，把点从图标上摘下来 */
        <span
          className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-bg-primary grid place-items-center"
          data-testid="unit-status-badge"
        >
          <SessionStatusIcon status={status} size={7} />
        </span>
      )}
    </span>
  );

  const labelBlock = (
    <span className="flex-1 min-w-0">
      <span
        className="block text-[var(--font-size)] font-semibold text-text-primary truncate"
        onDoubleClick={onLabelDoubleClick}
        title={labelTitle}
      >
        {label}
      </span>
      {branch && (
        <span className="block text-[0.85em] font-mono text-text-muted truncate">{branch}</span>
      )}
    </span>
  );

  return (
    <>
      <div
        className={cn(
          'group flex items-center gap-2.5 pl-4 pr-3 py-2 mx-1.5 rounded-md transition-colors',
          deleting && 'wt-deleting',
          isActive ? 'bg-bg-selected' : 'hover:bg-bg-hover',
        )}
        title={title}
      >
        {editing ? (
          <div className="flex flex-1 min-w-0 items-center gap-2.5">
            {leading}
            <div className="flex-1 min-w-0">{editing}</div>
          </div>
        ) : (
          <button
            type="button"
            className="flex flex-1 min-w-0 items-center gap-2.5 bg-transparent border-none p-0 text-left cursor-pointer"
            onClick={onClick}
          >
            {leading}
            {labelBlock}
          </button>
        )}
        <div className="flex items-center gap-2 shrink-0">
          {isActive && ahead !== undefined && <SessionChips.Ahead ahead={ahead} />}
          {shortcut && (
            <span className="hidden group-hover:inline-flex">
              <SessionChips.Kbd>{shortcut}</SessionChips.Kbd>
            </span>
          )}
          {hasChildren && (
            <button
              type="button"
              data-no-drag
              aria-expanded={expanded}
              aria-label={expanded ? 'Collapse sessions' : 'Expand sessions'}
              className="bg-transparent border-none text-text-muted cursor-pointer px-1 py-0.5 rounded flex items-center transition-colors hover:bg-bg-hover hover:text-text-primary"
              onClick={(e) => {
                // 行本身的点击语义是「打开该单元终端」—— 展开是另一件事，不能顺便切过去
                e.stopPropagation();
                setExpanded((v) => !v);
              }}
            >
              <ChevronRightIcon
                size={12}
                className={cn('transition-transform duration-150', expanded && 'rotate-90')}
              />
            </button>
          )}
          {trailing}
        </div>
      </div>
      {/* 子列表：只靠缩进表达层级 —— 竖线在窄侧栏里是一条持续的视觉噪声，
          而且和单元行自己的左缘打架。缩进值让会话图标对齐单元标签的起点。 */}
      {hasChildren && expanded && <div className="ml-[3.25rem] mr-1 mb-1">{children}</div>}
    </>
  );
};

export default React.memo(SessionRow);
