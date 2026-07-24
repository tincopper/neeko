/**
 * Pure dock panel metadata — no React, no feature/app imports.
 * Used by dockStore for default zones / bar items / toggle placement.
 */
export interface DockPanelMeta {
  id: string;
  defaultZone: 'left' | 'right';
  defaultOrder: number;
  /** default "panel"; tab-mode panels are not docked into zones */
  openAs?: 'tab' | 'panel';
  /** Default zone width percentage (0-100) when this panel is active. */
  defaultZoneSize?: number;
}
