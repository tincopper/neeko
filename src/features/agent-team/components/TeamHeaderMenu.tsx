import { MoreHorizontal } from 'lucide-react';
import React, { useRef } from 'react';

import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/DropdownMenu';

/**
 * 面板头的 `⋯` 菜单（R1）：把**低频入口**收起来，但一条都不删。
 *
 * # 为什么是菜单而不是一排按钮
 *
 * dock 右栏只有 260–300px。`返回列表` 之后还要排 `改名` / `恢复团队` / `关闭团队` 三个
 * 文字按钮，队名就被压到十几个字符。四个动作里三个是低频的（改名已有双击入口、恢复只看
 * 一次、关闭几乎不发生），刷新则已被 `usePulseRefresh` 自动做了 —— 它们不该常驻占位。
 *
 * # 菜单只转发回调，不持有动作
 *
 * 每一项都调**宿主已有的**那个回调（`TeamView` → `TeamPanel` 的既有接线：`useTeamRename` /
 * `useTeamResumePanel` / `useTeamDestructives`）。菜单里不调 API、不持 hook ——
 * 否则「关闭团队」会长出第二份实现，而两份的差别（比如是否等快照刷新完再报结果）只在
 * 某一条路径上显形。
 *
 * # 哪一项出现，全部按能力判
 *
 * | 项 | 出现条件 |
 * | --- | --- |
 * | 改名 | 宿主注入了 `onRename`（未注入 = 这条连线不存在，不渲染点了没反应的项）|
 * | 刷新快照 | 恒有（事件通道异常时它是唯一的手动恢复路径）|
 * | 恢复团队 | `state === 'open'` 且有可恢复成员且宿主注入了 `onResumeTeam` |
 * | 关闭团队… | `state !== 'sealed'`（只读快照没有可关的东西，与 `TeamListRow` 同一判定）|
 *
 * 「恢复团队」不复用花名册的行级判据去重算：`resumable` 由调用方用
 * `hasResumableMember` 算好传进来（与成员级按钮同源），这里只读布尔值。
 */
interface TeamHeaderMenuProps {
  /** 队名（用于触发按钮的可访问名：屏幕阅读器要念得出「操作哪支队」）。 */
  teamName: string;
  /** 团队状态；`null` = 快照还没到（此时只有恒有的那几项）。 */
  state: 'open' | 'closing' | 'sealed' | null;
  /** 是否存在可恢复成员（与花名册「恢复会话」同一份推导）。 */
  resumable: boolean;
  /** 有关闭请求在飞（置灰，避免连点出两次确认）。 */
  closing: boolean;
  /** 有恢复请求在飞（置灰，避免连点出两个恢复编排）。 */
  resuming: boolean;
  /** `undefined` = 宿主未注入改名连线（入口不渲染）。 */
  onRename?: () => void;
  onRefresh: () => void;
  /** `undefined` = 宿主未注入整队恢复（入口不渲染）。 */
  onResumeTeam?: () => void;
  onRequestClose: () => void;
}

/** 菜单项排版：与 `SessionRowMenu` 同一口径（12px、紧凑行高、左侧不强行塞图标）。 */
const ITEM_CLASS = 'gap-2 rounded-md px-2 py-1.5 text-[12px] cursor-pointer';

const TeamHeaderMenu: React.FC<TeamHeaderMenuProps> = React.memo(
  ({
    teamName,
    state,
    resumable,
    closing,
    resuming,
    onRename,
    onRefresh,
    onResumeTeam,
    onRequestClose,
  }) => {
    // `sealed` 是只读快照：既不能恢复也不能关闭（恢复会撤销用户的封存决定，后端也会拒）。
    const canResume = state === 'open' && resumable && onResumeTeam !== undefined;
    const canClose = state !== 'sealed';

    /**
     * 「改名」要晚一步：等菜单**卸载完**再开行内编辑（不是等一帧，也不是等一个定时器意义上的
     * 「延迟输入」—— 菜单卸载就是那一刻的事件）。
     *
     * 两个同步的坑都真实存在：
     *
     * 1. 菜单还挂着时把输入框挂上去，菜单的**焦点陷阱**（`focusin` 监听）会立刻把焦点抢回
     *    菜单容器；
     * 2. 菜单卸载的默认行为是把焦点还给触发按钮（Radix 在 `setTimeout(…, 0)` 里做）。
     *
     * 任一发生都会让刚挂载的输入框立刻 `blur`，而 `InlineRenameInput` 的 blur 是「提交」：
     * 草稿没变 ⇒ 关掉编辑态。用户看到的是输入框一闪而过。
     *
     * 所以在 `onSelect` 里只记一个标记，到 `onCloseAutoFocus`（菜单已卸载、焦点归还前）
     * 拦掉默认退还并**这时才**开编辑。其余项不受影响，照旧把焦点还给触发按钮。
     */
    const renamePending = useRef(false);

    return (
      // 每次打开都先清掉标记：若上次的 `onCloseAutoFocus` 因故没触发，残留的 `true`
      // 会让**下一次**关菜单误开编辑态。
      <DropdownMenu
        onOpenChange={(open) => {
          if (open) renamePending.current = false;
        }}
      >
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`团队操作：${teamName}`}
            title="团队操作"
            className="grid size-5 shrink-0 place-items-center rounded text-text-muted hover:bg-bg-hover hover:text-text-primary focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none"
          >
            <MoreHorizontal size={13} aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          // 触发按钮在行尾：向右展开（`end`）才不会盖住队名。
          align="end"
          sideOffset={4}
          className="min-w-[136px] rounded-lg border-border-subtle bg-popover p-1 shadow-lg"
          onCloseAutoFocus={(e) => {
            if (!renamePending.current) return;
            renamePending.current = false;
            // 拦掉「焦点还给触发按钮」：这里正是把焦点交给行内输入框的时候
            e.preventDefault();
            onRename?.();
          }}
        >
          {onRename === undefined ? null : (
            <DropdownMenuItem
              className={ITEM_CLASS}
              onSelect={() => {
                renamePending.current = true;
              }}
            >
              改名
            </DropdownMenuItem>
          )}
          <DropdownMenuItem className={ITEM_CLASS} onSelect={() => onRefresh()}>
            刷新快照
          </DropdownMenuItem>
          {canResume ? (
            <DropdownMenuItem
              className={cn(ITEM_CLASS, 'text-accent-blue')}
              disabled={resuming}
              onSelect={() => onResumeTeam?.()}
            >
              恢复团队
            </DropdownMenuItem>
          ) : null}
          {/* 破坏性动作不混在中间：一条分隔线 + 单独着色 */}
          {canClose ? (
            <>
              <DropdownMenuSeparator className="mx-1 my-1 bg-border-subtle" />
              <DropdownMenuItem
                className={cn(ITEM_CLASS, 'text-accent-red')}
                disabled={closing}
                onSelect={() => onRequestClose()}
              >
                关闭团队…
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  },
);
TeamHeaderMenu.displayName = 'TeamHeaderMenu';

export default TeamHeaderMenu;
