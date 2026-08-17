import { useBrowserTabsStore } from '@/shared/store/browserTabsStore';
import { registerTabCleanup } from '@/shared/store/editorStore';
import type { Tab } from '@/shared/types/tab';

import { browserClose, browserSetVisible } from '../api/browserApi';
import { getBrowserTabLabel } from '../hooks/useBrowserConstants';

/**
 * Browser tab 的关闭清理 handler。
 *
 * 通过 `registerTabCleanup('browser', ...)` 挂到 editorStore 的按 kind 分发注册表：
 * `closeTab` / `clearProjectTabs` 移除 Browser tab 时销毁其独立 webview 并移除
 * per-tab 状态。避免 terminal ↔ browser 互相导入造成的循环依赖。
 *
 * 双保险：先 `browserSetVisible(false)` 再 `browserClose` —— 即便平台侧 close
 * 失败/延迟，webview 也先被隐藏，不会残留可见遮挡应用内容区。
 */
const browserTabCleanupHandler = (_tabKey: string, tab: Tab): void => {
  const label = getBrowserTabLabel(tab.id);
  // 隐藏先于关闭：close 失败时 webview 也不残留可见（hide 语义可靠，panel 一直在用）
  void browserSetVisible(label, false).catch(() => {
    /* 幂等清理，失败忽略 */
  });
  void browserClose(label).catch((err) => {
    console.error('[Browser] Failed to close webview on tab close:', err);
  });
  useBrowserTabsStore.getState().removeTabState(tab.id);
};

// 模块加载即注册（幂等）——关闭清理必须始终可用，不依赖某个 hook 是否挂载过。
// registerTabCleanup 本身是 Map.set，重复注册同一 handler 无害。
registerTabCleanup('browser', browserTabCleanupHandler);

/**
 * 幂等确保注册（保留供 hook 每次渲染调用）。
 *
 * 之所以保留：修复 editorStore 模块被（热）重载后其模块级注册表重置、而本模块的
 * 注册丢失导致的「关闭 tab 不销毁 webview」。每次渲染重新 `registerTabCleanup`
 * 会把 handler 写回当前注册表，代价仅为一次 Map.set。
 */
export function ensureBrowserTabCleanupRegistered(): void {
  registerTabCleanup('browser', browserTabCleanupHandler);
}
