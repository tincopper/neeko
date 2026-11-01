import { invoke } from '@tauri-apps/api/core';

import type { LiveSessionsSnapshot, LiveSessionsWait } from '@/shared/types/liveSessions';
import type { WorkspaceSession } from '@/shared/utils/workspaceRef';

/**
 * live-sessions 快照的 IPC 端口（后端常量与命令见 `src-tauri/src/live_sessions/`）。
 *
 * 协议是 **credit-pull**：后端只在版本变化时 emit 一个版本号，快照靠这里显式拉。
 * 不推送全量 —— macOS WebKit 上每次事件送达 = 一次 `evaluateJavaScript` + 完成值克隆，
 * 推送快照会让 RSS 只增不减（同终端 drain 的结论）。
 */

/**
 * 拉一次快照。
 *
 * @param workspace 传地址 ⇒ 只返回该单元；缺省 ⇒ 全部（侧栏要跨单元，故 bridge 不传）。
 */
export function listLiveSessions(
  workspace?: WorkspaceSession | null,
): Promise<LiveSessionsSnapshot> {
  return invoke<LiveSessionsSnapshot>('list_live_sessions', { workspace: workspace ?? null });
}

/**
 * 版本未变则挂起，直到注册表变化或超时。
 *
 * `timeoutMs` 由后端钳制（1–30s，默认 25s）—— 前端**不得**自己写重试循环去凑时长，
 * 那会让「空闲期」变成忙轮询。
 */
export function waitLiveSessions(
  since: number,
  timeoutMs?: number | null,
): Promise<LiveSessionsWait> {
  return invoke<LiveSessionsWait>('wait_live_sessions', {
    since,
    timeoutMs: timeoutMs ?? null,
  });
}

/**
 * 回传会话标题 / 用户提交：CLI 的 `source = 'native'`，或终端用户每次提交的
 * `source = 'prompt'`。
 *
 * - `prompt`：用户提交输入 ⇒ 首次无真标题时按 `Prompt` 命名并标记「已在用」；
 *   后续提交只清除 CLI hook 的权威状态门。空回车同样清除门，但不会写空标题；
 * - `native`：CLI 自报的会话主题（hook 面在后端直接调注册表，目前无前端调用者 —— 保留以对齐
 *   命令契约 `TitleSource`）。
 *
 * `source` **必传**：两端各持一个默认值（前端 `prompt` / 后端 `native`）时，同一个调用的语义
 * 取决于谁在调用 —— 那是两条规则而不是一条。
 *
 * # 为什么不再回传 OSC 标题
 *
 * `term.onTitleChange`（OSC 0/2）拿到的多是 CLI 的**状态栏**（`pi` 的 `π`、`claude` 的
 * 旋转符…），与「这条会话在做什么」无关，却因为是 `Native` 级别而覆盖掉用户的首条输入 ——
 * 侧栏因此显示一个 `π` 开头的标题。会话名应当来自真实内容：用户输入（`prompt`）或 CLI
 * 自己命名的会话（hook 上报的 `title`）。
 */
export function setLiveSessionTitle(
  sessionId: string,
  title: string,
  source: 'prompt' | 'native',
): Promise<boolean> {
  return invoke<boolean>('set_live_session_title', { sessionId, title, source });
}
