import type { useEditorStore } from '@/shared/store/editorStore';
import type { useProjectStore } from '@/shared/store/projectStore';
import type { useWorktreeStore } from '@/shared/store/worktreeStore';

/**
 * DEV-only 调试桥：把核心 store 单例挂到 `window.__neekoStores`。
 *
 * 用途：
 * - 纯浏览器（无 Tauri 后端）环境注入测试数据，调试/复现编辑器问题；
 * - DevTools 手动检查 store 状态。
 *
 * 仅在开发环境执行：Tauri 生产构建的页面协议为 `tauri://`，
 * 据此判定（dev server / 纯浏览器均为 http(s)）。
 */

interface NeekoDebugBridge {
  projectStore: typeof useProjectStore;
  editorStore: typeof useEditorStore;
  worktreeStore: typeof useWorktreeStore;
}

declare global {
  interface Window {
    __neekoStores?: NeekoDebugBridge;
  }
}

/** Install the bridge unless running inside a production Tauri webview (`tauri:` protocol). */
export function installDebugBridge(bridge: NeekoDebugBridge): void {
  if (window.location.protocol === 'tauri:') return;
  window.__neekoStores = bridge;
}
