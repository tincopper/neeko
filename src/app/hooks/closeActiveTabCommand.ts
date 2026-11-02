import type { SaveTabAction } from '@/features/editor/store/closeConfirmStore';
import { closeTabWithConfirmation } from '@/features/editor/store/closeTab';
import { activeTabIdOf } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { getActiveCheckoutPath } from '@/shared/store/workspaceStore';
import { tabSpaceKeyOf } from '@/shared/utils/tabIdentity';
import { WorkspaceSession } from '@/shared/utils/workspaceRef';

/**
 * 设置页 tab 空间 id（与 useTabManagement 的 app 空间键保持一致，
 * 无项目时设置页也有自己的 tab 空间可关）。
 */

/**
 * 解析「当前激活项目 / worktree」对应的 tabKey。
 *
 * 在 close-tab 事件到达时现取（而非闭包捕获），避免项目/worktree 切换后
 * 监听器持有过期 tabKey。无项目时回落到设置页 tab 空间。
 */
export function resolveCurrentTabKey(): string {
  const projectId = useProjectStore.getState().activeProjectId;
  if (!projectId) return tabSpaceKeyOf({ kind: 'app' });
  const worktreePath = getActiveCheckoutPath();
  return WorkspaceSession.of(projectId, worktreePath ?? null).key;
}

/**
 * 关闭指定 tab 空间里当前激活的 tab。
 *
 * 前台由**布局派生**（`activeTabIdOf` → `selectActiveTabId`：激活编辑器组的激活 tab），
 * 不再读已删除的 `tabs[tabKey].activeTabId` —— 那个空间级投影曾随分屏/换 pane 与布局
 * 分叉，导致 Cmd+W 关错 tab（用户可见缺陷，2026-10-15 结构消除）。
 *
 * dirty 文件 tab 弹三选确认（与 X 按钮路径同源的 closeConfirmStore 编排）：
 * cancel 不关、discard 直接关、save 保存成功才关。
 *
 * @param saveTab 保存指定 tab 的动作（「保存」分支调用），由 useAppShellData
 *   注入 `fileView.saveTabById`；未提供时「保存」视为失败 → 不关闭。
 * @returns 是否真的关闭了一个 tab
 */
export async function closeActiveTabForTabKey(
  tabKey: string,
  saveTab?: SaveTabAction,
): Promise<boolean> {
  const tabId = activeTabIdOf(tabKey);
  if (!tabId) return false;
  return closeTabWithConfirmation(tabKey, tabId, saveTab);
}

/**
 * Cmd+W / Ctrl+W → 关闭当前激活 tab（绝不关窗口）。
 *
 * 作为 `close-tab` 事件的处理器：现取项目/worktree/tab 最新状态，
 * 无激活 tab 时静默返回；dirty 文件 tab 经全局确认状态机三选。
 */
export async function closeActiveTabCommand(saveTab?: SaveTabAction): Promise<boolean> {
  return closeActiveTabForTabKey(resolveCurrentTabKey(), saveTab);
}
