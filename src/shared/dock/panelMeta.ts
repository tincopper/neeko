import type { DockPanelMeta } from './types';

/**
 * Zone 最小宽度/高度百分比单源：DockLayout 的 ResizablePanel minSize 与
 * dockStore 的尺寸 clamp 必须引用同一常量（避免「must match」手工同步）。
 */
export const MIN_ZONE_SIZE_PERCENT = 12;

/**
 * Single source of structural defaults for dock panels.
 * UI bindings (title/icon/component) live in app/dock/registry.ts.
 */
export const DOCK_PANEL_META: Record<string, DockPanelMeta> = {
  projects: {
    id: 'projects',
    defaultZone: 'left',
    defaultOrder: 0,
  },
  files: {
    id: 'files',
    defaultZone: 'right',
    defaultOrder: 0,
  },
  library: {
    id: 'library',
    // 中央全宽展示（与左栏互斥：打开即收起左栏，关闭即恢复；评审决策）：
    // tab-mode 不入 dock zone，由 appViewStore 控制
    defaultZone: 'left',
    defaultOrder: 3,
    openAs: 'tab',
  },
  gitControl: {
    id: 'gitControl',
    defaultZone: 'right',
    defaultOrder: 1,
  },
  pullRequests: {
    id: 'pullRequests',
    defaultZone: 'right',
    defaultOrder: 2,
  },
  browser: {
    id: 'browser',
    defaultZone: 'right',
    defaultOrder: 3,
    defaultZoneSize: 50,
  },
  conversations: {
    id: 'conversations',
    defaultZone: 'right',
    defaultOrder: 4,
  },
  team: {
    id: 'team',
    defaultZone: 'right',
    // 紧跟 conversations（4）之后：团队面板是「聊完要看的下一步」。
    // search 因此后移一位 —— 不给两处同序，同序意味着顺序取决于对象字面量的键序。
    defaultOrder: 5,
  },
  tasks: {
    id: 'tasks',
    // 中心视图（design §4.2c）：占**中间区**，但**不收左栏**。
    // 左栏 Projects 是「切项目」的入口 —— 看板的数据是按项目存的，收起它等于让用户
    // 看不见自己在看哪个项目的工作项（Library 相反：它自带导航列，左栏就是第三层导航）。
    // 排 `defaultOrder: 4` 紧跟 library（3）：两者都是「中心视图入口」，在左栏菜单里连排。
    // 与 search 同 zone 不同序：同序时顺序取决于对象字面量的键序（既有注释已钉住这条）。
    defaultZone: 'left',
    defaultOrder: 4,
    openAs: 'tab',
    collapseLeftZone: false,
  },
  search: {
    id: 'search',
    defaultZone: 'right',
    defaultOrder: 7,
  },
};
