import React, { useCallback } from 'react';

import { cn } from '@/lib/utils';
import { MoreVerticalIcon, PencilIcon, TrashIcon } from '@/shared/components/icons';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/DropdownMenu';

/**
 * 菜单项的排版：图标 + 文字、行高 26px、圆角 6px、12px 字号。
 *
 * 字号与行距都跟着侧栏说话 —— 会话标题是 `0.92em` ≈ 12px，菜单比它还大就头重脚轻；
 * 一个只有两项的菜单也不需要 32px 的行高（那是给十几项的长菜单留的呼吸感）。
 */
const ITEM_CLASS = 'gap-2 rounded-md px-2 py-1.5 text-[12px] cursor-pointer';

interface SessionRowMenuProps {
  /** 要操作的是哪条会话（无障碍标签里点名，屏幕阅读器才念得出「重命名哪一条」）。 */
  sessionTitle: string;
  /**
   * 各项能力**按项可选**：菜单只渲染调用方真的提供的动作。
   *
   * 早先是「有任一项就渲染整个菜单」，于是只传 `onDelete` 时「Rename」仍会出现在菜单里，
   * 点下去静默无反应（`onRename?.()` 把调用丢掉了）—— 「点了没反应」在构造上是可能的。
   */
  onRename?: () => void;
  onDelete?: () => void;
}

/**
 * 侧栏会话行的**工具栏**：一个 `⋯` 按钮 + 下拉列表（重命名 / 删除）。
 *
 * ## 为什么是菜单而不是两个图标
 *
 * 侧栏只有 280px 宽，行尾已经有相对时间 + 状态点；再并排两个图标会把标题压到十几个字符。
 * 收进一个 `⋯` 之后，行宽只多占一个图标位，而菜单项有**文字**——删除这种不可撤销的动作
 * 不该只靠一个垃圾桶图形去表达。
 *
 * ## 点击不能冒泡
 *
 * 整行是一个「点开会话」的按钮。菜单内部任何一次点击都必须 `stopPropagation`，
 * 否则「点删除」会先触发「切到这条会话」，用户看到的是先跳过去再问要不要删。
 */
const SessionRowMenu: React.FC<SessionRowMenuProps> = ({ sessionTitle, onRename, onDelete }) => {
  // Radix 的 `onSelect` 给的是原生事件：拦掉它，行本身的 click 才不会跟着触发。
  const stopAndRun = useCallback(
    (action: () => void) => (e: Event) => {
      e.stopPropagation();
      action();
    },
    [],
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          // 行尾按钮：默认透明，悬停 / 聚焦 / 菜单展开时才出现（窄侧栏里常驻就是噪声）。
          className="shrink-0 rounded p-0.5 text-text-muted opacity-0 transition-opacity hover:bg-bg-hover hover:text-text-primary focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-accent-blue group-hover/session:opacity-100 data-[state=open]:opacity-100"
          aria-label={`Session actions: ${sessionTitle}`}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <MoreVerticalIcon size={13} />
        </button>
      </DropdownMenuTrigger>
      {/* 视觉口径对齐「任务工具栏」那类菜单：更宽松的行高、左侧图标、分组分隔线，
          破坏性动作压在最后并单独着色 —— 三件事都靠间距与颜色表达，不靠边框叠边框。 */}
      <DropdownMenuContent
        // 从触发点**向右**展开（触发按钮在行尾，向左展会盖住标题；向右展才落在空白侧）。
        // `align="start"` 让菜单左缘对齐按钮左缘，Radix 只在撞到视口边时才回推。
        align="start"
        sideOffset={4}
        className="min-w-[152px] rounded-lg border-border-subtle bg-popover p-1 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {onRename && (
          <DropdownMenuItem className={ITEM_CLASS} onSelect={stopAndRun(onRename)}>
            <PencilIcon size={14} className="text-text-muted" />
            Rename
          </DropdownMenuItem>
        )}
        {onRename && onDelete && <DropdownMenuSeparator className="mx-1 my-1 bg-border-subtle" />}
        {onDelete && (
          <DropdownMenuItem
            className={cn(ITEM_CLASS, 'text-accent-red')}
            onSelect={stopAndRun(onDelete)}
          >
            <TrashIcon size={14} />
            Delete
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default React.memo(SessionRowMenu);
