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
  /** Per-panel remembered zone width percentage (0-100). Only panels with non-default widths are stored. */
  rightPanelSizes: Record<string, number>;
  /** Left sidebar width as a percentage (0-100). Default 18. */
  leftPanelSize: number;
  /** Left sidebar runtime pixel width — set by DockLayout onLayout, consumed by TitleBar for drag region. */
  leftPanelWidth: number;
  setLeftPanelWidth: (width: number) => void;

  togglePanel: (panelId: string) => void;
  activatePanel: (zoneId: string, panelId: string) => void;
  movePanel: (panelId: string, targetZoneId: string, index?: number) => void;
  closePanel: (panelId: string) => void;
  expandZone: (zoneId: string) => void;
  restoreDefaultLayout: () => void;
  setRightPanelSize: (panelId: string, size: number) => void;
  setLeftPanelSize: (size: number) => void;
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
    if (def.openAs === "tab") continue; // tab-mode panels are not dock panels
    const zoneId = def.defaultZone;
    if (!zones[zoneId]) zones[zoneId] = [];
    zones[zoneId].push({ panelId, order: def.defaultOrder });
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
        rightPanelSizes: { browser: 50 },
        leftPanelSize: 18,
        leftPanelWidth: 0,
        setLeftPanelWidth: (width) => set({ leftPanelWidth: Math.max(0, width) }),

        togglePanel: (panelId: string) => {
          const { zones } = get();
          const currentZoneId = findPanelZone(zones, panelId);

          if (currentZoneId) {
            // Panel is already in a zone
            const zone = zones[currentZoneId];
            if (zone.activePanelId === panelId) {
              // Already active → toggle expanded (show/hide)
              set((state) => ({
                zones: {
                  ...state.zones,
                  [currentZoneId]: {
                    ...state.zones[currentZoneId],
                    expanded: !zone.expanded,
                  },
                },
              }));
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
            // Panel is not in any zone → add to its default zone alongside existing panels
            const def = dockPanelRegistry[panelId];
            if (!def) return;
            const targetZoneId = def.defaultZone;
            set((state) => {
              const zone = state.zones[targetZoneId];
              const nextPanels = zone ? [...zone.panels, panelId] : [panelId];
              return {
                zones: {
                  ...state.zones,
                  [targetZoneId]: {
                    ...zone,
                    panels: nextPanels,
                    activePanelId: panelId,
                    expanded: true,
                  },
                },
                barItems: state.barItems.map((item) =>
                  item.panelId === panelId ? { ...item, visible: true } : item,
                ),
              };
            });
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
                ? null
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

        setRightPanelSize: (panelId: string, size: number) => {
          // Clamp to at least 12% (= minSize) so a collapsed/transitioning resize
          // event can never overwrite the stored size with an unusably small value.
          const clamped = Math.max(size, 12);
          set((state) => ({
            rightPanelSizes: { ...state.rightPanelSizes, [panelId]: clamped },
          }));
        },

        setLeftPanelSize: (size: number) => {
          set({ leftPanelSize: size });
        },

        restoreDefaultLayout: () => {
          const defaults = createInitialState();
          set({ zones: defaults.zones, barItems: defaults.barItems, rightPanelSizes: { browser: 50 }, leftPanelSize: 18 });
        },
      };
    },
    {
      name: "neeko-dock-layout",
      version: 5,
      partialize: (state) => ({
        zones: state.zones,
        barItems: state.barItems,
        rightPanelSizes: state.rightPanelSizes,
        leftPanelSize: state.leftPanelSize,
      }),
      merge: (persisted: unknown, current: DockStore) => {
        const saved = persisted as
          | { zones?: Record<string, DockZoneState>; barItems?: DockBarItem[]; rightPanelSizes?: Record<string, number>; leftPanelSize?: number }
          | undefined;
        const defaults = createInitialState();
        // Rebuild zone panels from registry defaultZone, then restore
        // expanded / activePanelId from persisted state where possible.
        const zones: Record<string, DockZoneState> = {};
        for (const [zoneId, defaultZone] of Object.entries(defaults.zones)) {
          const savedZone = saved?.zones?.[zoneId];
          const panels = defaultZone.panels;
          const restoredActivePanelId = panels.length > 0 ? panels[0] : null;
          zones[zoneId] = {
            ...defaultZone,
            expanded: zoneId === "left" ? true : (savedZone?.expanded ?? defaultZone.expanded),
            activePanelId: restoredActivePanelId,
          };
        }
        // Rebuild barItems from registry to pick up side/order changes
        const barItems = defaults.barItems.map((defaultItem) => {
          const savedItem = saved?.barItems?.find((b) => b.panelId === defaultItem.panelId);
          return savedItem
            ? { ...defaultItem, visible: savedItem.visible }
            : defaultItem;
        });
        const rightPanelSizes = saved?.rightPanelSizes ?? { browser: 50 };
        const leftPanelSize = saved?.leftPanelSize ?? 18;
        return {
          ...current,
          zones,
          barItems,
          rightPanelSizes,
          leftPanelSize,
        };
      },
    },
  )
);
