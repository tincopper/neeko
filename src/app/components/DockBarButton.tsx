import React, { useCallback } from 'react';

import { dockPanelIcons, dockPanelRegistry } from '@/app/dock/registry';
import { cn } from '@/lib/utils';
import { isViewVisible, type DockSlot, type ViewKey } from '@/shared/dock';
import { useAppViewStore } from '@/shared/store/appViewStore';
import { useDockStore } from '@/shared/store/dockStore';
import { Badge } from '@/ui/Badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/Tooltip';

interface DockBarButtonProps {
  view: ViewKey;
  side?: DockSlot;
  /**
   * 键盘等价操作（Alt+←/→ 换边）。与拖拽走**同一个** app 层入口：
   * 能力拒绝时的提示只在那里实现一次，按钮不自己判断能不能移。
   */
  onMove?: (view: ViewKey, slot: DockSlot) => void;
  /**
   * `activation.kind === 'openTab'` 的点击入口（找已有 / 新建 + 停靠）。
   *
   * **注入**而不是在按钮里 import feature 域：按钮只认识「有个视图被点了」，
   * 「打开哪种 tab、落到哪个宿主」是 app 层的端口（与 `onMove` 同构）。
   */
  onOpenTab?: (view: ViewKey, slot: DockSlot) => void;
  /** 种类入口的选中态判据（app 层派生：当前显示的 tab 种类）。 */
  isTabKindVisible?: (kind: string) => boolean;
}

const DockBarButton: React.FC<DockBarButtonProps> = ({
  view,
  side = 'right',
  onMove,
  onOpenTab,
  isTabKindVisible,
}) => {
  const def = dockPanelRegistry[view];
  const activation = def?.activation;

  const dockActive = useDockStore((s) => isViewVisible(s, view));
  // 中心视图（host:'none'）永不进 zone：它的选中态由 appViewStore 给出
  const appViewActive = useAppViewStore((s) =>
    activation?.kind === 'appView' ? s.appView === activation.view : false,
  );
  // 种类入口同样不进 zone：选中态 = 「该种类的 tab 此刻真的显示着」（与宿主同源判据）
  const tabKindActive =
    activation?.kind === 'openTab' && isTabKindVisible
      ? isTabKindVisible(activation.tabKind)
      : false;
  const isActive =
    activation?.kind === 'appView'
      ? appViewActive
      : activation?.kind === 'openTab'
        ? tabKindActive
        : dockActive;

  const toggleView = useDockStore((s) => s.toggleView);

  const handleClick = useCallback(() => {
    // openTab 不能走 store 的 toggleView：打开 tab 是 app 层的端口（store 不持有 tab 空间）
    if (activation?.kind === 'openTab') {
      onOpenTab?.(view, side);
      return;
    }
    // toggleZone / appView 两族都由 store 统一分发（含互相排斥的中心视图语义）
    toggleView(view);
  }, [activation?.kind, onOpenTab, side, toggleView, view]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!e.altKey || !onMove) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const target: DockSlot = e.key === 'ArrowLeft' ? 'left' : 'right';
      // 已在目标栏：方向键是 no-op（否则「移到同槽且不带下标」会被解释成追加到末尾）
      if (target === side) return;
      e.preventDefault();
      onMove(view, target);
    },
    [onMove, side, view],
  );

  if (!def) return null;

  const Icon = dockPanelIcons[def.icon];
  const movable = def.movable !== false;
  // 类型 + 可拖动提示：读屏用户需要知道这是哪种图标、能不能挪（键盘等价写在 aria-keyshortcuts）
  const kindLabel =
    def.host === 'none' ? (activation?.kind === 'openTab' ? 'tab entry' : 'app view') : 'panel';
  const ariaLabel = movable
    ? `${def.title} — ${kindLabel}, draggable (Alt+Arrow moves to the other side)`
    : `${def.title} — ${kindLabel}`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={handleClick}
          onKeyDown={handleKeyDown}
          className={cn(
            'relative w-11 h-11 flex items-center justify-center',
            'text-text-secondary hover:text-text-primary transition-colors duration-150',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue',
          )}
          aria-label={ariaLabel}
          aria-keyshortcuts={movable ? 'Alt+ArrowLeft Alt+ArrowRight' : undefined}
        >
          <span
            className={cn(
              'flex items-center justify-center w-8 h-8 rounded-md',
              'hover:bg-bg-hover',
              isActive && 'bg-bg-selected text-text-primary',
            )}
          >
            {Icon ? <Icon className="h-5 w-5" /> : <span>{def.title[0]}</span>}
          </span>
          <Badge
            variant="secondary"
            className={cn(
              'absolute -right-0.5 -top-0.5 h-4 min-w-4 px-1 text-[10px] leading-none',
              'hidden',
            )}
          >
            0
          </Badge>
        </button>
      </TooltipTrigger>
      <TooltipContent side={side === 'left' ? 'right' : 'left'} sideOffset={8}>
        <p>{def.title}</p>
      </TooltipContent>
    </Tooltip>
  );
};

export default React.memo(DockBarButton);
