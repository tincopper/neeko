import React, { Suspense, useMemo } from 'react';

import { cn } from '@/lib/utils';
import { placementsInSlot, type DockSlot } from '@/shared/dock';
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
  const zone = useDockStore((s) => s.zones[zoneId]);

  // `host: 'none'` 的视图（只上 bar 的中心视图入口，如 Library）有落位但不占 zone：
  // 「图标在哪栏」与「面板渲染在哪」是两件事。
  const views = useMemo(
    () =>
      placementsInSlot(placements, zoneId)
        .map((placement) => placement.view)
        .filter((view) => dockViewRegistry[view]?.component),
    [placements, zoneId, dockViewRegistry],
  );

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

  // activeView 指向 host:'none' 的视图时落到首个宿主视图 —— 它在槽内（不是悬挂），
  // 只是没有 zone 内容。悬挂（不在槽内）由 applyMove/sanitize 就地修好，不在这里兜底。
  const activeView =
    zone.activeView && views.includes(zone.activeView) ? zone.activeView : views[0];

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
