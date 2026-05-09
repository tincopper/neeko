import { create } from "zustand";
import { persist } from "zustand/middleware";
import { dockPanelRegistry } from "../registries/dockPanels";

// -- Types --

export interface DockZoneState {
  id: string;
  panels: string[];
  activePanelId: string | null;
  expanded: boolean;
}

export interface DockBarItem {
  panelId: string;
  side: "left" | "right";
  order: number;
  visible: boolean;
}

export interface DockStore {
  zones: Record<string, DockZoneState>;
  barItems: DockBarItem[];

  togglePanel: (panelId: string) => void;
  activatePanel: (zoneId: string, panelId: string) => void;
  movePanel: (panelId: string, targetZoneId: string, index?: number) => void;
  closePanel: (panelId: string) => void;
  expandZone: (zoneId: string) => void;
  restoreDefaultLayout: () => void;
}

// -- Defaults --

const DEFAULT_ZONES: Record<string, Omit<DockZoneState, "panels" | "activePanelId">> = {
  left: { id: "left", expanded: true },
  right: { id: "right", expanded: false },
};

// -- Helpers --

function buildDefaultPanels(): Record<string, string[]> {
  const zones: Record<string, { panelId: string; order: number }[]> = {};
  for (const [panelId, def] of Object.entries(dockPanelRegistry)) {
    const z = def.defaultZone;
    if (!zones[z]) zones[z] = [];
    zones[z].push({ panelId, order: def.defaultOrder });
  }
  const result: Record<string, string[]> = {};
  for (const [zoneId, items] of Object.entries(zones)) {
    items.sort((a, b) => a.order - b.order);
    result[zoneId] = items.map((i) => i.panelId);
  }
  return result;
}

function buildDefaultBarItems(): DockBarItem[] {
  const items: DockBarItem[] = [];
  for (const [panelId, def] of Object.entries(dockPanelRegistry)) {
    if (def.defaultZone === "left" || def.defaultZone === "right") {
      items.push({
        panelId,
        side: def.defaultZone,
        order: def.defaultOrder,
        visible: true,
      });
    }
  }
  items.sort((a, b) => a.order - b.order);
  return items;
}

function createInitialState() {
  const panelMap = buildDefaultPanels();
  const zones: Record<string, DockZoneState> = {};
  for (const [zoneId, defaults] of Object.entries(DEFAULT_ZONES)) {
    const panels = panelMap[zoneId] ?? [];
    zones[zoneId] = {
      ...defaults,
      panels,
      activePanelId: panels.length > 0 ? panels[0] : null,
    };
  }
  for (const zoneId of ["left", "right"] as const) {
    if (!zones[zoneId]) {
      zones[zoneId] = {
        id: zoneId,
        panels: [],
        activePanelId: null,
        expanded: false,
      };
    }
  }
  return { zones, barItems: buildDefaultBarItems() };
}

function findPanelZone(zones: Record<string, DockZoneState>, panelId: string): string | null {
  for (const [zoneId, zone] of Object.entries(zones)) {
    if (zone.panels.includes(panelId)) return zoneId;
  }
  return null;
}

// -- Store --

