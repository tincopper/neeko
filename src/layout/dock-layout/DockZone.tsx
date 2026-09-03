import React, { Suspense } from 'react';

import { cn } from '@/lib/utils';
import { useDockStore, type ZoneId } from '@/shared/store/dockStore';
import { Island } from '@/ui/Island';

import { useDockRegistry } from '../DockRegistryContext';

interface DockZoneProps {
  zoneId: ZoneId;
}
/** Docking zone container -- renders active panel as a floating island (see ui/Island). */
const DockZone: React.FC<DockZoneProps> = ({ zoneId }) => {
  const dockPanelRegistry = useDockRegistry();
  const zone = useDockStore((s) => s.zones[zoneId]);

  if (!zone) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-text-muted">
        Unknown zone: {zoneId}
      </div>
    );
  }

  // Empty or collapsed zone state
  if (zone.panels.length === 0 || !zone.expanded) {
    return null;
  }

  // 渲染所有 panel，非活跃的用 CSS hidden 隐藏。
  // 避免切换时卸载/挂载组件导致 useState 重置、useEffect 重触发、React.lazy chunk 加载。
  const activePanelId = zone.activePanelId;
  return (
    <Island className="h-full">
      {zone.panels.map((panelId) => {
        const def = dockPanelRegistry[panelId];
        if (!def?.component) return null;
        const PanelComponent = def.component;
        const isActive = panelId === activePanelId;

        return (
          <div key={panelId} className={cn('h-full w-full', !isActive && 'hidden')}>
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center text-sm text-text-muted">
                  Loading {def.title}...
                </div>
              }
            >
              <PanelComponent />
            </Suspense>
          </div>
        );
      })}
      {!activePanelId && (
        <div className="flex h-full items-center justify-center text-xs text-text-muted">
          No panel selected
        </div>
      )}
    </Island>
  );
};

export default React.memo(DockZone);
