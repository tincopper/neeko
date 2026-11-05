/**
 * Pure dock panel metadata — no React, no feature/app imports.
 * Used by dockStore for default zones / bar items / toggle placement.
 */
export interface DockPanelMeta {
  id: string;
  defaultZone: 'left' | 'right';
  defaultOrder: number;
  /** default "panel"; tab-mode panels are not docked into zones */
  openAs?: 'tab' | 'panel';
  /** Default zone width percentage (0-100) when this panel is active. */
  defaultZoneSize?: number;
  /**
   * tab 视图打开时是否**收起左栏**（缺省 `true`）。
   *
   * # 为什么它是每个视图的属性，而不是全局策略
   *
   * 两个中心视图对左栏的需求不同：
   *
   * | 视图 | 值 | 理由 |
   * | --- | --- | --- |
   * | Library | 缺省（true） | 两栏 master-detail，导航列已在面板内部；再摆一个 Projects 就是三层导航 |
   * | Tasks | **false** | 它只需要中间区；左栏 Projects 是「切项目」的入口，收起等于把上下文藏起来 |
   *
   * 写成属性而不是特例，是因为新增第三个中心视图时**必须回答**这个问题（不回答就用缺省，
   * 而缺省是有名字、有理由的）。写成 `if (panelId === 'tasks')` 则没人记得要加分支。
   */
  collapseLeftZone?: boolean;
}