export const useDockStore = create<DockStore>()(
  persist(
    (set, get) => {
      const initial = createInitialState();

      return {
        zones: initial.zones,
        barItems: initial.barItems,

        togglePanel: (panelId: string) => {
          const { zones } = get();
          const currentZoneId = findPanelZone(zones, panelId);

          if (currentZoneId) {
            // Panel is already in a zone
            const zone = zones[currentZoneId];
            if (zone.activePanelId === panelId) {
              // Active panel → close it (remove from zone)
              set((state) => {
                const z = state.zones[currentZoneId];
                const nextPanels = z.panels.filter((p) => p !== panelId);
                const nextActive =
                  nextPanels.length > 0 ? nextPanels[0] : null;
                return {
                  zones: {
                    ...state.zones,
                    [currentZoneId]: {
                      ...z,
                      panels: nextPanels,
                      activePanelId: nextActive,
                      expanded: nextPanels.length > 0,
                    },
                  },
                  barItems: state.barItems.map((item) =>
                    item.panelId === panelId ? { ...item, visible: true } : item,
                  ),
                };
              });
            } else {
              // Not the active panel → just switch to it
              set((state) => ({
                zones: {
                  ...state.zones,
                  [currentZoneId]: {
                    ...state.zones[currentZoneId],
                    activePanelId: panelId,
                    expanded: true,
                  },
                },
              }));
            }
          } else {
            // Panel is not in any zone → replace target zone with this panel (radio behavior)
            const def = dockPanelRegistry[panelId];
            if (!def) return;
            const targetZoneId = def.defaultZone;
            set((state) => ({
              zones: {
                ...state.zones,
                [targetZoneId]: {
                  ...state.zones[targetZoneId],
                  panels: [panelId],
                  activePanelId: panelId,
                  expanded: true,
                },
              },
              barItems: state.barItems.map((item) =>
                item.panelId === panelId ? { ...item, visible: true } : item,
              ),
            }));
          }
        },

        activatePanel: (zoneId: string, panelId: string) => {
          set((state) => {
            const zone = state.zones[zoneId];
            if (!zone || !zone.panels.includes(panelId)) return state;
            return {
              zones: {
                ...state.zones,
                [zoneId]: { ...zone, activePanelId: panelId, expanded: true },
              },
            };
          });
        },

        movePanel: (panelId: string, targetZoneId: string, index?: number) => {
          set((state) => {
            const zones = { ...state.zones };
            const sourceZoneId = findPanelZone(zones, panelId);
            if (sourceZoneId === null) return state;

            const sourceZone = { ...zones[sourceZoneId] };
            const sourceIndex = sourceZone.panels.indexOf(panelId);
            const sourcePanels = sourceZone.panels.filter((p) => p !== panelId);
            const sourceActive =
              sourceZone.activePanelId === panelId
                ? sourcePanels.length > 0
                  ? sourcePanels[Math.min(sourceIndex, sourcePanels.length - 1)]
                  : null
                : sourceZone.activePanelId;

            zones[sourceZoneId] = {
              ...sourceZone,
              panels: sourcePanels,
              activePanelId: sourceActive,
              expanded: sourcePanels.length > 0,
            };

            const targetZone = zones[targetZoneId] ?? {
              id: targetZoneId,
              panels: [],
              activePanelId: null,
              expanded: false,
            };

            const targetPanels = [...targetZone.panels];
            const insertAt = index !== undefined ? index : targetPanels.length;
            targetPanels.splice(insertAt, 0, panelId);

            zones[targetZoneId] = {
              ...targetZone,
              panels: targetPanels,
              activePanelId: panelId,
              expanded: true,
            };

            const barItems = state.barItems.map((item) => {
              if (item.panelId !== panelId) return item;
              const newSide = targetZoneId === "left" || targetZoneId === "right" ? targetZoneId : item.side;
              return { ...item, side: newSide as "left" | "right" };
            });

            return { zones, barItems };
          });
        },

        closePanel: (panelId: string) => {
          set((state) => {
            const currentZoneId = findPanelZone(state.zones, panelId);
            if (!currentZoneId) return state;
            const zone = state.zones[currentZoneId];
            const nextPanels = zone.panels.filter((p) => p !== panelId);
            const nextActive =
              zone.activePanelId === panelId
                ? nextPanels.length > 0 ? nextPanels[0] : null
                : zone.activePanelId;
            return {
              zones: {
                ...state.zones,
                [currentZoneId]: {
                  ...zone,
                  panels: nextPanels,
                  activePanelId: nextActive,
                  expanded: nextPanels.length > 0,
                },
              },
            };
          });
        },

        expandZone: (zoneId: string) => {
          set((state) => {
            const zone = state.zones[zoneId];
            if (!zone) return state;
            return {
              zones: {
                ...state.zones,
                [zoneId]: { ...zone, expanded: true },
              },
            };
          });
        },

        restoreDefaultLayout: () => {
          const defaults = createInitialState();
          set({ zones: defaults.zones, barItems: defaults.barItems });
        },
      };
    },
    {
      name: "neeko-dock-layout",
      version: 3,
      partialize: (state) => ({
        zones: state.zones,
        barItems: state.barItems,
      }),
      merge: (persisted: unknown, current: DockStore) => {
        const saved = persisted as
          | { zones?: Record<string, DockZoneState>; barItems?: DockBarItem[] }
          | undefined;
        const defaults = createInitialState();
        // Rebuild zone panels from registry defaultZone, then restore
        // expanded / activePanelId from persisted state where possible.
        const zones: Record<string, DockZoneState> = {};
        for (const [zoneId, defaultZone] of Object.entries(defaults.zones)) {
          const savedZone = saved?.zones?.[zoneId];
          zones[zoneId] = {
            ...defaultZone,
            // Keep expanded from saved state (but force left expanded)
            expanded: zoneId === "left" ? true : (savedZone?.expanded ?? defaultZone.expanded),
            activePanelId: savedZone?.activePanelId ?? defaultZone.activePanelId,
          };
        }
        // Rebuild barItems from registry to pick up side/order changes
        const barItems = defaults.barItems.map((defaultItem) => {
          const savedItem = saved?.barItems?.find((b) => b.panelId === defaultItem.panelId);
          return savedItem
            ? { ...defaultItem, visible: savedItem.visible }
            : defaultItem;
        });
        return {
          ...current,
          zones,
          barItems,
        };
      },
    },
  )
);
