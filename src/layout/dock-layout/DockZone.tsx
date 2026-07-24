import React, { Suspense } from 'react';

import { cn } from '@/lib/utils';
import { useDockStore } from '@/shared/store/dockStore';

import { dockPanelRegistry } from '../dockPanels';

import { useDragToReDock } from './useDragToReDock';

interface DockZoneProps {
  zoneId: string;
}

/** Docking zone container -- renders active panel as a floating "island".
 *  Islands theme: rounded-lg border, subtle shadow, bg-secondary surface. */
const DockZone: React.FC<DockZoneProps> = ({ zoneId }) => {
  const zone = useDockStore((s) => s.zones[zoneId]);

  // Drag-to-re-dock
  const { isDragOver, dragHandlers } = useDragToReDock(zoneId);

  if (!zone) {
    return (
      <div
        className="flex h-full items-center justify-center text-xs text-text-muted"
        {...dragHandlers}
      >
        Unknown zone: {zoneId}
      </div>
    );
  }

  // Empty or collapsed zone state
  if (zone.panels.length === 0 || !zone.expanded) {
    return (
      <div
        className={cn(
          'flex h-full items-center justify-center text-xs text-text-muted',
          isDragOver && 'ring-2 ring-inset ring-accent-blue/50',
        )}
        {...dragHandlers}
      >
        {isDragOver ? 'Drop panel here' : ''}
      </div>
    );
  }

  // 渲染所有 panel，非活跃的用 CSS hidden 隐藏。
  // 避免切换时卸载/挂载组件导致 useState 重置、useEffect 重触发、React.lazy chunk 加载。
  const activePanelId = zone.activePanelId;

  return (
    <div
      className={cn(
        'flex h-full flex-col overflow-hidden rounded-lg shadow-sm bg-bg-secondary',
        isDragOver && 'ring-2 ring-inset ring-accent-blue/50',
      )}
      {...dragHandlers}
    >
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
    </div>
  );
};

export default React.memo(DockZone);
