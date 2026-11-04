/**
 * `shared/dock` 的公开面：纯类型 + ViewKey 铸造点 + 落位纯函数 + 声明表。
 * 消费侧一律从这里（或更窄的单文件路径）导入，不要在别处重造 mints / 选择器。
 */
export type {
  DockLayoutState,
  DockPlacement,
  DockSlot,
  DockViewActivation,
  DockViewHost,
  DockViewMeta,
  DockZoneRuntime,
  TabKindLike,
  ViewKey,
} from './types';
export { DOCK_SLOTS, isDockSlot } from './types';

export { appViewKey, isViewKey, panelView, tabHostView, tabKindView } from './viewKey';

export type { MoveViewRequest } from './placement';
export {
  applyActivate,
  applyMove,
  applyOnBar,
  applyToggle,
  hasSlotViews,
  isViewVisible,
  placementsInSlot,
  slotPlacements,
  slotViews,
} from './placement';

export { isZoneRenderable, zoneFrontView, zoneHostedViews } from './zone';

export { DEFAULT_ZONE_SIZE_PERCENT, DOCK_VIEW_META, MIN_ZONE_SIZE_PERCENT } from './panelMeta';
