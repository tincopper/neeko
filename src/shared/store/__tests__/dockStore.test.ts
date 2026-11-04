import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_ZONE_SIZE_PERCENT,
  DOCK_VIEW_META,
  MIN_ZONE_SIZE_PERCENT,
  appViewKey,
  panelView,
  slotViews,
} from '../../dock';
import { isAppView, useAppViewStore } from '../appViewStore';
import { createDefaultDockState, migrateFromV5, sanitize, useDockStore } from '../dockStore';

/**
 * 注入三类「P0 声明表里刻意还没落地」的视图行，用来钉住 store action 层的能力校验
 * 与分支（P1/P2 才会真的加行，但校验不能等到那时才第一次被跑到）：
 *
 * - `appView:mysteryTab`：activation 声称 appView，值却非法（保留旧 `openAs:'tab'` 负例的防护思路）
 * - `tabHost:right`：`movable:false`（G5：宿主固定在自己的槽）
 * - `tabKind:agent-chat`：`openTab`（P0 无 tab 端口 → 点击必须是 no-op）
 *
 * 工厂里用字面量而不是 import 的 mint：`vi.mock` 会被提升到 import 之前。
 */
vi.mock('../../dock/panelMeta', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../dock/panelMeta')>();
  return {
    ...actual,
    DOCK_VIEW_META: {
      ...actual.DOCK_VIEW_META,
      'appView:mysteryTab': {
        view: 'appView:mysteryTab',
        host: 'none',
        activation: { kind: 'appView', view: 'mysteryTab' },
        defaultSlot: 'left',
        defaultOrder: 99,
      },
      'tabHost:right': {
        view: 'tabHost:right',
        host: 'tabHost',
        activation: { kind: 'toggleZone' },
        defaultSlot: 'right',
        defaultOrder: 98,
        movable: false,
      },
      'tabKind:agent-chat': {
        view: 'tabKind:agent-chat',
        host: 'none',
        activation: { kind: 'openTab', tabKind: 'agent-chat' },
        defaultSlot: 'right',
        defaultOrder: 97,
      },
    },
  };
});

const PROJECTS = panelView('projects');
const FILES = panelView('files');
const LIBRARY = appViewKey('library');
const MYSTERY = appViewKey('mysteryTab');
const TAB_HOST = 'tabHost:right' as never;

/** 每个用例从「声明表 → 默认布局」重建基线（不手抄默认值，避免测试固化一份过期事实）。 */
function resetStores() {
  useAppViewStore.setState({ appView: 'normal' });
  useDockStore.setState({ ...createDefaultDockState(), leftZoneExpandedBeforeLibrary: null });
}

beforeEach(() => {
  localStorage.clear();
  resetStores();
});

describe('dockStore — 落位是唯一真源（G3）', () => {
  it('声明表里每个视图都有一条落位，且默认槽来自 meta', () => {
    const { placements } = useDockStore.getState();

    for (const [view, meta] of Object.entries(DOCK_VIEW_META)) {
      expect(placements[view]?.view).toBe(view);
      expect(placements[view].slot).toBe(meta.defaultSlot);
    }
  });

  it('每槽 order 归一化为 0..n-1（order 是槽内相对序，不是全局序）', () => {
    const state = useDockStore.getState();

    for (const slot of ['left', 'right'] as const) {
      const orders = Object.values(state.placements)
        .filter((p) => p.slot === slot)
        .map((p) => p.order)
        .sort((a, b) => a - b);
      expect(orders).toEqual(orders.map((_, index) => index));
    }
  });

  it('默认前台 = 各槽首个落位（左 projects / 右 files）', () => {
    const state = useDockStore.getState();

    expect(state.zones.left).toEqual({ expanded: true, activeView: PROJECTS });
    expect(state.zones.right).toEqual({ expanded: false, activeView: FILES });
  });
});

