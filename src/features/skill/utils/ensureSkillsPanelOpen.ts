import type { DockStore, DockZoneState, ZoneId } from '@/shared/store/dockStore';

type DockSnapshot = Pick<DockStore, 'zones' | 'togglePanel' | 'activatePanel'>;

function findPanelZone(zones: Record<ZoneId, DockZoneState>, panelId: string): ZoneId | null {
  for (const zoneId of Object.keys(zones) as ZoneId[]) {
    if (zones[zoneId].panels.includes(panelId)) return zoneId;
  }
  return null;
}

/**
 * Open the skills dock panel if needed. Unlike togglePanel alone, this never
 * collapses skills when it is already the active expanded panel.
 */
export function ensureSkillsPanelOpen(dock: DockSnapshot, panelId = 'skills'): void {
  const zoneId = findPanelZone(dock.zones, panelId);
  if (!zoneId) {
    dock.togglePanel(panelId);
    return;
  }
  const zone = dock.zones[zoneId];
  if (zone.activePanelId === panelId && zone.expanded) {
    return;
  }
  if (zone.panels.includes(panelId)) {
    dock.activatePanel(zoneId, panelId);
    return;
  }
  dock.togglePanel(panelId);
}
