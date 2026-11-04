import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import {
  DEFAULT_ZONE_SIZE_PERCENT,
  DOCK_SLOTS,
  DOCK_VIEW_META,
  MIN_ZONE_SIZE_PERCENT,
  applyActivate,
  applyMove,
  applyOnBar,
  applyToggle,
  appViewKey,
  isDockSlot,
  panelView,
  placementsInSlot,
  type DockLayoutState,
  type DockPlacement,
  type DockSlot,
  type DockZoneRuntime,
  type ViewKey,
} from '../dock';

import { isAppView, useAppViewStore, type AppView } from './appViewStore';

// -- Types --

/** 持久化快照的形状（= 需要跨重启保留的部分；`zones` 是布局事实的一部分）。 */
export interface DockSnapshot {
  placements: Record<string, DockPlacement>;
  zones: Record<DockSlot, DockZoneRuntime>;
  /** 视图宽度记忆（键 = ViewKey，基数 ∝ 声明表，不随 tab 实例增长）。 */
  viewSizes: Record<string, number>;
  leftSlotSize: number;
}

export interface DockStore extends DockLayoutState {
  viewSizes: Readonly<Record<string, number>>;
  leftSlotSize: number;
  /** Library 打开前左栏的展开态（transient，不持久化；关闭时据此恢复）。 */
  leftZoneExpandedBeforeLibrary: boolean | null;

  /**
   * 把视图移到某个槽的某个下标。**能力校验的权威**（`movable` / 非法槽位）：拒绝时
   * 返回 false 且状态不变 —— UI 层只负责把 false 翻译成提示，不自行放行。
   */
  moveView: (view: ViewKey, slot: DockSlot, index?: number) => boolean;
  activateView: (view: ViewKey) => void;
  toggleView: (view: ViewKey) => void;
  setViewOnBar: (view: ViewKey, onBar: boolean) => void;
  setViewSize: (view: ViewKey, size: number) => void;
  setSlotExpanded: (slot: DockSlot, expanded: boolean) => void;
  setLeftSlotSize: (size: number) => void;
  /** 中心视图（Library）打开：收起左栏并记住原展开态 —— 互斥语义的唯一写入口。 */
  enterCenterView: () => void;
  /** 中心视图退出：恢复左栏原展开态。 */
  exitCenterView: () => void;
}

// -- Defaults --

const DEFAULT_ZONE_EXPANDED: Record<DockSlot, boolean> = { left: true, right: false };

// -- Helpers (pure) --

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** order 是**槽内**相对序：每次改动后必须补齐 0..n-1（就地写，调用方持的是副本）。 */
function normalizeOrders(placements: Record<string, DockPlacement>): void {
  for (const slot of DOCK_SLOTS) {
    placementsInSlot(placements, slot).forEach((placement, order) => {
      placements[placement.view] = { ...placement, order };
    });
  }
}

/**
 * 把任意持久化输入折成合法布局 —— **每次 merge 都跑**，不只版本迁移时。
 *
 * 手工改坏 localStorage 是必须覆盖的输入：未知视图丢弃（registry 删面板后的旧快照）、
 * 非法槽位与非有限 order 回默认、每槽归一化、`activeView` 悬挂回落首个、左槽展开强制 true。
 */
export function sanitize(persisted: unknown): DockSnapshot {
  const saved = isRecord(persisted) ? persisted : {};
  const savedPlacements = isRecord(saved.placements) ? saved.placements : {};
  const savedZones = isRecord(saved.zones) ? saved.zones : {};
  const savedSizes = isRecord(saved.viewSizes) ? saved.viewSizes : {};

  const placements: Record<string, DockPlacement> = {};
  for (const [view, meta] of Object.entries(DOCK_VIEW_META)) {
    const raw = isRecord(savedPlacements[view]) ? savedPlacements[view] : {};
    // 不可移动的视图（P1 的 tabHost）永远回自己的槽：拖拽不得打破「宿主在自己槽」
    const slot = meta.movable !== false && isDockSlot(raw.slot) ? raw.slot : meta.defaultSlot;
    placements[view] = {
      view: meta.view,
      slot,
      order: finiteNumber(raw.order) ?? meta.defaultOrder,
      onBar: typeof raw.onBar === 'boolean' ? raw.onBar : meta.defaultOnBar !== false,
    };
  }
  normalizeOrders(placements);

  const zones = {} as Record<DockSlot, DockZoneRuntime>;
  for (const slot of DOCK_SLOTS) {
    const raw = isRecord(savedZones[slot]) ? savedZones[slot] : {};
    const views = placementsInSlot(placements, slot).map((placement) => placement.view);
    const savedActive = typeof raw.activeView === 'string' ? (raw.activeView as ViewKey) : null;
    zones[slot] = {
      // 左栏是项目列表的常驻位：与其让用户重启后看到一片空白，不如固定展开（保留既有行为）
      expanded:
        slot === 'left'
          ? true
          : typeof raw.expanded === 'boolean'
            ? raw.expanded
            : DEFAULT_ZONE_EXPANDED[slot],
      activeView:
        savedActive !== null && views.includes(savedActive) ? savedActive : (views[0] ?? null),
    };
  }

  const viewSizes: Record<string, number> = {};
  for (const [view, size] of Object.entries(savedSizes)) {
    const value = finiteNumber(size);
    if (!DOCK_VIEW_META[view] || value === null) continue;
    viewSizes[view] = Math.max(value, MIN_ZONE_SIZE_PERCENT);
  }

  return {
    placements,
    zones,
    viewSizes,
    leftSlotSize: finiteNumber(saved.leftSlotSize) ?? DEFAULT_ZONE_SIZE_PERCENT,
  };
}

