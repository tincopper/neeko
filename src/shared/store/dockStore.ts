import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { DOCK_PANEL_META, MIN_ZONE_SIZE_PERCENT } from '../dock/panelMeta';

import { isAppView, useAppViewStore, type AppView } from './appViewStore';

// -- Types --

/** Zone 标识联合类型：非法 zone 在编译期拦截（Step 3 加 bottom 时在此扩展）。 */
export type ZoneId = 'left' | 'right';

export interface DockZoneState {
  id: ZoneId;
  panels: string[];
  activePanelId: string | null;
  expanded: boolean;
}

export interface DockBarItem {
  panelId: string;
  side: 'left' | 'right';
  order: number;
  visible: boolean;
}

export interface DockStore {
  zones: Record<ZoneId, DockZoneState>;
  barItems: DockBarItem[];
  /** Per-panel remembered zone width percentage (0-100). Only panels with non-default widths are stored. */
  rightPanelSizes: Record<string, number>;
  /** Left sidebar width as a percentage (0-100). Default 18. */
  leftPanelSize: number;
  /** Left zone expanded state before a tab (center) view opened (transient, restored on close). */
  leftZoneExpandedBeforeTabView: boolean | null;

  togglePanel: (panelId: string) => void;
  activatePanel: (zoneId: ZoneId, panelId: string) => void;
  closePanel: (panelId: string) => void;
  setRightPanelSize: (panelId: string, size: number) => void;
  setLeftPanelSize: (size: number) => void;
}

// -- Defaults --

const DEFAULT_ZONES: Record<ZoneId, Omit<DockZoneState, 'panels' | 'activePanelId'>> = {
  left: { id: 'left', expanded: true },
  right: { id: 'right', expanded: false },
};

// -- Helpers --

