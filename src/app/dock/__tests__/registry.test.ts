// @vitest-environment node
/**
 * Dock 注册表接线：`shared/dock/panelMeta.ts`（结构）↔ `app/dock/registry.ts`（UI 绑定）。
 *
 * # 为什么需要这条测试
 *
 * `buildDockPanelRegistry()` 在**模块加载时**就遍历 `DOCK_PANEL_META`，缺一条 UI binding 直接
 * `throw`（`[dock] missing UI binding for panel "x"`）。而它是 `AppProviders` 的顶层 import ——
 * 也就是说「漏写一条 registry 条目」的表现是**白屏**，不是某块 UI 缺失。
 *
 * 在此之前**没有任何测试 import 真实的 registry**（`dockStore.test.ts` 把 `DOCK_PANEL_META`
 * mock 掉了；`layout/` 只吃测试自造的 registry）。于是新增面板（如 `tasks`）的三件事 —— meta、
 * UI binding、icon 名 —— 只能靠人眼对齐，而 icon 名拼错在类型上是合法的（`icon: string`），
 * 运行时只是画一个空图标。
 */
import { describe, expect, it } from 'vitest';

import { DOCK_PANEL_META } from '@/shared/dock';

import { dockPanelIcons, dockPanelRegistry } from '../registry';

describe('dock 注册表接线', () => {
  it('每个 panelMeta 都有 UI binding（缺一条 = 启动时 throw 白屏）', () => {
    expect(Object.keys(dockPanelRegistry).sort()).toEqual(Object.keys(DOCK_PANEL_META).sort());
  });

  it('每个 binding 的 icon 名都能在 icon 表里解析（icon: string 拼错不会报类型错）', () => {
    // 聚合后一次断言：`expect(value, message)` 这种两参形式被 `vitest/valid-expect` 禁掉，
    // 而逐个 `expect` 在失败时只说“第 N 个”，不如直接列出“哪个面板的哪个 icon 名”。
    const unresolved = Object.entries(dockPanelRegistry)
      .filter(([, def]) => !def.icon || dockPanelIcons[def.icon] === undefined)
      .map(([panelId, def]) => `${panelId}:${def.icon}`);

    expect(unresolved).toEqual([]);
  });

  it('tasks 面板接上了 TasksPanel，且排在 search 之前（不给两处同序）', () => {
    const tasks = dockPanelRegistry.tasks;

    expect(tasks.title).toBe('Tasks');
    expect(tasks.component).toBeDefined();
    expect(DOCK_PANEL_META.tasks.defaultZone).toBe('right');
    expect(DOCK_PANEL_META.tasks.defaultOrder).toBeLessThan(DOCK_PANEL_META.search.defaultOrder);
  });
});
