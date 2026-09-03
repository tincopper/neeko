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
  search: {
    id: 'search',
    defaultZone: 'right',
    defaultOrder: 5,
  },
};
