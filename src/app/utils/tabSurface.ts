import { DOCK_VIEW_META, tabHostView, type DockSlot } from '@/shared/dock';
import { useDockStore } from '@/shared/store/dockStore';
import { useEditorStore } from '@/shared/store/editorStore';

/**
 * 把 tab 移到某个 surface 的**唯一跨 store 编排点**（design §7.2）。
 *
 * `editorStore ⇏ app 层`、`dockStore ⇏ editorStore` 两条依赖方向都不破：需要同时读两个
 * store 的只有这里，UI 不得分别调三个 store（那会把顺序知识散到调用点）。
 *
 * **顺序不可颠倒**：`dockTab` → `setViewOnBar(host, true)` → `activateView(host)`。
 * - 先移动：移动失败（pinned / 未知 tab）时侧区不能已经被打开；
 * - 再钉图标：保证用户始终有回程入口（右栏图标）；
 * - 最后展开：展开后立刻就能看到刚移动的 tab。
 *
 * 前置校验全部在写之前完成：任一项不成立直接 `false`，**状态一字不动**（不会出现
 * 「tab 已停靠但宿主没开」或「宿主开了但 tab 还在中间」这类半完成态）。
 */
export function moveTabToSlot(tabKey: string, tabId: string, target: 'center' | DockSlot): boolean {
  const editor = useEditorStore.getState();
  const layout = editor.editorLayout[tabKey];
  if (!layout) return false;
  if (!editor.tabs[tabKey]?.tabs.some((tab) => tab.id === tabId)) return false;
  // R9：pinned tab 拒绝停靠（不静默 unpin —— 由调用方提示）
  if (layout.pinnedTabIds.includes(tabId)) return false;

  const hostView = target === 'center' ? null : tabHostView(target);
  // 目标宿主必须在声明表里登记为 tabHost：否则移进去的 tab 没有任何渲染点（静默丢失）
  if (hostView && DOCK_VIEW_META[hostView]?.host !== 'tabHost') return false;

  editor.dockTab(tabKey, tabId, target);
  if (!hostView) return true;

  const dock = useDockStore.getState();
  dock.setViewOnBar(hostView, true);
  dock.activateView(hostView);
  return true;
}
