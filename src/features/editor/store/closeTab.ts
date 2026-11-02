import { closeEditorTab } from '@/features/terminal';
import { isBusySession } from '@/shared/selectors/liveSessionSelectors';
import { useEditorStore } from '@/shared/store/editorStore';
import { useLiveSessionsStore } from '@/shared/store/liveSessionsStore';
import type { Tab } from '@/shared/types/tab';
import { getTabDisplayName, isDirtyFileTab } from '@/shared/utils/fileTree';

import { useCloseConfirmStore, type SaveTabAction } from './closeConfirmStore';

/**
 * tab 关闭的**编排**（三条关闭路径共用：TabBar X / 菜单 Close Tab / Cmd+W）。
 *
 * 与 `closeConfirmStore.ts` 是一对：那边负责「问」（有状态：待确认请求 + resolver），
 * 本文件负责「按答案做事」（无状态：问用户、保存、拆终端、改 editor store）。
 *
 * 为什么放在 `store/` 而不是 `actions/`：`store/` 是 editor 域对**其它域**唯一放行直导的
 * 非门面路径（`.eslintrc.cjs` 的 `FIREWALL_EXCEPT`），而 app 层（Cmd+W / AppModals）要
 * 直接用它。塞回门面 `index.ts` 会把整个 editor 依赖图（CodeMirror / LSP）拖进每一个
 * 只想关 tab 的调用点。
 *
 * 顺序不是随意的：**未保存的改动先问**（丢掉的是用户的输入），**再问运行中的会话**
 * （丢掉的是可重跑的任务）。两个问题都要问时，先保住更贵的那一份。
 *
 * @returns 是否实际关闭了 tab
 */
export async function closeTabWithConfirmation(
  tabKey: string,
  tabId: string,
  saveTab?: SaveTabAction,
): Promise<boolean> {
  const tab = useEditorStore.getState().tabs[tabKey]?.tabs.find((t) => t.id === tabId);
  if (!tab) {
    // 已经没有这条 tab（并发关闭 / 状态不同步）：当成"关掉了"，不阻塞调用方。
    closeEditorTab(tabKey, tabId);
    return true;
  }
  if (isDirtyFileTab(tab)) {
    const action = await useCloseConfirmStore.getState().request(getTabDisplayName(tab));
    if (action === 'cancel') return false;
    if (action === 'save') {
      const saved = saveTab ? await saveTab(tabId) : false;
      // 保存失败（含 untitled 的 Save As 取消/失败）→ 不关闭
      if (!saved) return false;
    }
    // 'discard' → 直接关闭
  }

  const busy = busyTerminalSession(tabKey, tab);
  if (busy) {
    // 终端 tab 的显示名 = tab 自己的标题（`getTabDisplayName` 只服务文件 tab）。
    const action = await useCloseConfirmStore.getState().requestTerminalClose(tab.title);
    if (action === 'cancel') return false;
    if (action === 'background') {
      // 后台运行：只拆界面。分离态的唯一写入点是 `terminalCache.destroyCache(keepSession)`
      // —— 它按**每个 pane** 的缓存条目切（一个 tab 可以拆成多 pane，各自一条 PTY），
      // 而本函数只看到 `tab.data.ptySessionId` 一个 id。在那里切才是完整的。
      closeEditorTab(tabKey, tabId, { keepSession: true });
      return true;
    }
    // 'exit' → 正常关闭（结束进程）
  }

  // 已经干完（`ready`）或已终止的会话直接走这条路：不需要问，就是关掉这个面板。
  closeEditorTab(tabKey, tabId);
  return true;
}

/**
 * 这条 tab 后面**正在干活**的终端会话 id；`null` = 不问，直接按「退出进程」关。
 *
 * 判据：tab 是 terminal、记住了 PTY 会话 id、且注册表里该会话 `isBusySession`。
 *
 * 三件事都刻意不算「需要问」：
 * - 会话已终止（进程退出 / 之前关过）—— 没有什么可丢的；
 * - `ready`（agent 干完了，进程还在等下一次输入）—— 用户只是收起一个已完成的面板；
 * - 注册表里没有这条会话（tab 上记的 id 已经过期）。
 */
function busyTerminalSession(tabKey: string, tab: Tab): string | null {
  if (tab.data.kind !== 'terminal' || !tab.data.ptySessionId) return null;
  const sessionId = tab.data.ptySessionId;
  const session = useLiveSessionsStore
    .getState()
    .sessions.find((s) => s.sessionId === sessionId && s.workspaceKey === tabKey);
  return session && isBusySession(session) ? session.sessionId : null;
}
