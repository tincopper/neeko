import type { DockPanelMeta } from './types';

/**
 * Single source of structural defaults for dock panels.
 * UI bindings (title/icon/component) live in app/dock/registry.ts.
 */
export const DOCK_PANEL_META: Record<string, DockPanelMeta> = {
  projects: {
    id: 'projects',
    defaultZone: 'left',
    defaultOrder: 0,
  },
  files: {
    id: 'files',
    defaultZone: 'right',
    defaultOrder: 0,
  },
  skills: {
    id: 'skills',
    defaultZone: 'left',
    defaultOrder: 2,
  },
  gitControl: {
    id: 'gitControl',
    defaultZone: 'right',
    defaultOrder: 1,
  },
  pullRequests: {
    id: 'pullRequests',
    defaultZone: 'right',
    defaultOrder: 2,
  },
  browser: {
    id: 'browser',
    defaultZone: 'right',
    defaultOrder: 3,
    defaultZoneSize: 50,
  },
  conversations: {
    id: 'conversations',
    defaultZone: 'right',
    defaultOrder: 4,
  },
};

export type DockPanelId =
  | 'projects'
  | 'files'
  | 'skills'
  | 'gitControl'
  | 'pullRequests'
  | 'browser'
  | 'conversations';
