import { emit } from '@tauri-apps/api/event';

import { terminalInputEvent } from '@/shared/utils/terminalEvents';
import { workspaceKeyLabel } from '@/shared/utils/workspaceRef';
import type { WorkspaceSession } from '@/shared/utils/workspaceRef';

import { log, resolveTerminalEntryOfTab } from './terminalCache';

/**
 * 写侧执行路径统一入口。地址一律由 `session` 派生（`terminalAddress`），
 * 不再有裸 `projectId` 前缀扫描 —— 跨 session 串写在前缀上不可表达。
 *
 * `tabId` **必填**（决议 R3）：可选性只会喂养「Map 插入顺序首个」这条第二口径，
 * 而「该往哪个 tab」的唯一答案是 `terminalRouting.foregroundTerminalTab`（order 升序）。
 * 四个生产调用方本来就全部显式传 tabId。
 */
export function sendToTerminal(session: WorkspaceSession, text: string, tabId: string): void {
  // **pane 无关** resolve：本函数只持有 tab 身份（pane 是渲染方的知识）。
  // 旧实现用 `paneId='p1'` 默认值硬猜 —— 终端不在第一个 pane 时恒 miss 且静默。
  const entry = resolveTerminalEntryOfTab(session, tabId);
  const sessionId = entry?.sessionId ?? null;

  if (!sessionId) {
    // 入参是 **session.key**（不是 terminal 地址），送 `terminalKeyLabel` 会恒返回
    // `<invalid terminal key>` 而丢掉全部身份信息 —— 两个命名空间各有自己的 label 函数。
    log(`sendToTerminal: no session for ${workspaceKeyLabel(session.key)}:${tabId}`);
    return;
  }

  const bytes = Array.from(new TextEncoder().encode(text));
  emit(terminalInputEvent(sessionId), bytes).catch((err) => {
    log(`sendToTerminal error: ${err}`);
  });
}

/** Bracketed-paste start marker: wrapped input lands in the buffer, never executes. */
export const BRACKETED_PASTE_START = '\x1b[200~';
/** Bracketed-paste end marker. */
export const BRACKETED_PASTE_END = '\x1b[201~';

/**
 * Wrap text in bracketed-paste markers so the shell pastes it as one
 * buffer edit (multi-line stays multi-line, nothing auto-executes).
 */
export function wrapBracketedPaste(text: string): string {
  return `${BRACKETED_PASTE_START}${text}${BRACKETED_PASTE_END}`;
}

/**
 * Emit bracketed-paste bytes to an already-resolved terminal session.
 * Shares sendToTerminal's transport, never appends `\r`.
 */
export function pasteToTerminalSession(sessionId: string, text: string): void {
  const bytes = Array.from(new TextEncoder().encode(wrapBracketedPaste(text)));
  emit(terminalInputEvent(sessionId), bytes).catch((err) => {
    log(`pasteToTerminalSession error: ${err}`);
  });
}
