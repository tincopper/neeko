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
 * 回传终端自己声明的标题（xterm OSC 0/2，`titleSource = native`）。
 *
 * 返回「标题是否真的变了」：注册表按**单调升级**把关（`placeholder < prompt <
 * native < user`），所以同一串 OSC 重复帧、以及任何自动来源试图覆盖用户改名，
 * 都返回 `false` 且不 bump 版本 —— 调用方据此判断「发出去有没有用」，但通常
 * 只需忽略返回值（标题是尽力而为的旁路）。
 *
 * 为什么是命令而不是事件：前端→后端的既有通道是 `terminal-input-{id}`（载荷为
 * stdin 字节）和 agent chat（反向），复用它们要么污染语义、要么新增事件名（红线 5）。
 */
export function setLiveSessionTitle(sessionId: string, title: string): Promise<boolean> {
  return invoke<boolean>('set_live_session_title', { sessionId, title });
}
