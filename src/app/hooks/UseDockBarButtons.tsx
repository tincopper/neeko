import { useMemo } from 'react';

import DockBarButton from '@/app/components/DockBarButton';
import DockBarDragPreview from '@/app/components/DockBarDragPreview';
import type { DockBarEntry } from '@/layout/dock-layout/DockBar';
import { placementsInSlot, type DockSlot, type ViewKey } from '@/shared/dock';
import { useDockStore } from '@/shared/store/dockStore';

import { useVisibleTabKinds } from './useVisibleTabKinds';

/** app 层注入给图标的点击 / 移动端口（按钮本身不认识任何 feature 域）。 */
export interface DockBarButtonHandlers {
  /** 键盘等价操作（Alt+←/→）与拖拽共用的落位入口。 */
  onMove?: (view: ViewKey, slot: DockSlot) => void;
  /** `activation.kind === 'openTab'` 的点击入口（找已有 / 新建 + 停靠）。 */
  onOpenTab?: (view: ViewKey, slot: DockSlot) => void;
}

/**
 * 组装某一侧 dock 栏的条目（视图身份 + 已渲染按钮），供 App 经 DockLayout 的 DockBar 渲染。
 *
 * 唯一派生面是 `placements`（按槽 + order 排序 + onBar）：曾经是 `barItems[]`，与
 * `zones[].panels` 各存一份，换边时漏写一处就得到「图标在右、面板还开在左」。
 *
 * 端口一律由调用方注入（而不是在这里直接调 `useDockBarMove` / 开 tab）：一个应用只该有
 * 一份「移动 + 拒绝提示」与一份「openTab 落地」的实现，且 hook 测试不必为 toast 铺一个
 * AppProvider。
 *
 * 选中态：`openTab` 族没有 zone，可见性只能由「当前显示的 tab 种类」派生 —— 判据在
 * `useVisibleTabKinds`（与 `DockTabHost` 同源），本 hook 只把它透传给按钮。
 *
 * 文件名 PascalCase（含 JSX 的 .tsx 需满足 check-file 命名规则），hook 仍为 camelCase。
 */
export function useDockBarButtons(
  side: DockSlot,
  handlers: DockBarButtonHandlers = {},
): DockBarEntry[] {
  // 只订阅 placements：zone 的展开/切换与本栏无关，多订阅一个切片就是每次开关面板
  // 都让全部图标重渲染一次。
  const placements = useDockStore((s) => s.placements);
  const isTabKindVisible = useVisibleTabKinds();
  const { onMove, onOpenTab } = handlers;

  return useMemo(
    () =>
      placementsInSlot(placements, side)
        .filter((placement) => placement.onBar)
        .map((placement) => ({
          view: placement.view,
          node: (
            <DockBarButton
              key={placement.view}
              view={placement.view}
              side={side}
              onMove={onMove}
              onOpenTab={onOpenTab}
              isTabKindVisible={isTabKindVisible}
            />
          ),
          // 拖拽浮层内容：图标映射在 app registry，layout 收不到它，只能由这里注入
          preview: <DockBarDragPreview view={placement.view} />,
        })),
    [isTabKindVisible, onMove, onOpenTab, placements, side],
  );
}