describe('dockStore — Library（中心视图入口）', () => {
  it('library 有落位（图标在左栏）但主机是 none：不进 zone', () => {
    expect(useDockStore.getState().placements[LIBRARY].slot).toBe('left');
    expect(DOCK_VIEW_META[LIBRARY].host).toBe('none');
  });

  it('打开 library：切 appView、收起左栏并记住展开态', () => {
    useDockStore.getState().toggleView(LIBRARY);

    expect(useAppViewStore.getState().appView).toBe('library');
    const state = useDockStore.getState();
    expect(state.zones.left.expanded).toBe(false);
    expect(state.leftZoneExpandedBeforeLibrary).toBe(true);
  });

  it('Library 打开时激活 zone 视图：先退出中心视图，不留「中心是 Library 但左栏展开」', () => {
    useDockStore.getState().toggleView(LIBRARY);
    expect(useAppViewStore.getState().appView).toBe('library');
    expect(useDockStore.getState().zones.left.expanded).toBe(false);

    useDockStore.getState().activateView(TAB_HOST);

    // 激活 dock 视图 = 离开全宽中心视图（与 toggleView 同一语义）
    expect(useAppViewStore.getState().appView).toBe('normal');
    const state = useDockStore.getState();
    expect(state.zones.right.expanded).toBe(true);
    expect(state.zones.right.activeView).toBe(TAB_HOST);
  });

  it('关闭 library：恢复记住的左栏展开态', () => {
    useDockStore.getState().toggleView(LIBRARY);
    useDockStore.getState().toggleView(LIBRARY);

    expect(useAppViewStore.getState().appView).toBe('normal');
    expect(useDockStore.getState().zones.left.expanded).toBe(true);
  });

  it('打开前左栏已收起：关闭后仍保持收起', () => {
    useDockStore.getState().setSlotExpanded('left', false);

    useDockStore.getState().toggleView(LIBRARY);
    expect(useDockStore.getState().leftZoneExpandedBeforeLibrary).toBe(false);

    useDockStore.getState().toggleView(LIBRARY);
    expect(useDockStore.getState().zones.left.expanded).toBe(false);
  });

  it('打开 dock 面板会退出 library 视图并恢复左栏', () => {
    useDockStore.getState().toggleView(LIBRARY);
    expect(useAppViewStore.getState().appView).toBe('library');

    useDockStore.getState().toggleView(FILES);

    expect(useAppViewStore.getState().appView).toBe('normal');
    const state = useDockStore.getState();
    expect(state.zones.left.expanded).toBe(true);
    expect(state.zones.right.expanded).toBe(true); // files 被激活
  });

  it('声明表里的 AppView 非法时忽略（防御，不把 appViewStore 推到未知值）', () => {
    useDockStore.getState().toggleView(MYSTERY);

    expect(useAppViewStore.getState().appView).toBe('normal');
    const state = useDockStore.getState();
    expect(state.zones.left.expanded).toBe(true);
    expect(state.leftZoneExpandedBeforeLibrary).toBeNull();
  });

  it('openTab 类入口在 P0 是 no-op（tab 端口属于 app 层，P2 才接）', () => {
    const before = useDockStore.getState();

    useDockStore.getState().toggleView('tabKind:agent-chat' as never);

    expect(useDockStore.getState().placements).toBe(before.placements);
    expect(useDockStore.getState().zones).toBe(before.zones);
    expect(useAppViewStore.getState().appView).toBe('normal');
  });

  it('未知视图 → 状态不变', () => {
    const before = useDockStore.getState();
    useDockStore.getState().toggleView(panelView('ghost'));

    expect(useDockStore.getState().zones).toBe(before.zones);
  });
});

describe('dockStore — toggle/activate 框架契约', () => {
  it('normal 下点已展开的面板 → 收起（toggle-off 仅当前可见时成立）', () => {
    useDockStore.getState().toggleView(PROJECTS);

    expect(useDockStore.getState().zones.left.expanded).toBe(false);
  });

  it('Library 中点 Projects → 退出并展开（不反转为收起）', () => {
    useDockStore.getState().toggleView(LIBRARY);

    useDockStore.getState().toggleView(PROJECTS);

    expect(useAppViewStore.getState().appView).toBe('normal');
    const state = useDockStore.getState();
    expect(state.zones.left).toEqual({ expanded: true, activeView: PROJECTS });
  });

  it('Library 中点右栏已展开面板 → 保持展开（不 toggle 关掉）', () => {
    useDockStore.getState().activateView(FILES);
    useDockStore.getState().toggleView(LIBRARY);

    useDockStore.getState().toggleView(FILES);

    expect(useAppViewStore.getState().appView).toBe('normal');
    expect(useDockStore.getState().zones.right).toEqual({ expanded: true, activeView: FILES });
  });

  it('dock 面板不驱动 appView', () => {
    useDockStore.getState().toggleView(PROJECTS);
    useDockStore.getState().activateView(PROJECTS);

    expect(useAppViewStore.getState().appView).toBe('normal');
  });
});

