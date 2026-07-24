import React, { useCallback } from 'react';
import { useShallow } from 'zustand/shallow';

import { dockPanelRegistry, dockPanelIcons } from '@/app/dock/registry';
import { useProjectStore } from '@/features/project/store';
import { cn } from '@/lib/utils';
import { useEditorStore } from '@/shared/store';
import { useDockStore } from '@/shared/store/dockStore';
import type { TabKind } from '@/shared/types/tab';
import { Badge } from '@/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip';

const PANEL_TO_TAB_KIND: Record<string, TabKind> = {
  git: 'gitLog',
};

interface DockBarButtonProps {
  panelId: string;
  side?: 'left' | 'right';
}

const DockBarButton: React.FC<DockBarButtonProps> = ({ panelId, side = 'right' }) => {
  const def = dockPanelRegistry[panelId];
  const isTab = def?.openAs === 'tab';

  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const isTabActive = useEditorStore((s) => {
    if (!isTab) return false;
    const tabKind = PANEL_TO_TAB_KIND[panelId] ?? (panelId as TabKind);
    const projectId = activeProjectId ?? '__app__';
    const projectTabs = s.tabs[projectId];
    return projectTabs?.tabs.some((t) => t.data.kind === tabKind) ?? false;
  });

  const isDockActive = useDockStore((s) => {
    if (isTab) return false;
    for (const zone of Object.values(s.zones)) {
      if (zone.panels.includes(panelId) && zone.expanded && zone.activePanelId === panelId)
        return true;
    }
    return false;
  });

  const isActive = isTab ? isTabActive : isDockActive;

  const togglePanel = useDockStore((s) => s.togglePanel);
  const addTab = useEditorStore((s) => s.addTab);
  const closeTab = useEditorStore((s) => s.closeTab);
  const activateTab = useEditorStore((s) => s.activateTab);
  const currentProjectId = activeProjectId;
  const tabs = useEditorStore(useShallow((s) => s.tabs));

  const handleClick = useCallback(() => {
    if (isTab) {
      const tabKind = PANEL_TO_TAB_KIND[panelId] ?? (panelId as TabKind);
      const projectId = currentProjectId ?? '__app__';
      const projectTabs = tabs[projectId];
      const existing = projectTabs?.tabs.find((t) => t.data.kind === tabKind);
      if (existing) {
        closeTab(projectId, existing.id);
      } else {
        const tabId = `${panelId}_tab`;
        addTab(projectId, {
          id: tabId,
          projectId,
          title: def?.title ?? panelId,
          order: 100,
          data: { kind: tabKind } as never,
        });
        activateTab(projectId, tabId);
      }
    } else {
      togglePanel(panelId);
    }
  }, [isTab, togglePanel, addTab, closeTab, activateTab, currentProjectId, tabs, panelId, def]);

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
