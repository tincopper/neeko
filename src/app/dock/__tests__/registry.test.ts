// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  DOCK_VIEW_META,
  appViewKey,
  panelView,
  tabHostView,
  tabKindView,
  type DockViewMeta,
} from '@/shared/dock';

import { buildDockPanelRegistry, dockPanelIcons, dockPanelRegistry } from '../registry';

/**
 * 注册表是**编译期静态表**：缺绑定/缺组件时点图标的表现是「什么都不发生」，
 * 比启动即抛更难查。这些用例守的是建表期 fail-fast 与「声明表 ↔ 绑定」的一一对应。
 */

const GHOST = panelView('ghost');

const GHOST_META: Record<string, DockViewMeta> = {
  [GHOST]: {
    view: GHOST,
    host: 'singleton',
    activation: { kind: 'toggleZone' },
    defaultSlot: 'right',
    defaultOrder: 0,
  },
};

describe('dockPanelRegistry — 真实注册表完整性', () => {
  it('声明表里每个视图都有绑定（title / icon）', () => {
    for (const [view, viewMeta] of Object.entries(DOCK_VIEW_META)) {
      const def = dockPanelRegistry[view];
      expect(def?.view).toBe(view);
      expect(def.title).toBeTruthy();
      expect(def.icon).toBeTruthy();
      expect(def.host).toBe(viewMeta.host);
      expect(def.activation).toEqual(viewMeta.activation);
    }
  });

  it('有 zone 内容的视图都绑定了组件；host:none 的入口不要求组件', () => {
    for (const [view, def] of Object.entries(dockPanelRegistry)) {
      if (def.host === 'none') continue;
      expect({ view, bound: Boolean(def.component) }).toEqual({ view, bound: true });
    }
    expect(dockPanelRegistry[appViewKey('library')].host).toBe('none');
  });

  it('没有孤儿绑定（注册表的 key 与声明表一一对应）', () => {
    expect(Object.keys(dockPanelRegistry).sort()).toEqual(Object.keys(DOCK_VIEW_META).sort());
  });

  it('G7：tabHost 每槽恰好一条，且固定在自己的槽（movable:false）', () => {
    for (const slot of ['left', 'right'] as const) {
      const view = tabHostView(slot);
      const def = dockPanelRegistry[view];
      expect({ view, host: def?.host }).toEqual({ view, host: 'tabHost' });
      expect(def.defaultSlot).toBe(slot);
      // 宿主固定在自己槽：拖拽不得把它挪走（能力校验在 dockStore.moveView）
      expect(def.movable).toBe(false);
      expect(def.component).toBeTruthy();

      const sameSlotHosts = Object.values(dockPanelRegistry).filter(
        (candidate) => candidate.host === 'tabHost' && candidate.defaultSlot === slot,
      );
      expect(sameSlotHosts).toHaveLength(1);
    }
  });
});

describe('dockPanelRegistry — 种类级入口（tabKind:*）', () => {
  it.each(['agent-chat', 'terminal'] as const)(
    '%s：只上 bar（host:none）、点击语义 openTab、默认钉在右栏、绑定 title/icon',
    (kind) => {
      const view = tabKindView(kind);
      const meta = DOCK_VIEW_META[view];
      const def = dockPanelRegistry[view];

      expect({ view, host: meta.host }).toEqual({ view, host: 'none' });
      expect(meta.activation).toEqual({ kind: 'openTab', tabKind: kind });
      expect(meta.defaultSlot).toBe('right');
      // 需求本体：重启后图标仍在（缺省靠 defaultOnBar，但这里必须是显式的 true）
      expect(meta.defaultOnBar).toBe(true);
      expect(def.title).toBeTruthy();
      // icon 是静态表的名字：拼错 ICON 会静默退化成标题首字母，所以查一次表
      expect(dockPanelIcons[def.icon]).toBeTruthy();
      // host:'none' 不需要组件（它打开的是 tab，不是 zone 内容）
      expect(def.component).toBeUndefined();
    },
  );
});

describe('buildDockPanelRegistry — fail-fast 负例', () => {
  it('host !== none 却没有 component → 建表即抛', () => {
    expect(() =>
      buildDockPanelRegistry(GHOST_META, { [GHOST]: { title: 'Ghost', icon: 'FileText' } }),
    ).toThrow(/hosted but has no component/);
  });

  it('声明表里有视图却没有绑定 → 建表即抛', () => {
    expect(() => buildDockPanelRegistry(GHOST_META, {})).toThrow(/missing UI binding/);
  });

  it('绑定指向声明表里不存在的视图 → 建表即抛（孤儿绑定不许静默失效）', () => {
    const bindings = {
      [GHOST]: { title: 'Ghost', icon: 'FileText', component: (() => null) as never },
    };
    expect(() => buildDockPanelRegistry({}, bindings)).toThrow(/no entry in DOCK_VIEW_META/);
  });
});
