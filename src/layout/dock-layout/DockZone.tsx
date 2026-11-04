import React, { Suspense, useMemo } from 'react';

import { cn } from '@/lib/utils';
import { zoneFrontView, zoneHostedViews, type DockSlot } from '@/shared/dock';
import { useDockStore } from '@/shared/store/dockStore';
import { Island } from '@/ui/Island';

import { useDockRegistry } from '../DockRegistryContext';

interface DockZoneProps {
  zoneId: DockSlot;
}

/** Docking zone container -- renders active view as a floating island (see ui/Island). */
const DockZone: React.FC<DockZoneProps> = ({ zoneId }) => {
  const dockViewRegistry = useDockRegistry();
  const placements = useDockStore((s) => s.placements);
  const zones = useDockStore((s) => s.zones);
  const zone = zones[zoneId];

  // 渲染列表 = **有 zone 内容**的视图（声明表口径的唯一过滤器 `zoneHostedViews`）。
  // `host: 'none'` 的视图（Library / 种类级入口）有落位但不占 zone：图标在哪栏与面板
  // 渲染在哪是两件事 —— 用「registry 里有没有 component」过滤会漏掉 Library（它有组件，
  // 只是渲染在中心区），把 LibraryPanel 当成左栏面板挂载。
  const layoutState = useMemo(() => ({ placements, zones }), [placements, zones]);
  const views = useMemo(() => zoneHostedViews(layoutState, zoneId), [layoutState, zoneId]);

  if (!zone) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-text-muted">
        Unknown zone: {zoneId}
      </div>
    );
  }

  // Empty or collapsed zone state
  if (views.length === 0 || !zone.expanded) {
    return null;
  }

  // 前台 = 布局事实的唯一派生点（`zoneFrontView`：含「activeView 指向 host:'none' /
  // 悬挂 → 回落首个可渲染视图」）。消费侧禁止再写一份 `views.includes(...) ? … : views[0]`。
  const activeView = zoneFrontView(layoutState, zoneId);

  // 渲染该槽全部视图，非活跃的用 CSS hidden 隐藏。
  // 避免切换时卸载/挂载组件导致 useState 重置、useEffect 重触发、React.lazy chunk 加载。
  return (
    <Island className="h-full">
      {views.map((view) => {
        const def = dockViewRegistry[view];
        const ViewComponent = def?.component;
        if (!ViewComponent) return null;
        const isActive = view === activeView;

        return (
          <div key={view} className={cn('h-full w-full', !isActive && 'hidden')}>
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center text-sm text-text-muted">
                  Loading {def.title}...
                </div>
              }
            >
              <ViewComponent />
            </Suspense>
          </div>
        );
      })}
    </Island>
  );
};

export default React.memo(DockZone);
