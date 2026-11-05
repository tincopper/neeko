// @vitest-environment node
/**
 * `DOCK_PANEL_META` 的结构契约 —— 尤其是「哪些面板是中心视图」这条。
 *
 * # 为什么需要一个独立用例，而不是只靠 `app/dock/registry.test.ts`
 *
 * `openAs: 'tab'` 是**结构**事实，registry 只负责 UI 绑定。两者分开的地方在于失败形态：
 *
 * | 写错的东西 | 症状 | 谁会红 |
 * | --- | --- | --- |
 * | `openAs` 少了 | 面板被塞进 dock zone，右栏挤成一条，中心区永远不出现 | 本文件 |
 * | `isAppView` 不认这个 id | 点左栏**毫无反应**（`togglePanel` 的防御守卫静默 return） | `dockStore.test.ts` |
 * | `AppCenter` 没分支 | 左栏收起了、中心区却是 ProjectView | `AppCenter.test.tsx` |
 *
 * 三条都必须有各自的钉子：只钉其中一条时，另外两条的退化是**静默**的。
 *
 * # 顺序断言为什么是「相对」而不是数字
 *
 * 用户的要求是「放到 library 下面」。钉 `defaultOrder === 4` 会在下次有人往
 * library 与 tasks 之间插面板时假红 —— 而期间用户看到的行为**完全正确**。
 * 所以这里钉的是「同 zone 且排在 library 之后、且不与其他面板同序」，不是魔法数字。
 */
import { describe, expect, it } from 'vitest';

import { DOCK_PANEL_META } from '../panelMeta';

describe('DOCK_PANEL_META — 中心（tab）视图', () => {
  it('tasks 是 tab 面板：中心全宽视图，不进 dock zone', () => {
    const tasks = DOCK_PANEL_META.tasks;

    expect(tasks.openAs).toBe('tab');
    expect(tasks.defaultZone).toBe('left');
  });

  it('tasks 排在 library 之后、且同为左栏入口（用户要求：放到 library 下面）', () => {
    const { tasks, library } = DOCK_PANEL_META;

    expect(tasks.defaultZone).toBe(library.defaultZone);
    // 严格大于：同序时顺序会退化成「对象字面量的键序」，那是另一个可以静默漂移的真相源。
    expect(tasks.defaultOrder).toBeGreaterThan(library.defaultOrder);
  });

  it('所有 tab 面板都是左栏入口（它们要与左栏互斥，必须先出现在左栏菜单里）', () => {
    const tabPanels = Object.values(DOCK_PANEL_META).filter((def) => def.openAs === 'tab');

    expect(tabPanels.length).toBeGreaterThan(0);
    expect(tabPanels.filter((def) => def.defaultZone !== 'left').map((def) => def.id)).toEqual([]);
  });

  it('同一 zone 内不给两处同序（同序 = 顺序取决于对象字面量的键序）', () => {
    const byZone = new Map<string, Map<number, string[]>>();
    for (const def of Object.values(DOCK_PANEL_META)) {
      const orders = byZone.get(def.defaultZone) ?? new Map<number, string[]>();
      orders.set(def.defaultOrder, [...(orders.get(def.defaultOrder) ?? []), def.id]);
      byZone.set(def.defaultZone, orders);
    }

    const collisions = [...byZone.entries()].flatMap(([zone, orders]) =>
      [...orders.entries()]
        .filter(([, ids]) => ids.length > 1)
        .map(([order, ids]) => `${zone}#${order}: ${ids.join(' / ')}`),
    );

    expect(collisions).toEqual([]);
  });
});
