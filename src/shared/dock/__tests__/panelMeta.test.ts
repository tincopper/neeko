// @vitest-environment node
/**
 * `DOCK_VIEW_META` 的结构契约 —— 尤其是「哪些视图是中心视图」这条。
 *
 * # 为什么需要一个独立用例，而不是只靠 `app/dock/registry.test.ts`
 *
 * 「中心视图」在声明表里是**结构**事实（`host: 'none'` + `activation.kind: 'appView'`），
 * registry 只负责 UI 绑定。两者分开的地方在于失败形态：
 *
 * | 写错的东西 | 症状 | 谁会红 |
 * | --- | --- | --- |
 * | `host` 写成 `singleton` | 面板被塞进 dock zone，右栏挤成一条，中心区永远不出现 | 本文件 |
 * | `activation.kind` 不是 `appView` | 点左栏图标**毫无反应**（`togglePanel` 的防御守卫静默 return） | 本文件 + `dockStore.test.ts` |
 * | `AppCenter` 没分支 | 左栏收起了、中心区却是 ProjectView | `AppCenter.test.tsx` |
 *
 * 三条都必须有各自的钉子：只钉其中一条时，另外两条的退化是**静默**的。
 *
 * # 顺序断言为什么是「相对」而不是数字
 *
 * 用户的要求是「放到 library 下面」。钉 `defaultOrder === 4` 会在下次有人往 library 与
 * tasks 之间插视图时假红 —— 而期间用户看到的行为**完全正确**。
 * 所以这里钉的是「同槽且排在 library 之后、且不与其他视图同序」，不是魔法数字。
 */
import { describe, expect, it } from 'vitest';

import { DOCK_VIEW_META, appViewKey } from '../index';

const LIBRARY = appViewKey('library');
const TASKS = appViewKey('tasks');

/** 中心视图（`appView` 入口）的视图键集合。 */
function centerViewKeys(): string[] {
  return Object.entries(DOCK_VIEW_META)
    .filter(([, meta]) => meta.activation.kind === 'appView')
    .map(([view]) => view);
}

describe('DOCK_VIEW_META — 中心（appView）视图', () => {
  it('tasks 是中心视图：不进 dock zone，点击切 appView', () => {
    const tasks = DOCK_VIEW_META[TASKS];

    expect(tasks.host).toBe('none');
    expect(tasks.activation).toEqual({ kind: 'appView', view: 'tasks' });
  });

  it('tasks 排在 library 之后、且同为左栏入口（用户要求：放到 library 下面）', () => {
    const library = DOCK_VIEW_META[LIBRARY];
    const tasks = DOCK_VIEW_META[TASKS];

    expect(tasks.defaultSlot).toBe(library.defaultSlot);
    // 严格大于：同序时顺序会退化成「对象字面量的键序」，那是另一个可以静默漂移的真相源。
    expect(tasks.defaultOrder).toBeGreaterThan(library.defaultOrder);
  });

  it('所有中心视图都是左栏入口（它们要与左栏互斥，必须先出现在左栏菜单里）', () => {
    const offSlot = centerViewKeys().filter((view) => DOCK_VIEW_META[view].defaultSlot !== 'left');

    expect(centerViewKeys().length).toBeGreaterThan(0);
    expect(offSlot).toEqual([]);
  });

  it('同一槽内不给两处同序（同序 = 顺序取决于对象字面量的键序）', () => {
    const bySlot = new Map<string, Map<number, string[]>>();
    for (const [view, meta] of Object.entries(DOCK_VIEW_META)) {
      const orders = bySlot.get(meta.defaultSlot) ?? new Map<number, string[]>();
      orders.set(meta.defaultOrder, [...(orders.get(meta.defaultOrder) ?? []), view]);
      bySlot.set(meta.defaultSlot, orders);
    }

    const collisions = [...bySlot.entries()].flatMap(([slot, orders]) =>
      [...orders.entries()]
        .filter(([, views]) => views.length > 1)
        .map(([order, views]) => `${slot}@${order}: ${views.join(', ')}`),
    );

    expect(collisions).toEqual([]);
  });

  it('每个视图的键与声明表里的 `view` 字段一致（`row()` 的单源保证不靠人记）', () => {
    for (const [key, meta] of Object.entries(DOCK_VIEW_META)) {
      expect(meta.view).toBe(key);
    }
  });
});
