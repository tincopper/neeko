import { useCloseConfirmStore } from '@/features/editor/store/closeConfirmStore';
import { closeEditorTab } from '@/features/terminal';
import { sessionTab } from '@/shared/selectors/liveSessionSelectors';
import { useEditorStore } from '@/shared/store/editorStore';
import type { SessionView } from '@/shared/types/liveSessions';
import { reportFrontendError } from '@/shared/utils/errorReporting';

import { deleteLiveSession, renameLiveSessionTitle } from '../api/liveSessionsApi';

/**
 * 侧栏会话行的两项**动作**（改名 / 删除）—— 无 React，可直测。
 *
 * 与 `hooks/useSessionRowActions` 分家：那边只做 React 绑定（`useCallback` 包一层），
 * 判据与顺序都在这里。于是「删除一条会话」只有**一处**实现 —— 未来的批量删除、
 * 命令面板、右键菜单都从这里调，不会各自再写一遍顺序。
 *
 * ## 改名为什么是 `user` 来源
 *
 * `TitleSource` 的质量序是 `Placeholder < Prompt < Native < User` —— 手改名落最高级，
 * 于是**任何自动来源都不再覆盖它**（`should_upgrade` 已保证）。来源由后端在
 * `rename_live_session` 里固定：IPC 不再接受前端声明 `source`（前端可控的来源曾让任意
 * 终端字节流伪装成 `Native` 覆盖用户改名）。
 *
 * 改名**不**置位 `has_user_input`：给一条还没被用过的会话改名，不该让它凭空出现在侧栏
 * （可见性判据只有「已经在用」，改的只是名字）。
 *
 * ## 删除的两条不变量
 *
 * 1. **先问**。删除不可撤销（活着的话进程会结束、行会消失），确认宿主与「关 tab」
 *    共用一套（`closeConfirmStore`）—— 再开一套就要把 `hostMounted` 那条「无宿主时
 *    立即 cancel，否则调用方永久挂起」的守卫再写一遍，漏写的那份表现为操作静默失效。
 * 2. **先关 tab，再删条目**。tab 是「这条会话的视图」：会话没了还留一个死终端面板
 *    只是噪声；反过来（先删条目）会让 tab 的关闭路径再去关一个已不存在的进程，
 *    后端只能记一条「unknown session」告警。顺序是这里唯一能避免它的地方，
 *    后端 `delete_live_session` 的文档也把这条前置条件写明了。
 */

/** 改名：落 `user` 来源（失败上报到统一错误面，不静默）。 */
export function renameSession(session: SessionView, title: string): void {
  // 失败不静默：这条通道漏了会表现为「改了名又变回去」，用户会以为是自动标题的锅。
  void renameLiveSessionTitle(session.sessionId, title).catch((err) =>
    reportFrontendError('live-sessions.rename', err),
  );
}

/**
 * 删除：确认 → 关掉承载它的 tab → 后端结束进程并摘掉条目。
 *
 * @returns 是否真的发起了删除（`false` = 用户取消）。
 */
export async function deleteSession(session: SessionView): Promise<boolean> {
  const label = session.title.trim() || session.sessionId;
  if ((await useCloseConfirmStore.getState().requestSessionDelete(label)) !== 'delete') {
    return false;
  }

  const tabs = useEditorStore.getState().tabs[session.workspaceKey]?.tabs ?? [];
  const tab = sessionTab(session, tabs);
  if (tab) closeEditorTab(session.workspaceKey, tab.id);

  await deleteLiveSession(session.sessionId).catch((err) =>
    reportFrontendError('live-sessions.delete', err),
  );
  return true;
}