/** 声明表 → 默认布局。默认值只由 `sanitize` 一条实现给出（空输入即默认）。 */
export function createDefaultDockState(): DockSnapshot {
  return sanitize(undefined);
}

/**
 * v5 的键是**无前缀的 panel id**（`projects` / `library`）。这里按「panel: → appView:」
 * 各查一次表把它映射回 ViewKey —— 查表而不是解析前缀，所以已删的面板自然映射失败并被丢弃。
 */
function legacyViewOf(panelId: string): ViewKey | null {
  const asPanel = panelView(panelId);
  if (DOCK_VIEW_META[asPanel]) return asPanel;
  const asAppView = appViewKey(panelId);
  return DOCK_VIEW_META[asAppView] ? asAppView : null;
}

/**
 * v5 → v6：把「两份表示」折成一份。
 *
 * v5 里 `barItems[]`（side / order / visible）与 `zones[].panels` 各自表达同一事实，
 * `zones[].activePanelId` 是 zone 前台，`rightPanelSizes` 以 panelId 为键。v6 只留
 * `placements` + `zones.activeView` + `viewSizes`。任何非法值都交给 `sanitize` 收口
 * （迁移函数不重复实现 clamp / 归一化）。
 */
export function migrateFromV5(persisted: unknown): DockSnapshot {
  const saved = isRecord(persisted) ? persisted : {};

  const placements: Record<string, unknown> = {};
  const barItems = Array.isArray(saved.barItems) ? saved.barItems : [];
  for (const item of barItems) {
    if (!isRecord(item) || typeof item.panelId !== 'string') continue;
    const view = legacyViewOf(item.panelId);
    if (!view) continue;
    placements[view] = { view, slot: item.side, order: item.order, onBar: item.visible };
  }

  const savedZones = isRecord(saved.zones) ? saved.zones : {};
  const zones: Record<string, unknown> = {};
  for (const slot of DOCK_SLOTS) {
    const raw = isRecord(savedZones[slot]) ? savedZones[slot] : {};
    const activePanelId = typeof raw.activePanelId === 'string' ? raw.activePanelId : null;
    zones[slot] = {
      expanded: raw.expanded,
      activeView: activePanelId ? (legacyViewOf(activePanelId) ?? undefined) : undefined,
    };
  }

  const viewSizes: Record<string, number> = {};
  const savedSizes = isRecord(saved.rightPanelSizes) ? saved.rightPanelSizes : {};
  for (const [panelId, size] of Object.entries(savedSizes)) {
    const view = legacyViewOf(panelId);
    const value = finiteNumber(size);
    if (view && value !== null) viewSizes[view] = value;
  }

  return sanitize({ placements, zones, viewSizes, leftSlotSize: saved.leftPanelSize });
}

// -- Store --

const INITIAL = createDefaultDockState();

