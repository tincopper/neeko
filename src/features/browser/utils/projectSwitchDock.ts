/**
 * 项目切换时右侧 dock 的调整决策。
 *
 * 浏览器按项目隔离后，dock 的右侧前台视图是全局共享的，但浏览器面板
 * 是否展示应当跟随当前项目：项目未开启浏览器时切过去不应展示空浏览器面板，
 * 项目已开启浏览器时切回去应自动恢复浏览器面板（保持原布局）。
 *
 * **v6 之后不再是「把面板增删进 zone」**：落位表（placements）是唯一真源，
 * 每个视图恒有落位，所以「不在任何 zone 里」这个状态不可表示。这里的决策只剩
 * 「激活某个视图 / 收起右槽 / 什么也不做」三种 —— 布局是用户的，切换项目不搬动它。
 */
import { panelView, type ViewKey } from '@/shared/dock';

export const BROWSER_PANEL_ID = 'browser';

/** 浏览器面板的视图身份。 */
export const BROWSER_VIEW = panelView(BROWSER_PANEL_ID);

export interface RightSlotSnapshot {
  /** 右槽内的视图（有序）。 */
  views: readonly ViewKey[];
  activeView: ViewKey | null;
  expanded: boolean;
}

export type ProjectSwitchDockAction =
  /** 无需调整 dock */
  | { type: 'none' }
  /** 激活该视图（它会出现在自己所在的槽里，展开并成为前台） */
  | { type: 'activate'; view: ViewKey }
  /** 右侧 zone 无可切的非浏览器视图，收起右侧 */
  | { type: 'collapse' };

/**
 * 根据目标项目的浏览器是否已创建（isCreated），决定项目切换时右侧 dock 的调整。
 *
 * - 右侧收起时不打扰用户布局（保持原布局）。
 * - 浏览器已开启：确保右槽前台是浏览器（切回去时浏览器保持开启）。
 *   **浏览器被用户移到了别的槽** ⇒ 不动布局（它的落位是用户决定，切项目不该把它拽回来）。
 * - 浏览器未开启：若右侧正显示浏览器，切到右槽内第一个非浏览器视图；
 *   若右槽只剩浏览器，则收起右侧（项目未开启浏览器时不展示空浏览器面板）。
 */
export function decideProjectSwitchDock(
  right: RightSlotSnapshot,
  nextBrowserCreated: boolean,
): ProjectSwitchDockAction {
  if (!right.expanded) return { type: 'none' };

  if (nextBrowserCreated) {
    if (!right.views.includes(BROWSER_VIEW)) return { type: 'none' };
    if (right.activeView !== BROWSER_VIEW) return { type: 'activate', view: BROWSER_VIEW };
    return { type: 'none' };
  }

  if (right.activeView !== BROWSER_VIEW) return { type: 'none' };
  const fallback = right.views.find((view) => view !== BROWSER_VIEW);
  if (fallback) return { type: 'activate', view: fallback };
  return { type: 'collapse' };
}
