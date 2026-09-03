import React, { useCallback } from 'react';

import { dockPanelRegistry, dockPanelIcons } from '@/app/dock/registry';
import { cn } from '@/lib/utils';
import { useAppViewStore } from '@/shared/store/appViewStore';
import { useDockStore } from '@/shared/store/dockStore';
import { Badge } from '@/ui/Badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/Tooltip';

interface DockBarButtonProps {
  panelId: string;
  side?: 'left' | 'right';
}

const DockBarButton: React.FC<DockBarButtonProps> = ({ panelId, side = 'right' }) => {
  const def = dockPanelRegistry[panelId];

  const isDockActive = useDockStore((s) => {
    for (const zone of Object.values(s.zones)) {
      if (zone.panels.includes(panelId) && zone.expanded && zone.activePanelId === panelId)
        return true;
    }
    return false;
  });

  // tab-mode 面板（如 Library）永不进 zone：中心视图激活时同样高亮
  const isTabActive = useAppViewStore((s) => s.appView === panelId);
  const isActive = isDockActive || (def?.openAs === 'tab' && isTabActive);

  const togglePanel = useDockStore((s) => s.togglePanel);

  const handleClick = useCallback(() => {
    togglePanel(panelId);
  }, [togglePanel, panelId]);

  if (!def) return null;

  const Icon = dockPanelIcons[def.icon];

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={handleClick}
          className={cn(
            'relative w-11 h-11 flex items-center justify-center',
            'text-text-secondary hover:text-text-primary transition-colors duration-150',
            'focus:outline-none',
          )}
          aria-label={def.title}
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