describe('dockStore.moveView — 能力校验在 action 层（G5）', () => {
  it('G5：不可移动的视图（tabHost）被拒，状态原样不动', () => {
    const before = useDockStore.getState();

    expect(before.moveView(TAB_HOST, 'left')).toBe(false);

    const after = useDockStore.getState();
    expect(after.placements).toBe(before.placements);
    expect(after.zones).toBe(before.zones);
  });

  it('未知视图 / 非法槽位 → false', () => {
    expect(useDockStore.getState().moveView(panelView('ghost'), 'left')).toBe(false);
    expect(useDockStore.getState().moveView(FILES, 'top' as never)).toBe(false);
  });

  it('跨槽移动：落位与 zone 前台同时更新（不可能只改一半）', () => {
    expect(useDockStore.getState().moveView(PROJECTS, 'right', 0)).toBe(true);

    const state = useDockStore.getState();
    expect(state.placements[PROJECTS]).toMatchObject({ slot: 'right', order: 0 });
    expect(state.zones.right).toEqual({ expanded: true, activeView: PROJECTS });
    // 源槽前台改指邻位（projects 原在位置 0 → 新的第 0 项），且必须仍在槽内（G4 永不悬挂）
    const remainingLeft = slotViews(state, 'left');
    expect(remainingLeft).not.toContain(PROJECTS);
    expect(state.zones.left.activeView).toBe(remainingLeft[0]);
  });

  it('同位置 → false（幂等：不改状态也不触发订阅）', () => {
    expect(useDockStore.getState().moveView(FILES, 'right', 0)).toBe(false);
  });

  it('host:none 的视图换栏：只改图标落位，不把目标槽前台指向「无内容」的视图', () => {
    const before = useDockStore.getState();
    const rightBefore = before.zones.right;

    expect(before.moveView(LIBRARY, 'right', 0)).toBe(true);

    const after = useDockStore.getState();
    // 落位确实移动了（图标换到右栏）
    expect(after.placements[LIBRARY]).toMatchObject({ slot: 'right', order: 0 });
    // 右槽运行态原样：拖的是 Library 图标，不该顺带把右槽展开并顶掉 files 前台
    expect(after.zones.right).toBe(rightBefore);
    // 源（左）槽前台就地改指邻位，不悬挂（applyMove 的修复不能被覆盖）
    const leftViews = slotViews(after, 'left');
    expect(leftViews).not.toContain(LIBRARY);
    expect(after.zones.left.activeView).toBe(leftViews[0]);
  });
});

describe('dockStore 其它 mutator', () => {
  it('setSlotExpanded：同值不改引用', () => {
    const before = useDockStore.getState().zones.left.expanded;
    useDockStore.getState().setSlotExpanded('left', before);
    expect(useDockStore.getState().zones.left.expanded).toBe(before);

    useDockStore.getState().setSlotExpanded('right', true);
    expect(useDockStore.getState().zones.right.expanded).toBe(true);
  });

  it('setViewOnBar：取消钉住只改 onBar', () => {
    useDockStore.getState().setViewOnBar(FILES, false);

    const state = useDockStore.getState();
    expect(state.placements[FILES].onBar).toBe(false);
    expect(state.placements[FILES].slot).toBe('right');
  });

  it('setViewSize：clamp 到 MIN_ZONE_SIZE_PERCENT，同值不写', () => {
    useDockStore.getState().setViewSize(FILES, 3);
    expect(useDockStore.getState().viewSizes[FILES]).toBe(MIN_ZONE_SIZE_PERCENT);

    const sizes = useDockStore.getState().viewSizes;
    useDockStore.getState().setViewSize(FILES, MIN_ZONE_SIZE_PERCENT);
    expect(useDockStore.getState().viewSizes).toBe(sizes);
  });

  it('setLeftSlotSize', () => {
    useDockStore.getState().setLeftSlotSize(22);
    expect(useDockStore.getState().leftSlotSize).toBe(22);
  });
});

