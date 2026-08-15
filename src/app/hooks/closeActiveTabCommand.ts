import { closeEditorTab } from '@/features/terminal';
import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorktreeStore } from '@/shared/store/worktreeStore';
import { resolveTabKey } from '@/shared/utils/tabKey';

/**
 * 设置页 tab 空间 id（与 useTabManagement 的 APP_SETTINGS_PROJECT_ID 保持一致，
 * 无项目时设置页也有自己的 tab 空间可关）。
 */
const APP_SETTINGS_PROJECT_ID = '__app__';

/**
 * 解析「当前激活项目 / worktree」对应的 tabKey。
 *
 * 在 close-tab 事件到达时现取（而非闭包捕获），避免项目/worktree 切换后
 * 监听器持有过期 tabKey。无项目时回落到设置页 tab 空间。
 */
export function resolveCurrentTabKey(): string {
  const projectId = useProjectStore.getState().activeProjectId;
  if (!projectId) return APP_SETTINGS_PROJECT_ID;
  const worktreePath = useWorktreeStore.getState().activeWorktreePath;
  return resolveTabKey(projectId, worktreePath);
}

/**
 * 关闭指定 tab 空间里当前激活的 tab。
 *
 * 读取 `tabs[tabKey].activeTabId`（per-tabKey 激活位，与 UI 高亮同源，
 * addTab/activateTab/closeTab 都会同步），而非全局 activeTabId ——
 * 全局值会在项目/worktree 切换路径被置空/错位。
 *
 * @returns 是否真的关闭了一个 tab
 */
export function closeActiveTabForTabKey(tabKey: string): boolean {
  const tabId = useEditorStore.getState().tabs[tabKey]?.activeTabId ?? null;
  if (!tabId) return false;
  closeEditorTab(tabKey, tabId);
  return true;
}

/**
 * Cmd+W / Ctrl+W → 关闭当前激活 tab（绝不关窗口）。
 *
 * 作为 `close-tab` 事件的处理器：现取项目/worktree/tab 最新状态，
 * 无激活 tab 时静默返回。
 */
export function closeActiveTabCommand(): boolean {
  return closeActiveTabForTabKey(resolveCurrentTabKey());
}
