import { useEditorStore } from '@/shared/store/editorStore';
import { WorkspaceSession } from '@/shared/utils/workspaceRef';

import { destroyTerminalsForSession, destroyTerminalsForTab } from './terminalCache';

/**
 * tab 空间清理 —— 直接按 editor 组键（canonical `WorkspaceKey`，裸 `projectId` 亦按主 checkout 解析）
 * 构造 session，再走 terminal 寻址 API。
 *
 * 新键（`session.key` + SEP + tabId + SEP + paneId）下**不需要**「两个命名空间换算」：
 * session.key 直接是键前缀，`terminalAddressPrefixOfTab` / `terminalAddressPrefix` 已精确覆盖，
 * 旧的 `P:wt:path` 前缀换算与冒号段匹配随之退役。
 */

/** Tear down local / WSL / remote terminal PTY caches for a single editor tab. */
export function cleanupTerminalsForTab(
  tabKey: string,
  tabId: string,
  options: { keepSession?: boolean } = {},
): void {
  destroyTerminalsForTab(WorkspaceSession.fromKeyOrId(tabKey), tabId, options);
}

/**
 * Tear down all terminal caches associated with a tab space (canonical
 * `WorkspaceKey`, or a bare `projectId` = main space), used when clearing every
 * tab in that space.
 */
export function cleanupTerminalsForTabKey(tabKey: string): void {
  destroyTerminalsForSession(WorkspaceSession.fromKeyOrId(tabKey));
}

/** Close one editor tab and recycle any terminal PTY behind it.
 *
 * `keepSession` = 「后台运行」：tab 收起来，进程继续跑（会话列表仍监控它的状态）。
 */
export function closeEditorTab(
  tabKey: string,
  tabId: string,
  options: { keepSession?: boolean } = {},
): void {
  cleanupTerminalsForTab(tabKey, tabId, options);
  useEditorStore.getState().closeTab(tabKey, tabId);
}

/** Close every tab in a tab space and recycle terminal PTYs. */
export function closeAllEditorTabs(tabKey: string): void {
  const existing = useEditorStore.getState().tabs[tabKey];
  if (existing) {
    for (const tab of existing.tabs) {
      cleanupTerminalsForTab(tabKey, tab.id);
    }
  }
  cleanupTerminalsForTabKey(tabKey);
  useEditorStore.getState().clearProjectTabs(tabKey);
}