describe('dockStore sanitize — 坏输入必须被吞掉，不炸不空白（G6）', () => {
  it('未知视图 / 非法槽位 / 非有限 order / 非法 onBar 全部回默认', () => {
    const snapshot = sanitize({
      placements: {
        // 未知视图：声明表里没有 → 整条丢弃
        'panel:ghost': { view: 'panel:ghost', slot: 'left', order: 0, onBar: true },
        // 非法槽位 + NaN order + 非 boolean onBar
        [FILES]: { view: FILES, slot: 'top', order: Number.NaN, onBar: 'yes' },
      },
      zones: {
        left: { expanded: false, activeView: 'panel:ghost' },
        right: { expanded: 'nope', activeView: FILES },
      },
      viewSizes: { [panelView('browser')]: 2, 'panel:ghost': 30, [FILES]: Number.NaN },
      leftSlotSize: Number.POSITIVE_INFINITY,
    });

    expect(snapshot.placements['panel:ghost']).toBeUndefined();
    expect(snapshot.placements[FILES]).toMatchObject({ slot: 'right', onBar: true });
    // 左槽永远展开（保留既有行为）；悬挂的前台回落到槽内首个
    expect(snapshot.zones.left).toEqual({ expanded: true, activeView: PROJECTS });
    expect(snapshot.zones.right).toEqual({ expanded: false, activeView: FILES });
    // 尺寸键必须能在声明表查到，且 clamp 到下限；NaN 丢弃
    expect(snapshot.viewSizes).toEqual({ [panelView('browser')]: MIN_ZONE_SIZE_PERCENT });
    expect(snapshot.leftSlotSize).toBe(DEFAULT_ZONE_SIZE_PERCENT);
  });

  it('缺字段（空对象 / 非对象）→ 完整默认布局', () => {
    for (const input of [undefined, null, 42, 'oops', {}, { placements: [] }]) {
      const snapshot = sanitize(input);
      expect(Object.keys(snapshot.placements).sort()).toEqual(Object.keys(DOCK_VIEW_META).sort());
      expect(snapshot.zones.left.expanded).toBe(true);
      expect(snapshot.zones.right.expanded).toBe(false);
    }
  });

  it('createDefaultDockState 与 sanitize(空) 同源', () => {
    expect(createDefaultDockState()).toEqual(sanitize(undefined));
  });
});

describe('dockStore.migrateFromV5 — 两份表示折成一份（G6）', () => {
  const V5 = {
    barItems: [
      { panelId: 'projects', side: 'left', order: 0, visible: true },
      { panelId: 'library', side: 'left', order: 3, visible: true },
      { panelId: 'files', side: 'left', order: 9, visible: false },
      { panelId: 'gitControl', side: 'right', order: 1, visible: true },
      // registry 里已删的面板 → 丢弃
      { panelId: 'deletedPanel', side: 'right', order: 2, visible: true },
      // 坏行（缺 panelId）→ 丢弃
      { side: 'right', order: 4, visible: true },
    ],
    zones: {
      left: { panels: ['projects', 'library'], activePanelId: 'library', expanded: true },
      right: { panels: ['files'], activePanelId: 'ghostPanel', expanded: true },
    },
    rightPanelSizes: { browser: 50, ghostPanel: 30 },
    leftPanelSize: 22,
  };

  it('barItems 的 side / order / visible 折叠成 placements（含 library → appView 键）', () => {
    const snapshot = migrateFromV5(V5);

    expect(snapshot.placements[FILES]).toMatchObject({ slot: 'left', onBar: false });
    expect(snapshot.placements[LIBRARY].slot).toBe('left');
    expect(snapshot.placements[PROJECTS]).toMatchObject({ slot: 'left', onBar: true });
    expect(snapshot.placements['panel:deletedPanel']).toBeUndefined();
  });

  it('槽内 order 归一化：barItems.order 的相对序被保留并重排为 0..n-1', () => {
    const snapshot = migrateFromV5(V5);
    // V5 的 barItems.order 是全局序（projects 0 < library 3 < files 9）→ 左槽相对序不变
    expect(snapshot.placements[PROJECTS].order).toBeLessThan(snapshot.placements[LIBRARY].order);
    expect(snapshot.placements[LIBRARY].order).toBeLessThan(snapshot.placements[FILES].order);
    // 绝对数值由声明表行数决定（新增 tabHost 行会插进来），断言归一化形状而不是算术
    const leftOrders = Object.values(snapshot.placements)
      .filter((placement) => placement.slot === 'left')
      .map((placement) => placement.order)
      .sort((a, b) => a - b);
    expect(leftOrders).toEqual(leftOrders.map((_, index) => index));
  });

  it('activePanelId → activeView；悬挂值回落首个；右槽展开态保留', () => {
    const snapshot = migrateFromV5(V5);

    expect(snapshot.zones.left.activeView).toBe(LIBRARY);
    expect(snapshot.zones.right.expanded).toBe(true);
    // 右槽该快照里只有 gitControl（files 被用户移到了左栏）→ 悬挂的 ghostPanel 回落首个
    expect(snapshot.zones.right.activeView).toBe(panelView('gitControl'));
  });

  it('rightPanelSizes → viewSizes（未知键丢弃），leftPanelSize 保留', () => {
    const snapshot = migrateFromV5(V5);

    expect(snapshot.viewSizes).toEqual({ [panelView('browser')]: 50 });
    expect(snapshot.leftSlotSize).toBe(22);
  });

  it('空 / 非对象输入 → 默认布局（不抛）', () => {
    expect(migrateFromV5(undefined)).toEqual(createDefaultDockState());
    expect(migrateFromV5('oops')).toEqual(createDefaultDockState());
  });
});

