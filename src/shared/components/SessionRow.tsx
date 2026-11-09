import React, { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';
import { ChevronRightIcon, TerminalIcon, FolderGitIcon } from '@/shared/components/icons';
import SessionChips from '@/shared/components/SessionChips';

import HoverActionSlot from './HoverActionSlot';

type SessionKind = 'local' | 'worktree';

/** 28px = 展开箭头 20px（px-1 + 12px icon） + 右槽 gap-2 8px；覆盖槽让开箭头，避免重叠。 */
const ACTION_OFFSET_WITH_CHEVRON = 'right-7';

interface SessionRowProps {
  kind: SessionKind;
  label: string;
  isActive?: boolean;
  /**
   * 单元下的会话子列表（`SessionList`）。给出时行尾出现展开箭头。
   *
   * 已有会话时首次渲染默认展开；折叠时子节点根本**不渲染** —— 挂载即订阅 + 每单元
   * 可能的几十行会话在侧栏里全是白付的成本。后续只在会话数增长时自动展开，尊重用户
   * 的手动折叠。
   */
  children?: React.ReactNode;
  /**
   * 该单元内**有会话被选中**（前台 tab 是它的一条会话）。
   *
   * 选中样式只出现在最具体的一层：子行用强调色淡底 + 左侧色条，父行则**不再填充** ——
   * 「当前会话」本来就蕴含「当前单元」，两级同色填充会让读者分不清哪个是当前。
   * 传 `true` 时父行只靠文字对比度表达「当前单元」。
   */
  childActive?: boolean;
  /**
   * 子列表当前条数（`SessionList` 的会话数）。
   *
   * 用于「**新会话出现就自动展开**」：条数比上一次多 ⇒ 展开；条数不变则尊重用户的手动
   * 折叠（否则用户刚收起，下一次轮询/状态刷新又把它弹开）。`undefined` = 不自动展开。
   */
  childCount?: number;
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
   * 由调用方拥有**草稿状态**，输入框的 focus / 全选归 `InlineRenameInput` —— 展示组件
   * 与行状态机都不持有 ref。
   */
  editing?: React.ReactNode;
  /** 双击 label 的语义（worktree = 开始重命名；local 不传）。 */
  onLabelDoubleClick?: (e: React.MouseEvent) => void;
  /** label 的 title（如 "Double-click to rename"）。 */
  labelTitle?: string;
  /** 删除中：整行播放淡出并把交互关掉（`wt-deleting`）。 */
  deleting?: boolean;
  /** 行尾 hover 覆盖槽（worktree 的 trash 按钮 / spinner）；绝对定位，不占 flex 宽度。 */
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
  isActive = false,
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
  childCount,
  childActive = false,
}) => {
  const Icon = kind === 'worktree' ? FolderGitIcon : TerminalIcon;
  const hasChildren = children !== undefined && children !== null;

  // 首次渲染就展开「本来就有会话」的单元（用初值而不是 effect：否则首帧是收起的，
  // 第二帧才弹开 —— 侧栏会在每次面板重挂载时闪一下）。
  const [expanded, setExpanded] = useState(() => (childCount ?? 0) > 0);

  // 之后只认**增长**：新会话出现 ⇒ 自动展开；条数不变则尊重用户的手动折叠。
  const previousCount = useRef(childCount ?? 0);
  useEffect(() => {
    const count = childCount ?? 0;
    if (count > previousCount.current) setExpanded(true);
    previousCount.current = count;
  }, [childCount]);

  /** 只有子列表真的存在且展开时，子行才能接管父行的选中态。 */
  const childTakesSelection = hasChildren && expanded && childActive;

  // 方案 C（2026-11-08 定案）：图标**裸用**，不再有 28px 方块 —— 三层各挂一个大图标块
  // 是旧版「模板感」最重的来源。单元行也不再画状态角标：状态由展开后的子会话行表达。
  const leading = (
    <span
      data-testid="unit-face"
      className={cn(
        'flex items-center justify-center w-[15px] h-[15px] shrink-0',
        isActive || childActive ? 'text-text-primary' : 'text-text-muted',
      )}
    >
      <Icon size={15} />
    </span>
  );

  // 字重降为 medium：项目头是唯一的 medium 主层，单元行靠颜色（primary vs secondary）分层。
  // 分支名不再进侧栏行（2026-11-08 用户定案）：它常驻占行宽，而分支信息在选中单元后
  // 下方即可查看 —— 方案 C 曾把它收成行内等宽次要文本，实测仍显冗余，整体删除。
  const labelBlock = (
    <span
      className={cn(
        'flex-1 min-w-0 truncate text-[var(--font-size)] font-medium',
        isActive || childActive ? 'text-text-primary' : 'text-text-secondary',
      )}
      onDoubleClick={onLabelDoubleClick}
      title={labelTitle}
    >
      {label}
    </span>
  );

  return (
    <>
      <div
        data-testid="unit-row"
        className={cn(
          // 岛内几何（方案 C）：行自带左右 8px / 上下 5px 内距，不再有 `mx-1.5` ——
          // 岛的左右缩进由 `ProjectGroup` 展开区统一给。
          'group relative flex items-center gap-2 pl-2 pr-1.5 py-[5px] rounded-md transition-colors',
          'hover:bg-bg-hover',
          deleting && 'wt-deleting',
          // 三态：子行被选中 ⇒ 父行不填充（把「当前」让给子行）；否则按单元是否当前填充。
          // 子行只有真的画出来时才接管选中态；折叠期间父行仍是唯一可见的「当前」。
          isActive && !childTakesSelection && 'bg-bg-selected',
          deleting && 'bg-bg-hover',
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
          {isActive && ahead !== undefined ? <SessionChips.Ahead ahead={ahead} /> : null}
          {shortcut ? (
            <span className="hidden group-hover:inline-flex">
              <SessionChips.Kbd>{shortcut}</SessionChips.Kbd>
            </span>
          ) : null}
          {hasChildren ? (
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
          ) : null}
        </div>
        {trailing ? (
          <HoverActionSlot
            testId="unit-row-trailing"
            group="plain"
            forceShow={deleting}
            rightClassName={hasChildren ? ACTION_OFFSET_WITH_CHEVRON : 'right-1.5'}
            className="z-10"
          >
            {trailing}
          </HoverActionSlot>
        ) : null}
      </div>
      {/* 子列表：不画竖线（窄侧栏里是持续噪声），只缩进约一个「图标槽」——
          看得从属关系，又不会把会话行推到面板中间。 */}
      {hasChildren && expanded ? <div className="ml-5 mr-0.5 mb-0.5">{children}</div> : null}
    </>
  );
};

export default React.memo(SessionRow);