export const useDockStore = create<DockStore>()(
  persist(
    (set, get) => ({
      ...INITIAL,
      leftZoneExpandedBeforeLibrary: null,

      moveView: (view: ViewKey, slot: DockSlot, index?: number) => {
        // 能力校验只在 action 层（placement.ts 不依赖声明表）：不可移动的视图固定在自己的槽，
        // 任何 move 请求都必须被拒 —— 否则「宿主在本槽」的不变量可被拖拽打破。
        const meta = DOCK_VIEW_META[view];
        if (!meta || meta.movable === false || !isDockSlot(slot)) return false;

        const state = get();
        const next = applyMove(state, { view, to: slot, index });
        if (next === state) return false;

        // `host: 'none'` 的视图没有 zone 内容（中心视图入口，如 Library）：移动它**只改图标落位**。
        // 否则目标槽的前台会被指向一个渲染不出内容的视图 —— `DockZone` 只能兜底显示槽内别的
        // 面板，用户拖的是 Library 图标却看到 Files 打开。源槽的前台修复照旧保留（applyMove 已做），
        // 这里只把目标槽运行态原样还回去。
        const zones =
          meta.host === 'none' ? { ...next.zones, [slot]: state.zones[slot] } : next.zones;

        set({ placements: next.placements, zones });
        return true;
      },

      activateView: (view: ViewKey) => {
        // 激活一个 zone 视图 = 离开全宽中心视图（与 `toggleView` 同一语义：打开任何 dock 面板
        // 都会退出 Library）。缺了这一步，「把 tab 停靠到左栏」会得到「中心仍是 Library、
        // 左栏却展开」—— 互斥不变量在构造上被打破（P1 发现的边缘态）。
        const meta = DOCK_VIEW_META[view];
        if (meta && meta.host !== 'none' && useAppViewStore.getState().appView === 'library') {
          useAppViewStore.getState().setAppView('normal');
          get().exitCenterView();
        }

        const state = get();
        const next = applyActivate(state, view);
        if (next === state) return;
        set({ zones: next.zones });
      },

      toggleView: (view: ViewKey) => {
        const meta = DOCK_VIEW_META[view];
        if (!meta) return;

        if (meta.activation.kind === 'appView') {
          const target = meta.activation.view;
          // 防御：声明表写了非法 AppView 时忽略（不把 appViewStore 推到未知值）
          if (!isAppView(target)) return;
          const current = useAppViewStore.getState().appView;
          const next: AppView = current === target ? 'normal' : target;
          useAppViewStore.getState().setAppView(next);
          if (next === target) get().enterCenterView();
          else get().exitCenterView();
          return;
        }

        // store 不持有 tab 空间：`openTab` 的落地（找已有 / 新建 / 停靠）全部在 app 层
        // `useDockBarOpenTab`，由 `useDockBarButtons` 注入给 DockBarButton。这里只负责
        // 「点了图标但 store 什么都不该动」—— 否则会出现「槽被打开了、tab 却没出现」。
        if (meta.activation.kind === 'openTab') return;

        // 从中心视图退出：本次点击强制**激活**（tab 覆盖期间 zone 可见态是过期的，
        // 此时走 toggle 会反直觉地关掉用户刚点的面板）。
        const exitedCenterView = useAppViewStore.getState().appView === 'library';
        if (exitedCenterView) {
          useAppViewStore.getState().setAppView('normal');
          get().exitCenterView();
        }

        const state = get();
        const next = exitedCenterView ? applyActivate(state, view) : applyToggle(state, view);
        if (next.zones === state.zones) return;
        set({ zones: next.zones });
      },

      setViewOnBar: (view: ViewKey, onBar: boolean) => {
        const state = get();
        const next = applyOnBar(state, view, onBar);
        if (next === state) return;
        set({ placements: next.placements });
      },

      setViewSize: (view: ViewKey, size: number) => {
        const clamped = Math.max(size, MIN_ZONE_SIZE_PERCENT);
        const current = get().viewSizes[view];
        if (current === clamped) return;
        set({ viewSizes: { ...get().viewSizes, [view]: clamped } });
      },

      setSlotExpanded: (slot: DockSlot, expanded: boolean) => {
        set((state) => {
          const zone = state.zones[slot];
          if (!zone || zone.expanded === expanded) return state;
          return { zones: { ...state.zones, [slot]: { ...zone, expanded } } };
        });
      },

      setLeftSlotSize: (size: number) => set({ leftSlotSize: size }),

      enterCenterView: () => {
        set((state) => ({
          leftZoneExpandedBeforeLibrary: state.zones.left?.expanded ?? true,
          zones: {
            ...state.zones,
            left: { ...state.zones.left, expanded: false },
          },
        }));
      },

      exitCenterView: () => {
        set((state) => ({
          zones: {
            ...state.zones,
            left: { ...state.zones.left, expanded: state.leftZoneExpandedBeforeLibrary ?? true },
          },
        }));
      },
    }),
    {
      name: 'neeko-dock-layout',
      version: 6,
      partialize: (state) => ({
        placements: state.placements,
        zones: state.zones,
        viewSizes: state.viewSizes,
        leftSlotSize: state.leftSlotSize,
      }),
      // 迁移只负责「旧形状 → 新形状」；合法性一律由 sanitize 收口（每次 merge 都跑）
      migrate: (persisted, version) => (version < 6 ? migrateFromV5(persisted) : persisted),
      merge: (persisted, current) => ({ ...current, ...sanitize(persisted) }),
    },
  ),
);
