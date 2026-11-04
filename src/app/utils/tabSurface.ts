import { DOCK_VIEW_META, tabHostView, tabKindView, type DockSlot } from '@/shared/dock';
import { useDockStore } from '@/shared/store/dockStore';
import { useEditorStore } from '@/shared/store/editorStore';
import type { TabKind } from '@/shared/types';

/**
 * tab → surface 的**唯一编排点**（design §7.2）。
 *
 * `editorStore ⇏ app 层`、`dockStore ⇏ editorStore` 两条依赖方向都不破：需要同时读两个
 * store 的只有这里，UI 不得分别调（那会把顺序知识散到调用点）。
 *
 * **顺序不可颠倒**：`dockTab` → `activateView(host)`。
 * - 先移动：移动失败（pinned / 未知 tab）时侧区不能已经被打开；
 * - 再展开：展开后立刻就能看到刚移动的 tab。
 *
 * 前置校验全部在写之前完成：任一项不成立直接 `false`，**状态一字不动**（不会出现
 * 「tab 已停靠但宿主没开」或「宿主开了但 tab 还在中间」这类半完成态）。
 */

/**
 * 该 tab 种类能不能停靠：**有功能入口**（工具栏上有它的图标，`activation.kind === 'openTab'`）
 * 才允许。
 *
 * 为什么要有这条限制：工具栏的槽位宿主（Docked Tabs）**不再有图标**（D10 —— 那一列是功能
 * 入口，容器不是功能）。于是「被移进侧区的东西」只能靠它的种类入口回到前台；文件 / diff /
 * 浏览器这类没有入口的 tab 一旦停进去、同一槽又被别的面板占了前台，就再没有回到它的路径 ——
 * 变成一个「藏着、点不到」的 tab。宁可菜单里不出现这一项。
 */
export function canDockTabKind(kind: TabKind): boolean {
  return DOCK_VIEW_META[tabKindView(kind)]?.activation.kind === 'openTab';
}

export function moveTabToSlot(tabKey: string, tabId: string, target: 'center' | DockSlot): boolean {
  const editor = useEditorStore.getState();
  const layout = editor.editorLayout[tabKey];
  const tab = editor.tabs[tabKey]?.tabs.find((candidate) => candidate.id === tabId);
  if (!layout || !tab) return false;
  // R9：pinned tab 拒绝停靠（不静默 unpin —— 由调用方提示）
  if (layout.pinnedTabIds.includes(tabId)) return false;

  if (target === 'center') {
    editor.dockTab(tabKey, tabId, 'center');
    return true;
  }

  const hostView = tabHostView(target);
  // 目标宿主必须在声明表里登记为 tabHost：否则移进去的 tab 没有任何渲染点（静默丢失）
  if (DOCK_VIEW_META[hostView]?.host !== 'tabHost') return false;
  if (!canDockTabKind(tab.data.kind)) return false;

  editor.dockTab(tabKey, tabId, target);
  // 只展开宿主：工具图标已经不承担「回程入口」（见 `canDockTabKind` 的说明）
  useDockStore.getState().activateView(hostView);
  return true;
}
