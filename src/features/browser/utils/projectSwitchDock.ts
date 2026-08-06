/**
 * 项目切换时右侧 dock 的调整决策。
 *
 * 浏览器按项目隔离后,dock 的右侧激活面板是全局共享的,但浏览器面板
 * 是否展示应当跟随当前项目:项目未开启浏览器时切过去不应展示空浏览器面板,
 * 项目已开启浏览器时切回去应自动恢复浏览器面板(保持原布局)。
 */

export const BROWSER_PANEL_ID = 'browser';

export interface RightZoneSnapshot {
  panels: string[];
  activePanelId: string | null;
  expanded: boolean;
}

export type ProjectSwitchDockAction =
  /** 无需调整 dock */
  | { type: 'none' }
  /** 面板已在右侧 zone 中,直接激活 */
  | { type: 'activate'; panelId: string }
  /** 面板不在任何 zone 中,需要加入并激活(通过 togglePanel) */
  | { type: 'add-and-activate'; panelId: string }
  /** 右侧 zone 无其他面板可切,收起右侧 */
  | { type: 'collapse' };

/**
 * 根据目标项目的浏览器是否已创建(isCreated),决定项目切换时右侧 dock 的调整。
 *
 * - 右侧收起时不打扰用户布局(保持原布局)。
 * - 浏览器已开启:确保右侧激活浏览器面板,切回去时浏览器保持开启。
 * - 浏览器未开启:若右侧正显示浏览器面板,切到 zone 内第一个非浏览器面板;
 *   若 zone 内只剩浏览器面板,则收起右侧(项目未开启浏览器时不展示空浏览器面板)。
 */
export function decideProjectSwitchDock(
  right: RightZoneSnapshot,
  nextBrowserCreated: boolean,
): ProjectSwitchDockAction {
  if (!right.expanded) return { type: 'none' };

  if (nextBrowserCreated) {
    if (!right.panels.includes(BROWSER_PANEL_ID)) {
      return { type: 'add-and-activate', panelId: BROWSER_PANEL_ID };
    }
    if (right.activePanelId !== BROWSER_PANEL_ID) {
      return { type: 'activate', panelId: BROWSER_PANEL_ID };
    }
    return { type: 'none' };
  }

  if (right.activePanelId !== BROWSER_PANEL_ID) return { type: 'none' };
  const fallback = right.panels.find((p) => p !== BROWSER_PANEL_ID);
  if (fallback) return { type: 'activate', panelId: fallback };
  return { type: 'collapse' };
}