describe('dockStore persist merge — 重新水合走 sanitize（每次 merge 都跑）', () => {
  it('v5 快照（version 5）经 migrate 落到 v6 形状', async () => {
    localStorage.setItem(
      'neeko-dock-layout',
      JSON.stringify({
        state: {
          barItems: [{ panelId: 'files', side: 'left', order: 0, visible: true }],
          zones: { right: { panels: ['files'], activePanelId: 'files', expanded: true } },
          rightPanelSizes: { browser: 50 },
          leftPanelSize: 20,
        },
        version: 5,
      }),
    );

    await useDockStore.persist.rehydrate();

    const state = useDockStore.getState();
    expect(state.placements[FILES].slot).toBe('left');
    expect(state.zones.right.expanded).toBe(true);
    expect(state.viewSizes).toEqual({ [panelView('browser')]: 50 });
    expect(state.leftSlotSize).toBe(20);
  });

  it('v6 快照里的坏值（手改 localStorage：未知 key / null order / 悬挂前台）被清洗', async () => {
    localStorage.setItem(
      'neeko-dock-layout',
      JSON.stringify({
        state: {
          placements: {
            [FILES]: { view: FILES, slot: 'top', order: null, onBar: true },
            'panel:ghost': { view: 'panel:ghost', slot: 'left', order: 0, onBar: true },
          },
          zones: {
            left: { expanded: false, activeView: 'panel:ghost' },
            right: { expanded: true, activeView: 'panel:ghost' },
          },
          viewSizes: { 'panel:ghost': 40 },
          leftSlotSize: null,
        },
        version: 6,
      }),
    );

    await useDockStore.persist.rehydrate();

    const state = useDockStore.getState();
    expect(state.placements['panel:ghost']).toBeUndefined();
    expect(state.placements[FILES].slot).toBe('right');
    expect(state.zones.left).toEqual({ expanded: true, activeView: PROJECTS });
    expect(state.zones.right).toEqual({ expanded: true, activeView: FILES });
    expect(state.viewSizes).toEqual({});
    expect(state.leftSlotSize).toBe(DEFAULT_ZONE_SIZE_PERCENT);
  });

  it('无持久化数据时保持默认布局', async () => {
    await useDockStore.persist.rehydrate();

    expect(useDockStore.getState().zones.right.activeView).toBe(FILES);
  });
});

describe('appViewStore isAppView guard', () => {
  it('accepts real AppView values', () => {
    expect(isAppView('normal')).toBe(true);
    expect(isAppView('library')).toBe(true);
    expect(isAppView('settings')).toBe(true);
  });

  it('rejects arbitrary strings', () => {
    expect(isAppView('mysteryTab')).toBe(false);
    expect(isAppView('')).toBe(false);
    expect(isAppView('projects')).toBe(false);
    expect(isAppView('skills')).toBe(false); // 独立 skills 中心视图已并入 Library
  });
});