function buildDefaultPanels(): Record<string, string[]> {
  const zones: Record<string, { panelId: string; order: number }[]> = {};
  for (const [panelId, def] of Object.entries(DOCK_PANEL_META)) {
    if (def.openAs === 'tab') continue; // tab-mode panels are not dock panels
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
  for (const [panelId, def] of Object.entries(DOCK_PANEL_META)) {
    if (def.defaultZone === 'left' || def.defaultZone === 'right') {
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
  const buildZone = (zoneId: ZoneId): DockZoneState => {
    const panels = panelMap[zoneId] ?? [];
    return {
      ...DEFAULT_ZONES[zoneId],
      panels,
      activePanelId: panels.length > 0 ? panels[0] : null,
    };
  };
  // 显式枚举 ZoneId：新增 zone（Step 3 bottom）时编译器强制回到这里补全
  return {
    zones: { left: buildZone('left'), right: buildZone('right') },
    barItems: buildDefaultBarItems(),
  };
}

function findPanelZone(zones: Record<ZoneId, DockZoneState>, panelId: string): ZoneId | null {
  for (const zoneId of Object.keys(zones) as ZoneId[]) {
    if (zones[zoneId].panels.includes(panelId)) return zoneId;
  }
  return null;
}

/**
 * `appView` 是否指向一个 tab 面板（中心视图）。
 *
 * `'normal'` / `'settings'` 不是面板 id（`DOCK_PANEL_META[...]` 为 undefined）⇒ false，
 * 所以调用处不需要自己排除它们 —— 也不需要把 'library' 写死在两处。
 */
function isTabView(view: string): boolean {
  return DOCK_PANEL_META[view]?.openAs === 'tab';
}

/**
 * Partial state for opening a tab (center) view: apply that view's left-zone policy and
 * remember the previous expanded state so it can be restored on close.
 *
 * # 左栏策略是**每个视图自己的属性**（`DOCK_PANEL_META[id].collapseLeftZone`）
 *
 * | 视图 | 策略 | 结果 |
 * | --- | --- | --- |
 * | Library | 收起（缺省） | 中心区整幅给 master-detail（它自带导航列，左栏会是第三层导航） |
 * | Tasks | **不收起** | 只占中间区：左栏 Projects 是「切项目」的入口，收起等于把上下文藏起来 |
 *
 * 所以这里不再“一律收起”，而是按属性决定 `expanded`。特例写法（`if (id === 'tasks')`）
 * 会在新增第三个中心视图时静默沿用旧行为，而属性写法强制新视图回答这个问题。
 *
 * # `fromTabView` 为什么必需
 *
 * 从另一个 tab 视图切过来（Library → Tasks）时，左栏的展开态**已经被上一个视图改过**。
 * 再记一次当时的 `expanded`，记住的值就从 true 变成 false —— 用户之后退出中心视图，
 * 左栏永远回不来。所以“已经在 tab 视图里”时保留原来那一份。
 *
 * 注意：**保留记忆不等于保留展开态**。Tasks 不收左栏，所以从 Library 切过来时它要
 * 把左栏**展开**（否则 Projects 永远回不来）；记忆值仍然只记“打开 tab 之前”的那一份。
 *
 * 「哪一个 tab 视图」不记：中心区同一时只会有一个视图（`appView` 单值），
 * 因此一个布尔量就够，多存一份视图名只会多一个可以不一致的字段。
 */
function openTabView(state: DockStore, panelId: string, fromTabView: boolean): Partial<DockStore> {
  const collapseLeft = DOCK_PANEL_META[panelId]?.collapseLeftZone ?? true;
  return {
    leftZoneExpandedBeforeTabView: fromTabView
      ? state.leftZoneExpandedBeforeTabView
      : (state.zones.left?.expanded ?? true),
    zones: {
      ...state.zones,
      left: state.zones.left ? { ...state.zones.left, expanded: !collapseLeft } : state.zones.left,
    },
  };
}

/** Partial state for leaving a tab (center) view: restore the left zone expanded state. */
function restoreLeftZone(state: DockStore): Partial<DockStore> {
  return {
    zones: {
      ...state.zones,
      left: state.zones.left
        ? { ...state.zones.left, expanded: state.leftZoneExpandedBeforeTabView ?? true }
        : state.zones.left,
    },
  };
}

/**
 * 从持久化快照恢复 zones：面板清单按 registry 重建（registry 变更后防悬挂），
 * expanded / activePanelId 尽力恢复 —— activePanelId 仅在仍属于重建后面板清单时
 * 生效，否则回退 panels[0]。
 */
function restoreZones(
  savedZones: Partial<Record<ZoneId, DockZoneState>> | undefined,
  defaults: Record<ZoneId, DockZoneState>,
): Record<ZoneId, DockZoneState> {
  const buildZone = (zoneId: ZoneId): DockZoneState => {
    const defaultZone = defaults[zoneId];
    const savedZone = savedZones?.[zoneId];
    const panels = defaultZone.panels;
    const restoredActivePanelId =
      savedZone?.activePanelId && panels.includes(savedZone.activePanelId)
        ? savedZone.activePanelId
        : panels.length > 0
          ? panels[0]
          : null;
    return {
      ...defaultZone,
      expanded: zoneId === 'left' ? true : (savedZone?.expanded ?? defaultZone.expanded),
      activePanelId: restoredActivePanelId,
    };
  };
  // 显式枚举 ZoneId：新增 zone（Step 3 bottom）时编译器强制回到这里补全
  return { left: buildZone('left'), right: buildZone('right') };
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
        leftZoneExpandedBeforeTabView: null,

        togglePanel: (panelId: string) => {
          // Tab-mode panels (e.g. library) are center views — toggle via appView,
          // never dock them into a zone (avoids left-zone/center double render).
          // 与左栏互斥：打开即收起左栏（含 Projects），关闭/切走即恢复。
          const def = DOCK_PANEL_META[panelId];
          if (def?.openAs === 'tab') {
            // Defensive guard: only real AppView values are valid tab targets.
            if (!isAppView(panelId)) return;
            const current = useAppViewStore.getState().appView;
            const next: AppView = current === panelId ? 'normal' : panelId;
            useAppViewStore.getState().setAppView(next);
            set((state) =>
              next === panelId
                ? openTabView(state, panelId, isTabView(current))
                : restoreLeftZone(state),
            );
            return;
          }
          // Opening any dock panel exits a tab (center) view back to workspace.
          // 退出 tab 视图时的本次点击一律按“激活”处理（切到该面板并展开），不做 toggle：
          // tab 覆盖期间 zone 可见态是过期/被收起的，此时 toggle 会反直觉地关掉用户刚点的面板。
          //
          // 判据是「当前 appView 是否为一个 tab 面板」，**不是**硬编码 'library'：
          // 硬编码时打开 Tasks 再点右栏面板，中心视图不退出，右栏面板会叠在看板上看不见。
          // `'normal'` / `'settings'` 不是面板 id（`DOCK_PANEL_META[...]` 为 undefined），
          // 所以它们天然落进「不是 tab 视图」这一边。
          const currentView = useAppViewStore.getState().appView;
          const exitedTabView = isTabView(currentView);
          if (exitedTabView) {
            useAppViewStore.getState().setAppView('normal');
            // 恢复左栏原展开态（Library 打开时被收起）
            set((state) => restoreLeftZone(state));
          }

          const { zones } = get();
          const currentZoneId = findPanelZone(zones, panelId);

          if (currentZoneId) {
            // Panel is already in a zone
            const zone = zones[currentZoneId];
            if (zone.activePanelId === panelId && !exitedTabView) {
              // Active and visible → toggle expanded (show/hide)
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
            const def = DOCK_PANEL_META[panelId];
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

        activatePanel: (zoneId: ZoneId, panelId: string) => {
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

        closePanel: (panelId: string) => {
          set((state) => {
            const currentZoneId = findPanelZone(state.zones, panelId);
            if (!currentZoneId) return state;
            const zone = state.zones[currentZoneId];
            const nextPanels = zone.panels.filter((p) => p !== panelId);
            const nextActive = zone.activePanelId === panelId ? null : zone.activePanelId;
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

        setRightPanelSize: (panelId: string, size: number) => {
          const clamped = Math.max(size, MIN_ZONE_SIZE_PERCENT);
          set((state) => ({
            rightPanelSizes: { ...state.rightPanelSizes, [panelId]: clamped },
          }));
        },

        setLeftPanelSize: (size: number) => {
          set({ leftPanelSize: size });
        },
      };
    },
    {
      name: 'neeko-dock-layout',
      version: 5,
      partialize: (state) => ({
        zones: state.zones,
        barItems: state.barItems,
        rightPanelSizes: state.rightPanelSizes,
        leftPanelSize: state.leftPanelSize,
      }),
      merge: (persisted: unknown, current: DockStore) => {
        const saved = persisted as
          | {
              zones?: Record<string, DockZoneState>;
              barItems?: DockBarItem[];
              rightPanelSizes?: Record<string, number>;
              leftPanelSize?: number;
            }
          | undefined;
        const defaults = createInitialState();
        const zones = restoreZones(saved?.zones, defaults.zones);
        // Rebuild barItems from registry to pick up side/order changes
        const barItems = defaults.barItems.map((defaultItem) => {
          const savedItem = saved?.barItems?.find((b) => b.panelId === defaultItem.panelId);
          return savedItem ? { ...defaultItem, visible: savedItem.visible } : defaultItem;
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
  ),
);
