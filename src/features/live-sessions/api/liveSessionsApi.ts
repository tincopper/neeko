import { invoke } from '@tauri-apps/api/core';

import type { LiveSessionsSnapshot, LiveSessionsWait } from '@/shared/types/liveSessions';
import type { WorkspaceSession } from '@/shared/utils/workspaceRef';

/**
 * live-sessions 快照的 IPC 端口（后端常量与命令见 `src-tauri/src/live_sessions/`）。
 *
 * 协议是 **credit-pull**：后端只在版本变化时 emit 一个版本号，快照靠这里显式拉。
 * 不推送全量 —— macOS WebKit 上每次事件送达 = 一次 `evaluateJavaScript` + 完成值克隆，
 * 推送快照会让 RSS 只增不减（同终端 drain 的结论）。
 *
 * # 标题源隔离（2026-11-06）
 *
 * 终端 I/O **不是标题源**：xterm `onData` 与 OSC 0/2 `onTitleChange` 共用一条通道，
 * TUI 面板的过滤词（`/model` 里敲 `deep`）、状态栏帧、协议应答都会被 CLI 反射到终端
 * 标题栏。它们不是会话事实，因此本文件**不暴露任何从终端写标题的入口**。
 *
 * 标题的生产者只有四类，且都不经终端 I/O：用户改名（本文件的
 * `renameLiveSessionTitle`）、CLI hook `topic`、conversation 缓存里的 provider title、
 * chat 注册时的真实 prompt。`source` 由后端按生产者固定，IPC 不接受前端声明来源 ——
 * 前端可控的 `source` 曾让任意字节流伪装成 `Native` 覆盖用户改名。
 *
 * 终端上报「用户提交过输入」这一事实（`reportLiveSessionActivity`）：后端据此置
 * `has_user_input`、清权威状态门。行文本一并到达，但**是否命名由后端按 `agent_id` 裁决**：
 * 纯 shell（无 agent）没有 hook / conversation 通道，这行是唯一标题素材；有 agent 的
 * 终端里这行可能是 TUI 面板过滤词，后端一律不用它命名。
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
 * 这条会话的**原生恢复命令**参数（`["--resume", "<native id>"]`）；`null` = 不支持。
 *
 * 判据在后端：`native_session_id` 只来自 CLI hook，「这个 agent 支不支持原生恢复」由
 * adapter 回答。前端只负责把 args 拼进 `taskCommand`（与 Histor 面板的恢复路径同形），
 * 不维护任何能力表。
 */
export function liveSessionResumeCommand(sessionId: string): Promise<string[] | null> {
  return invoke<string[] | null>('live_session_resume_command', { sessionId });
}

/**
 * 恢复成功后让新会话**继承**旧会话的身份，旧条目退场。
 *
 * 关 tab 只把条目标成 `Stopped`（侧栏那一行留着当「点回来」的入口）；点回来后新 PTY 是
 * 那条会话的延续 —— 继承标题与「已使用」标记，它才会立刻出现在侧栏（否则要等用户敲第一条
 * 输入），同时旧条目让位（否则侧栏挂着「已停止」与「新会话」两行）。
 *
 * 后端只接受**终止态**的 `from`：活着的会话不会被一次点击合并掉。
 */
export function adoptLiveSession(fromSessionId: string, intoSessionId: string): Promise<boolean> {
  return invoke<boolean>('adopt_live_session', { fromSessionId, intoSessionId });
}

/**
 * 终端用户提交过一次输入 ⇒ 上报活动 + 行文本（是否命名由后端按会话类型裁决）。
 *
 * 后端投影为 `Registry::report_terminal_input(sessionId, line)`：置 `has_user_input`、
 * 清 CLI hook 的权威状态门、恢复 Running，并按会话的 `agent_id` 决定要不要用这行命名：
 *
 * | 会话 | 这行能不能当标题 |
 * | --- | --- |
 * | 纯 shell（`agent_id = None`） | **能** —— 它没有 hook / conversation 通道 |
 * | agent 终端（`agent_id = Some`） | **不能** —— 可能是 `/model` 面板的过滤词 |
 *
 * 前端不做这套分流：字节形状无法区分「真实请求」与「TUI 控件输入」，只有后端登记时的
 * `agent_id` 是可靠事实。裁决与 `agent_id` 同住（注册表）而不是命令层 —— 命令只转发。
 */
export function reportLiveSessionActivity(sessionId: string, line: string): Promise<boolean> {
  return invoke<boolean>('report_live_session_activity', { sessionId, line });
}

/**
 * 侧栏行内改名：来源固定为 `User`（后端裁定，前端无需也不能声明 `source`）。
 *
 * 改名不置位 `has_user_input`：给还没用过的会话改名不该让它凭空出现在侧栏。
 */
export function renameLiveSessionTitle(sessionId: string, title: string): Promise<boolean> {
  return invoke<boolean>('rename_live_session', { sessionId, title });
}

/**
 * 删除一条会话：**结束进程（若还活着）→ 摘掉注册表条目**。
 *
 * 与「关 tab」的差别：关 tab 只标 `Stopped` 并保留条目（那是「点回来」的入口）；
 * 删除是用户明确要扔掉这一行。
 *
 * 结束进程由后端按归属探测分派到两个生产者各自的终止入口（终端 / chat），前端不判断
 * 「这是哪种会话」—— 那需要一份与后端同形的归属表。
 */
export function deleteLiveSession(sessionId: string): Promise<boolean> {
  return invoke<boolean>('delete_live_session', { sessionId });
}
